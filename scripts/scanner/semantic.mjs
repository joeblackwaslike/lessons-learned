#!/usr/bin/env node

/**
 * semantic.mjs — Tier 3 semantic scanner using sqlite-vec ANN search + Claude extraction.
 *
 * Algorithm per JSONL file:
 *   1. Seed vec_lessons with embeddings for any active lessons that don't have one yet.
 *   2. Parse the file into conversation turns (simplified — text content only).
 *   3. Slide a window of WINDOW_SIZE turns across the conversation.
 *   4. Embed each window via Ollama (nomic-embed-text, 768 dims, L2-normalized).
 *   5. ANN search against vec_lessons: if closest distance < SIMILARITY_THRESHOLD,
 *      the window is semantically similar to a known lesson pattern → call Claude.
 *   6. Claude extracts a structured problem/solution or responds {hasLesson: false}.
 *   7. Return extracted LessonCandidate objects.
 *
 * Configuration env vars:
 *   ANTHROPIC_API_KEY           — required for Claude extraction calls
 *   LESSONS_SEMANTIC_THRESHOLD  — similarity threshold, float (default: 0.8)
 *   LESSONS_SEMANTIC_WINDOW     — sliding window size in turns (default: 10)
 *   LESSONS_SEMANTIC_MAX_CALLS  — max Claude calls per file (default: 5)
 *   LESSONS_CLAUDE_MODEL        — model for extraction (default: claude-haiku-4-5-20251001)
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { embed } from './embedder.mjs';
import { upsertEmbedding, searchNearestLessons, getActiveRecordsNeedingEmbedding } from '../db.mjs';

const SIMILARITY_THRESHOLD = parseFloat(process.env.LESSONS_SEMANTIC_THRESHOLD ?? '0.8');
const WINDOW_SIZE = parseInt(process.env.LESSONS_SEMANTIC_WINDOW ?? '10', 10);
const MAX_CLAUDE_CALLS = parseInt(process.env.LESSONS_SEMANTIC_MAX_CALLS ?? '5', 10);
const CLAUDE_MODEL = process.env.LESSONS_CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

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
 *
 * @param {import('node:sqlite').DatabaseSync} db - vec-enabled db handle
 * @param {string} filePath
 * @param {number} startOffset - byte offset to resume from
 * @param {{ verbose?: boolean, dryRun?: boolean }} [opts]
 * @param {string|null} [projectId]
 * @returns {Promise<{ candidates: object[], bytesRead: number }>}
 */
export async function semanticScanFile(db, filePath, startOffset, opts = {}, projectId = null) {
  const { verbose = false, dryRun = false } = opts;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for semantic scanning');

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

  if (turns.length < 2) return { candidates: [], bytesRead };

  const candidates = [];
  let claudeCalls = 0;
  const seenHashes = new Set();

  for (let i = 0; i <= turns.length - WINDOW_SIZE; i++) {
    const window = turns.slice(i, i + WINDOW_SIZE);
    const windowText = window.map(t => `[${t.type}] ${t.text}`).join('\n\n');

    let vec;
    try {
      vec = await embed(windowText);
    } catch (err) {
      if (verbose) process.stderr.write(`  embed failed: ${err.message}\n`);
      continue;
    }

    const nearest = searchNearestLessons(db, vec, 3);
    if (nearest.length === 0) continue;
    if (nearest[0].distance >= SIMILARITY_THRESHOLD) continue;

    // Window is semantically close to a known lesson — ask Claude if there's a new lesson here
    if (dryRun || claudeCalls >= MAX_CLAUDE_CALLS) {
      if (verbose)
        process.stderr.write(
          `  [semantic] window ${i}: distance ${nearest[0].distance.toFixed(3)} (skipping Claude — ${dryRun ? 'dry-run' : 'limit reached'})\n`
        );
      continue;
    }

    if (verbose)
      process.stderr.write(
        `  [semantic] window ${i}: distance ${nearest[0].distance.toFixed(3)} — calling Claude\n`
      );

    let extracted;
    try {
      extracted = await extractWithClaude(windowText, apiKey);
    } catch (err) {
      if (verbose) process.stderr.write(`  Claude extraction failed: ${err.message}\n`);
      claudeCalls++;
      continue;
    }
    claudeCalls++;

    if (!extracted || !extracted.hasLesson) continue;

    const hash =
      'sha256:' +
      createHash('sha256').update(`${extracted.problem}|${extracted.solution}`).digest('hex');

    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);

    const sessionId = window.find(t => t.sessionId)?.sessionId ?? null;
    candidates.push({
      source: 'semantic',
      tool: extracted.tool ?? null,
      trigger: null,
      problem: extracted.problem,
      solution: extracted.solution,
      tags: extracted.tags ?? [],
      sessionId,
      messageId: null,
      timestamp: window.find(t => t.timestamp)?.timestamp ?? null,
      confidence: 0.65,
      priority: 4,
      needsReview: true,
      contentHash: hash,
      signals: { nearestLessonDistance: nearest[0].distance },
      projectId,
    });
  }

  return { candidates, bytesRead };
}

// ─── Claude extraction ────────────────────────────────────────────────

const EXTRACT_PROMPT = `You are analyzing a conversation window from a Claude Code session to identify teachable lessons.

If this window shows a clear error followed by a correction or improvement, extract the lesson.
If there is no clear error→correction pattern, respond with {"hasLesson": false}.

Respond ONLY with valid JSON in one of these shapes:

{"hasLesson": false}

{"hasLesson": true, "problem": "What went wrong and why (1-3 sentences, specific)", "solution": "The correction that resolved it (1-2 sentences)", "tool": "Bash|Read|Edit|Write|Glob|Grep|Agent|null", "tags": ["tool:git", "severity:data-loss"]}

Rules:
- problem/solution must each be at least 20 characters
- tool must be one of: Bash, Read, Edit, Write, Glob, Grep, Agent, or null
- tags use category:value format (tool:, lang:, severity:, topic:)
- Do not invent errors that aren't present in the window`;

/**
 * @param {string} windowText
 * @param {string} apiKey
 * @returns {Promise<{ hasLesson: boolean, problem?: string, solution?: string, tool?: string|null, tags?: string[] } | null>}
 */
async function extractWithClaude(windowText, apiKey) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 512,
      system: EXTRACT_PROMPT,
      messages: [
        {
          role: 'user',
          content: `<window>\n${windowText.slice(0, 8000)}\n</window>\n\nExtract the lesson if present.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude API error (${res.status}): ${body}`);
  }

  const data = /** @type {any} */ (await res.json());
  const text = data?.content?.[0]?.text ?? '';

  // Extract JSON from response (may be wrapped in markdown fences)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
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
    return text ? [{ ...base, type: 'assistant', text }] : [];
  }

  if (obj.type === 'user') {
    const content = obj.message?.content;
    if (!Array.isArray(content)) return [];
    const turns = [];

    for (const block of content) {
      if (block.type === 'text' && block.text?.trim()) {
        turns.push({ ...base, type: 'user', text: block.text.trim() });
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
