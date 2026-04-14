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
 * Cancellation tag format (emitted by /lessons:cancel to suppress a lesson):
 *   #lesson:cancel
 *   problem: first ~60 chars of the problem field to cancel
 *   #/lesson:cancel
 *
 * Exports:
 *   parseLessonTags(text) — extract all #lesson blocks from a text string
 *   parseCancelTags(text) — extract all #lesson:cancel blocks from a text string
 *   scanLineForLessons(jsonLine) — parse a JSONL line and extract lessons + cancels
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
 * Regex to match a #lesson:cancel ... #/lesson:cancel block.
 */
const CANCEL_BLOCK_RE = /(?:```\s*\n)?#lesson:cancel\s*\n([\s\S]*?)#\/lesson:cancel\s*(?:\n```)?/g;

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
      tool: fields.tool?.trim() || null,
      trigger: fields.trigger?.trim() || null,
      problem: fields.problem,
      solution: fields.solution,
      tags: fields.tags
        ? fields.tags
            .split(',')
            .map(t => t.trim())
            .filter(Boolean)
        : [],
      scope: fields.scope?.trim() || null,
      raw: match[0],
    });
  }

  return candidates;
}

/**
 * Parse all #lesson:cancel blocks from a text string.
 *
 * A cancel block identifies a lesson to suppress by the first ~60 chars of
 * its problem text. The scanner uses these to skip matching candidates.
 *
 * @param {string} text — assistant response text
 * @returns {Array<string>} — problem prefixes to cancel (lowercased, trimmed)
 */
export function parseCancelTags(text) {
  if (!text || typeof text !== 'string') return [];

  const cancels = [];
  let match;

  CANCEL_BLOCK_RE.lastIndex = 0;

  while ((match = CANCEL_BLOCK_RE.exec(text)) !== null) {
    const blockContent = match[1];
    for (const line of blockContent.split('\n')) {
      const parsed = parseFieldLine(line);
      if (parsed && parsed[0] === 'problem') {
        cancels.push(parsed[1].toLowerCase().trim());
      }
    }
  }

  return cancels;
}

// ─── JSONL line scanning ────────────────────────────────────────────

/**
 * Scan a single JSONL line for #lesson and #lesson:cancel tags.
 *
 * Fast-path: rejects lines that don't contain "#lesson" before JSON.parse.
 * Only parses assistant messages with text content blocks.
 *
 * @param {string} line — raw JSONL line
 * @returns {{ lessons: Array<Object>, cancels: Array<string> }}
 *   lessons: candidates with session context — { ...candidate, sessionId, messageId, timestamp }
 *   cancels: problem prefixes from any #lesson:cancel blocks in this line
 */
export function scanLineForLessons(line) {
  // Fast rejection: skip lines without the tag marker
  if (!line.includes('#lesson')) return { lessons: [], cancels: [] };

  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return { lessons: [], cancels: [] };
  }

  // Only assistant messages can contain #lesson tags
  if (obj.type !== 'assistant') return { lessons: [], cancels: [] };

  const message = obj.message;
  if (!message?.content || !Array.isArray(message.content)) return { lessons: [], cancels: [] };

  const lessons = [];
  const cancels = [];

  for (const block of message.content) {
    if (block.type !== 'text' || !block.text) continue;

    for (const candidate of parseLessonTags(block.text)) {
      lessons.push({
        ...candidate,
        sessionId: obj.sessionId ?? null,
        messageId: message.id ?? obj.uuid ?? null,
        timestamp: obj.timestamp ?? null,
      });
    }

    for (const cancelPrefix of parseCancelTags(block.text)) {
      cancels.push(cancelPrefix);
    }
  }

  return { lessons, cancels };
}
