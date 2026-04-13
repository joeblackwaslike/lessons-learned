#!/usr/bin/env node

/**
 * Tier 1 Structured Scanner: Parses #lesson / #/lesson tags from session JSONL.
 *
 * This is the primary scanner tier. It looks for well-formed #lesson blocks
 * in assistant text content. These blocks are emitted by Claude when the
 * session-start-lesson-protocol.mjs hook is active.
 *
 * Expected tag format:
 *   #lesson
 *   tool: Bash
 *   trigger: pytest -v tests/
 *   problem: pytest hangs due to TTY detection
 *   solution: Use python -m pytest --no-header -rN
 *   tags: lang:python, tool:pytest, severity:hang
 *   #/lesson
 *
 * Exports:
 *   parseLessonTags(text) — extract all #lesson blocks from a text string
 *   scanLineForLessons(jsonLine) — parse a JSONL line and extract any lessons
 */

// ─── Tag parsing ────────────────────────────────────────────────────

/**
 * Regex to match a #lesson ... #/lesson block.
 *
 * Captures everything between the delimiters (non-greedy).
 * Handles optional whitespace and code fences around the delimiters.
 */
const LESSON_BLOCK_RE = /(?:```\s*\n)?#lesson\s*\n([\s\S]*?)#\/lesson\s*(?:\n```)?/g;

/**
 * Parse a single field line like "tool: Bash" → ["tool", "Bash"]
 * Handles multi-word values and trims whitespace.
 */
function parseFieldLine(line) {
  const match = line.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/);
  if (!match) return null;
  return [match[1].toLowerCase(), match[2]];
}

/**
 * Parse all #lesson blocks from a text string.
 *
 * @param {string} text — assistant response text
 * @returns {Array<Object>} — parsed lesson candidates
 *   Each candidate: { tool, trigger, problem, solution, tags, raw }
 */
export function parseLessonTags(text) {
  if (!text || typeof text !== 'string') return [];

  const candidates = [];
  let match;

  // Reset regex state for reuse
  LESSON_BLOCK_RE.lastIndex = 0;

  while ((match = LESSON_BLOCK_RE.exec(text)) !== null) {
    const blockContent = match[1];
    const fields = {};

    for (const line of blockContent.split('\n')) {
      const parsed = parseFieldLine(line);
      if (parsed) {
        fields[parsed[0]] = parsed[1];
      }
    }

    // Require at minimum: problem and solution
    if (!fields.problem || !fields.solution) continue;

    candidates.push({
      tool: fields.tool ?? null,
      trigger: fields.trigger ?? null,
      problem: fields.problem,
      solution: fields.solution,
      tags: fields.tags
        ? fields.tags
            .split(',')
            .map(t => t.trim())
            .filter(Boolean)
        : [],
      raw: match[0],
    });
  }

  return candidates;
}

// ─── JSONL line scanning ────────────────────────────────────────────

/**
 * Scan a single JSONL line for #lesson tags.
 *
 * Fast-path: rejects lines that don't contain "#lesson" before JSON.parse.
 * Only parses assistant messages with text content blocks.
 *
 * @param {string} line — raw JSONL line
 * @returns {Array<Object>} — lesson candidates with session context
 *   Each: { ...candidate, sessionId, messageId, timestamp }
 */
export function scanLineForLessons(line) {
  // Fast rejection: skip lines without the tag marker
  if (!line.includes('#lesson')) return [];

  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return [];
  }

  // Only assistant messages can contain #lesson tags
  if (obj.type !== 'assistant') return [];

  const message = obj.message;
  if (!message?.content || !Array.isArray(message.content)) return [];

  const results = [];

  for (const block of message.content) {
    if (block.type !== 'text' || !block.text) continue;

    const candidates = parseLessonTags(block.text);
    for (const candidate of candidates) {
      results.push({
        ...candidate,
        sessionId: obj.sessionId ?? null,
        messageId: message.id ?? obj.uuid ?? null,
        timestamp: obj.timestamp ?? null,
      });
    }
  }

  return results;
}
