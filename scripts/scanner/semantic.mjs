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
  searchNearestInsightSeeds,
  getActiveRecordsNeedingEmbedding,
  insertPendingWindow,
  upsertInsightSeed,
  getInsightSeedIds,
} from '../db.mjs';

const SIMILARITY_THRESHOLD = parseFloat(process.env.LESSONS_SEMANTIC_THRESHOLD ?? '0.72');
const WINDOW_SIZE = parseInt(process.env.LESSONS_SEMANTIC_WINDOW ?? '10', 10);
const MAX_WINDOWS = parseInt(process.env.LESSONS_SEMANTIC_MAX_WINDOWS ?? '5', 10);
const INSIGHT_THRESHOLD = parseFloat(process.env.LESSONS_INSIGHT_THRESHOLD ?? '0.65');

/** Synthetic seed phrases representing the shape of a breakthrough or critical insight. */
const INSIGHT_SEEDS = [
  'Root Cause: the real issue is that',
  'The fix works because the underlying assumption was wrong',
  'Now I have the full picture. The actual problem is',
  'The real constraint here is non-obvious:',
  'This behavior is surprising — the actual reason is',
  'The correct mental model is fundamentally different because',
  'What I missed: these two things are coupled in a way that',
  'The bug was that the assumption was incorrect — the actual behavior is',
  'The key realization is that this system works differently than expected',
  'Stop — found the actual root cause:',
];

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

/**
 * Embed any insight seed phrases not yet in vec_insight_seeds and store them.
 * Seeds are identified by stable index-based IDs (insight-0, insight-1, ...).
 * Already-embedded seeds are skipped — safe to call on every scan startup.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ verbose?: boolean }} [opts]
 */
export async function seedInsightEmbeddings(db, { verbose = false } = {}) {
  const existingIds = new Set(getInsightSeedIds(db));
  const toEmbed = INSIGHT_SEEDS.filter((_, i) => !existingIds.has(`insight-${i}`));

  if (toEmbed.length === 0) return;

  if (verbose) process.stderr.write(`  Embedding ${toEmbed.length} insight seed(s)...\n`);

  for (let i = 0; i < INSIGHT_SEEDS.length; i++) {
    const seedId = `insight-${i}`;
    if (existingIds.has(seedId)) continue;
    const vec = await embed(INSIGHT_SEEDS[i]);
    upsertInsightSeed(db, seedId, vec, INSIGHT_SEEDS[i]);
    if (verbose) process.stderr.write(`  Embedded seed: ${seedId}\n`);
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

    const lessonNearest = searchNearestLessons(db, vec, 3);
    const insightNearest = searchNearestInsightSeeds(db, vec, 1);

    const lessonMatch =
      lessonNearest.length > 0 && lessonNearest[0].distance < SIMILARITY_THRESHOLD;
    const insightMatch =
      insightNearest.length > 0 && insightNearest[0].distance < INSIGHT_THRESHOLD;

    if (!lessonMatch && !insightMatch) continue;

    const hash = createHash('sha256').update(embeddableText).digest('hex');
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);

    // insight wins if both fire (it's the more novel signal)
    const seedType = insightMatch ? 'insight' : 'lesson';
    const nearestDistance = insightMatch ? insightNearest[0].distance : lessonNearest[0].distance;
    const nearestLessonId = lessonMatch ? (lessonNearest[0].lessonId ?? null) : null;

    if (verbose) {
      const tag = insightMatch
        ? `insight(${insightNearest[0].distance.toFixed(3)})`
        : `lesson(${lessonNearest[0].distance.toFixed(3)})`;
      process.stderr.write(
        `  [semantic] window ${i}: ${tag} — ${dryRun ? 'dry-run, skipping store' : 'storing for review'}\n`
      );
    }

    if (!dryRun) {
      const { generateUlid } = await import('../db.mjs');
      insertPendingWindow(db, {
        id: generateUlid(),
        windowText,
        nearestDistance,
        nearestLessonId,
        seedType,
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
