#!/usr/bin/env node

/**
 * structural.mjs — Tier 3 structural scanner using lexical pattern matching.
 *
 * Algorithm per JSONL file:
 *   1. Parse the file into conversation turns (text content only).
 *   2. For each assistant turn, test against INSIGHT_PATTERNS.
 *   3. On match, extract a surrounding window (±N turns) and store as
 *      seedType:'insight' in pending_semantic_windows for interactive review.
 *
 * No embedding or external services required. Runs on every --structural scan.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { insertPendingWindow } from '../db.mjs';

// ─── Pattern library ──────────────────────────────────────────────────

/** Lexically stable phrases Claude uses when announcing a breakthrough or root cause. */
export const INSIGHT_PATTERNS = [
  /\bRoot Cause:/i,
  /\bStop\s*[—–-]\s*found/i,
  /\bNow I have the full picture/i,
  /\bThe actual (problem|issue|reason|cause) is/i,
  /\bThe real (issue|problem|cause|constraint) is/i,
  /\bWhat I missed:/i,
  /\bFound the culprit/i,
  /\bThe (key|critical) (realization|insight|distinction) is/i,
  /\bI was wrong (about|—)/i,
  /\bThe correct (way|model|approach) is/i,
];

// ─── File scanner ─────────────────────────────────────────────────────

/**
 * Scan a single JSONL file for insight-announcement phrases in assistant turns.
 * On match, stores a surrounding window as seedType:'insight' for interactive review.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} filePath
 * @param {number} startOffset
 * @param {{ verbose?: boolean, dryRun?: boolean }} [opts]
 * @param {string | null} [projectId]
 * @returns {Promise<{ windowsStored: number, bytesRead: number }>}
 */
export async function patternScanFile(db, filePath, startOffset, opts = {}, projectId = null) {
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

  let windowsStored = 0;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.type !== 'assistant') continue;
    // Skip learning-mode ★ Insight blocks — pedagogical observations, not debugging breakthroughs
    if (turn.text.startsWith('`★ Insight ─')) continue;
    if (!INSIGHT_PATTERNS.some(re => re.test(turn.text))) continue;

    // Capture surrounding context: 3 turns before, up to 6 after the matching turn
    const winStart = Math.max(0, i - 3);
    const winEnd = Math.min(turns.length, i + 7);
    const window = turns.slice(winStart, winEnd);
    const windowText = window.map(t => `[${t.type}] ${t.text}`).join('\n\n');

    if (verbose) {
      process.stderr.write(
        `  [structural] turn ${i}: pattern match — ${dryRun ? 'dry-run' : 'storing'}\n`
      );
    }

    if (!dryRun) {
      const { generateUlid } = await import('../db.mjs');
      insertPendingWindow(db, {
        id: generateUlid(),
        windowText,
        nearestDistance: 0,
        nearestLessonId: null,
        seedType: 'insight',
        projectId,
        filePath,
        windowIndex: i,
      });
    }

    windowsStored++;
    // Skip ahead to avoid overlapping windows from the same insight moment
    i += 6;
  }

  return { windowsStored, bytesRead };
}

// ─── JSONL turn parser ────────────────────────────────────────────────

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
