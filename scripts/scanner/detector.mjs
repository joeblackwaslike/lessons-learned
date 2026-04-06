#!/usr/bin/env node

/**
 * Tier 2 Heuristic Detector: Identifies error→correction patterns without #lesson tags.
 *
 * This is the fallback scanner tier. It uses a sliding window over conversation turns
 * to detect sequences where:
 *   1. An assistant makes a tool call
 *   2. The tool result or next exchange reveals a failure (error, hang, retry)
 *   3. The assistant corrects course (different command, fix applied)
 *
 * The detector does NOT classify or structure lessons — it produces raw
 * "candidate windows" that are passed to the extractor for structuring.
 *
 * Exports:
 *   HeuristicDetector class — stateful detector fed lines one at a time
 */

// ─── Signal patterns ────────────────────────────────────────────────

/**
 * Patterns that suggest an error or failure occurred.
 * Tested against tool results, user messages, and assistant text.
 */
const ERROR_SIGNALS = [
  /\bError\b/i,
  /\bTraceback\b/,
  /\bexception\b/i,
  /\bcommand\s+(?:failed|not found)\b/i,
  /\bprocess\s+(?:exited|failed|killed)\b/i,
  /\btimeout\b/i,
  /\bhang(?:s|ing|ed)?\b/i,
  /\bcommand not found\b/i,
  /\bNo such file or directory\b/,
  /\bPermission denied\b/,
  /\bEACCES\b/,
  /\bENOENT\b/,
  /\bsyntax error\b/i,
  /\bSegmentation fault\b/,
  /\bkilled\b/i,
  /\bOOM\b/,
  /exit code [1-9]\d*/,
  /\bnon-zero exit\b/i,
];

/**
 * Patterns that suggest the assistant recognized and corrected a mistake.
 * Tested against assistant text following an error.
 */
const CORRECTION_SIGNALS = [
  /\bI see the (?:issue|problem|error)\b/i,
  /\bthe (?:issue|problem) (?:is|was)\b/i,
  /\blet me (?:try|fix|correct|update)\b/i,
  /\binstead,?\s+(?:I|we|let)\b/i,
  /\bactually,?\s/i,
  /\bmy mistake\b/i,
  /\bthat (?:was|is) (?:wrong|incorrect)\b/i,
  /\bshould (?:have|be) using\b/i,
  /\bthe (?:correct|right|proper) (?:way|approach|command)\b/i,
  /\bhere'?s the fix\b/i,
  /\broot cause\b/i,
  /\bbecause\b.*\bfail/i,
];

/**
 * Patterns that suggest a user correction (not positive feedback).
 * These must be negatively-valenced to avoid matching "Perfect!" or "Great work!".
 */
