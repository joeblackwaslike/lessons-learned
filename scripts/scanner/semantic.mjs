#!/usr/bin/env node

/**
 * semantic.mjs — Tier 3 semantic scanner using sqlite-vec ANN search.
 *
 * Algorithm per JSONL file:
 *   1. Seed vec_lessons with embeddings for any active lessons that don't have one yet.
 *   2. Parse the file into conversation turns (simplified — text content only).
 *   3. Slide a window of WINDOW_SIZE turns across the conversation.
 *   4. Embed each window via Ollama (nomic-embed-text, 768 dims, L2-normalized).
 *   5. ANN search against vec_lessons: if closest distance < SIMILARITY_THRESHOLD,
 *      the window is semantically similar to a known lesson pattern.
 *   6. Store the flagged window as a pending_semantic_window for interactive review.
 *      Claude extracts lessons from pending windows during `lessons review`.
 *
 * Configuration env vars:
 *   LESSONS_SEMANTIC_THRESHOLD  — similarity threshold, float (default: 0.72)
 *   LESSONS_SEMANTIC_WINDOW     — sliding window size in turns (default: 10)
 *   LESSONS_SEMANTIC_MAX_WINDOWS — max windows to store per file (default: 5)
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { embed } from './embedder.mjs';
import {
  upsertEmbedding,
  searchNearestLessons,
  getActiveRecordsNeedingEmbedding,
  insertPendingWindow,
} from '../db.mjs';

const SIMILARITY_THRESHOLD = parseFloat(process.env.LESSONS_SEMANTIC_THRESHOLD ?? '0.72');
const WINDOW_SIZE = parseInt(process.env.LESSONS_SEMANTIC_WINDOW ?? '10', 10);
const MAX_WINDOWS = parseInt(process.env.LESSONS_SEMANTIC_MAX_WINDOWS ?? '5', 10);

// ─── Seeding ─────────────────────────────────────────────────────────

/**
 * Embed any active lessons that don't have embeddings yet and store them in vec_lessons.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ verbose?: boolean }} [opts]
 */
export async function seedLessonEmbeddings(db, { verbose = false } = {}) {
  const unembedded = getActiveRecordsNeedingEmbedding(db);
  if (unembedded.length === 0) return;

  if (verbose) process.stderr.write(`  Embedding ${unembedded.length} active lesson(s)...\n`);

  for (const row of unembedded) {
    const text = `${row.problem}\n\n${row.solution}`;
    const vec = await embed(text);
    upsertEmbedding(db, row.id, vec);
    if (verbose) process.stderr.write(`  Embedded: ${row.id}\n`);
  }
}

// ─── File scanner ─────────────────────────────────────────────────────

/**
 * Scan one JSONL session file using semantic similarity.
 * Flagged windows are stored as pending_semantic_windows for interactive review.
 *
 * @param {import('node:sqlite').DatabaseSync} db - vec-enabled db handle
 * @param {string} filePath
 * @param {number} startOffset - byte offset to resume from
 * @param {{ verbose?: boolean, dryRun?: boolean }} [opts]
 * @param {string|null} [projectId]
 * @returns {Promise<{ windowsStored: number, bytesRead: number }>}
 */
export async function semanticScanFile(db, filePath, startOffset, opts = {}, projectId = null) {
  const { verbose = false, dryRun = false } = opts;

  const turns = [];
  let bytesRead = startOffset;

  const stream = createReadStream(filePath, { start: startOffset || undefined, encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, 'utf8') + 1;
    if (!line.trim()) continue;
    const parsed = parseTurns(line);
    turns.push(...parsed);
  }

  if (turns.length < 2) return { windowsStored: 0, bytesRead };

  let windowsStored = 0;
  const seenHashes = new Set();

  for (let i = 0; i <= turns.length - WINDOW_SIZE; i++) {
    if (windowsStored >= MAX_WINDOWS) break;

    const window = turns.slice(i, i + WINDOW_SIZE);
    const windowText = window.map(t => `[${t.type}] ${t.text}`).join('\n\n');
    // nomic-embed-text has 2048 token context; code/error text runs ~2 chars/token
    const embeddableText = windowText.slice(0, 2000);

    let vec;
    try {
      vec = await embed(embeddableText);
    } catch (err) {
      if (verbose) process.stderr.write(`  embed failed: ${err.message}\n`);
      continue;
    }

    const nearest = searchNearestLessons(db, vec, 3);
    if (nearest.length === 0) continue;
    if (nearest[0].distance >= SIMILARITY_THRESHOLD) continue;

    const hash = createHash('sha256').update(embeddableText).digest('hex');
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);

    if (verbose)
      process.stderr.write(
        `  [semantic] window ${i}: distance ${nearest[0].distance.toFixed(3)} — ${dryRun ? 'dry-run, skipping store' : 'storing for review'}\n`
      );

    if (!dryRun) {
      const { generateUlid } = await import('../db.mjs');
      insertPendingWindow(db, {
        id: generateUlid(),
        windowText,
        nearestDistance: nearest[0].distance,
        nearestLessonId: nearest[0].lessonId ?? null,
        projectId,
        filePath,
        windowIndex: i,
      });
    }

    windowsStored++;
  }

  return { windowsStored, bytesRead };
}

// ─── JSONL turn parser (simplified) ──────────────────────────────────

/**
 * @typedef {{ type: string, text: string, sessionId: string|null, timestamp: string|null }} SimpleTurn
 */

/**
 * Parse a JSONL line into simple turns (text content only, no tool tracking).
 *
 * @param {string} line
 * @returns {SimpleTurn[]}
 */
function parseTurns(line) {
  if (!line.includes('"type"')) return [];

  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return [];
  }

  const base = {
    sessionId: obj.sessionId ?? null,
    timestamp: obj.timestamp ?? null,
  };

  if (obj.type === 'assistant') {
    const content = obj.message?.content;
    if (!Array.isArray(content)) return [];
    const text = content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();
    return text ? [{ ...base, type: 'assistant', text: text.slice(0, 2000) }] : [];
  }

  if (obj.type === 'user') {
    const content = obj.message?.content;
    if (!Array.isArray(content)) return [];
    const turns = [];

    for (const block of content) {
      if (block.type === 'text' && block.text?.trim()) {
        turns.push({ ...base, type: 'user', text: block.text.trim().slice(0, 1000) });
      } else if (block.type === 'tool_result') {
        let text = '';
        if (typeof block.content === 'string') {
          text = block.content;
        } else if (Array.isArray(block.content)) {
          text = block.content
            .filter(s => s.type === 'text')
            .map(s => s.text)
            .join('\n');
        }
        if (text.trim()) turns.push({ ...base, type: 'tool_result', text: text.slice(0, 2000) });
      }
    }
    return turns;
  }

  return [];
}