const USER_CORRECTION_SIGNALS = [
  /\bno[,.]?\s+(?:that'?s|it'?s|you)\b/i,
  /\bthat'?s (?:wrong|incorrect|not right|not correct|not what)\b/i,
  /\bdon'?t\s+(?:do|use|run)\b/i,
  /\bstop\s+(?:doing|using|running)\b/i,
  /\byou (?:should(?:n'?t| not)|need to|have to)\b/i,
  /\binstead\s+(?:of\s+that,?\s+)?(?:use|do|try)\b/i,
  /\bthat (?:broke|crashed|failed|hung)\b/i,
];

// ─── Sliding window detector ───────────────────────────────────────

/**
 * A turn in the conversation window.
 * @typedef {{ type: string, text: string, toolName?: string, toolInput?: object, timestamp?: string, sessionId?: string, messageId?: string }} Turn
 */

/**
 * A candidate window — a sequence of turns that looks like a mistake→correction.
 * @typedef {{ turns: Turn[], errorTurnIndex: number, correctionTurnIndex: number, signals: { errorSignals: string[], correctionSignals: string[], userCorrection: boolean }, sessionId: string|null, timestamp: string|null }} CandidateWindow
 */

const WINDOW_SIZE = 8;

// Tools that return file content, not runtime output — errors here are false positives
const FILE_CONTENT_TOOLS = new Set(['Read', 'Write', 'Edit', 'Glob', 'LS']);

export class HeuristicDetector {
  constructor() {
    /** @type {Turn[]} */
    this.window = [];
    /** @type {CandidateWindow[]} */
    this.candidates = [];
    /** @type {Set<string>} — dedup by error turn messageId */
    this.seenErrorIds = new Set();
    /** @type {Map<string, string>} — tool_use_id → tool name, for annotating tool_result turns */
    this.toolUseIdToName = new Map();
  }

  /**
   * Feed a JSONL line to the detector.
   *
   * @param {string} line — raw JSONL line
   */
  feedLine(line) {
    // Fast rejection: only parse lines that could be conversation turns
    if (!line.includes('"type"')) return;

    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return;
    }

    const turns = this._extractTurns(obj);
    for (const turn of turns) {
      this.window.push(turn);
      if (this.window.length > WINDOW_SIZE) {
        this.window.shift();
      }
      this._detectPattern();
    }
  }

  /**
   * Extract conversation turns from a JSONL object.
   *
   * @param {object} obj — parsed JSONL object
   * @returns {Turn[]}
   */
  _extractTurns(obj) {
    const base = {
      timestamp: obj.timestamp ?? null,
      sessionId: obj.sessionId ?? null,
      messageId: obj.message?.id ?? obj.uuid ?? null,
    };

    if (obj.type === 'assistant') {
      const content = obj.message?.content;
      if (!Array.isArray(content)) return [];

      const turns = [];
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          turns.push({ ...base, type: 'assistant', text: block.text });
        } else if (block.type === 'tool_use') {
          const toolName = block.name ?? null;
          // Track id → name so tool_result turns can carry the originating tool name
          if (block.id && toolName) this.toolUseIdToName.set(block.id, toolName);
          turns.push({
            ...base,
            type: 'tool_call',
            text: JSON.stringify(block.input ?? {}),
            toolName,
            toolInput: block.input ?? {},
          });
        }
      }
      return turns;
    }

    if (obj.type === 'user') {
      const content = obj.message?.content;
      if (!Array.isArray(content)) return [];

      const turns = [];
      const userTexts = [];
      const toolResultTexts = [];

      for (const block of content) {
        if (block.type === 'text' && block.text) {
          userTexts.push(block.text);
        } else if (block.type === 'tool_result') {
          const toolName = this.toolUseIdToName.get(block.tool_use_id) ?? null;
          let text = '';
          if (typeof block.content === 'string') {
            text = block.content;
          } else if (Array.isArray(block.content)) {
            text = block.content
              .filter(s => s.type === 'text')
              .map(s => s.text)
              .join('\n');
          }
          if (text) toolResultTexts.push({ text, toolName });
        }
      }

      // Tool results as separate turns — each carries its originating tool name
      for (const { text, toolName } of toolResultTexts) {
        turns.push({ ...base, type: 'tool_result', text, toolName });
      }
      // User text as a separate turn (for correction detection)
      if (userTexts.length > 0) {
        turns.push({ ...base, type: 'user', text: userTexts.join('\n') });
      }
      return turns;
    }

    // Progress events with tool results
    if (obj.type === 'progress' && obj.data?.content) {
      const text =
        typeof obj.data.content === 'string' ? obj.data.content : JSON.stringify(obj.data.content);
      return [{ ...base, type: 'tool_result', text }];
    }

    return [];
  }

  /**
   * Check the current window for error→correction patterns.
   */
  _detectPattern() {
    if (this.window.length < 2) return;

    // Look for error signals in tool results and progress events (not user/assistant text)
    for (let i = 0; i < this.window.length - 1; i++) {
      const turn = this.window[i];

      // Skip file-content tools — their output is source code, not runtime errors
      // Unknown tool name (null) is allowed through — MCP tools and other runtime tools should be checked
      if (turn.type !== 'tool_result') continue;
      if (turn.toolName && FILE_CONTENT_TOOLS.has(turn.toolName)) continue;

      const errorSignals = this._matchSignals(turn.text, ERROR_SIGNALS);
      if (errorSignals.length === 0) continue;

      // Dedup: skip if we already reported a candidate for this error
      const errorKey = `${turn.messageId ?? ''}:${i}:${turn.text.slice(0, 50)}`;
      if (this.seenErrorIds.has(errorKey)) continue;

      // Look for correction signals in subsequent turns
      for (let j = i + 1; j < this.window.length; j++) {
        const later = this.window[j];

        // Check for assistant self-correction followed by a new tool call
        if (later.type === 'assistant') {
          const correctionSignals = this._matchSignals(later.text, CORRECTION_SIGNALS);
          if (correctionSignals.length > 0) {
            // Require a subsequent tool_call to confirm behavioral change, not just explanation
            const nextAction = this.window.slice(j + 1).find(t => t.type === 'tool_call');
            if (!nextAction) break;

            this.seenErrorIds.add(errorKey);
            this.candidates.push({
              turns: this.window.slice(Math.max(0, i - 1), Math.min(this.window.length, j + 2)),
              errorTurnIndex: i - Math.max(0, i - 1),
              correctionTurnIndex: j - Math.max(0, i - 1),
              signals: {
                errorSignals,
                correctionSignals,
                userCorrection: false,
              },
              sessionId: turn.sessionId,
              timestamp: turn.timestamp,
            });
            break;
          }
        }

        // Check for user correction followed by assistant fix
        if (later.type === 'user') {
          const userSignals = this._matchSignals(later.text, USER_CORRECTION_SIGNALS);
          if (userSignals.length > 0) {
            // Look one more turn ahead for the assistant's fix
            const fixTurn = this.window[j + 1];
            if (fixTurn?.type === 'assistant') {
              this.seenErrorIds.add(errorKey);
              this.candidates.push({
                turns: this.window.slice(Math.max(0, i - 1), Math.min(this.window.length, j + 3)),
                errorTurnIndex: i - Math.max(0, i - 1),
                correctionTurnIndex: j + 1 - Math.max(0, i - 1),
                signals: {
                  errorSignals,
                  correctionSignals: userSignals,
                  userCorrection: true,
                },
                sessionId: turn.sessionId,
                timestamp: turn.timestamp,
              });
              break;
            }
          }
        }
      }
    }
  }

  /**
   * Test text against signal patterns and return matched pattern descriptions.
   *
   * @param {string} text
   * @param {RegExp[]} patterns
   * @returns {string[]} — matched pattern source strings
   */
  _matchSignals(text, patterns) {
    if (!text) return [];
    const matched = [];
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        matched.push(pattern.source);
      }
    }
    return matched;
  }

  /**
   * Get all detected candidates and reset.
   *
   * @returns {CandidateWindow[]}
   */
  flush() {
    const result = this.candidates;
    this.candidates = [];
    return result;
  }
}
