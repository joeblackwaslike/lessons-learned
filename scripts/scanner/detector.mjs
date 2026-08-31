#!/usr/bin/env node

/**
 * Tier 2 Heuristic Detector: Identifies reasoning→correction patterns without #lesson tags.
 *
 * This is the fallback scanner tier. It uses a sliding window over conversation turns
 * to detect sequences where:
 *   1. An assistant makes a reasoning decision (text or thinking turn)
 *   2. The assistant (or user) recognizes the decision was wrong and corrects course
 *   3. The correction is followed by a new action (tool call or explicit fix)
 *
 * The detector targets ASSISTANT REASONING, not tool output. The "problem" source
 * is always the preceding assistant or thinking turn — never raw tool stdout/stderr.
 *
 * The detector does NOT classify or structure lessons — it produces raw
 * "candidate windows" that are passed to the extractor for structuring.
 *
 * Exports:
 *   HeuristicDetector class — stateful detector fed lines one at a time
 */

// ─── Signal patterns ────────────────────────────────────────────────

/**
 * Patterns that suggest the assistant recognized and corrected a mistake.
 * These are the PRIMARY trigger — tested against assistant text turns.
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
 * A candidate window — a sequence of turns that looks like a reasoning-mistake→correction.
 * @typedef {{ turns: Turn[], problemTurnIndex: number, correctionTurnIndex: number, toolContextIndex: number|null, signals: { correctionSignals: string[], userCorrection: boolean, thinkingBlock: boolean }, sessionId: string|null, timestamp: string|null }} CandidateWindow
 */

const WINDOW_SIZE = 8;

// Tools that return file content — their output is excluded as toolContext to avoid noise
const FILE_CONTENT_TOOLS = new Set(['Read', 'Write', 'Edit', 'Glob', 'LS']);

export class HeuristicDetector {
  constructor() {
    /** @type {Turn[]} */
    this.window = [];
    /** @type {CandidateWindow[]} */
    this.candidates = [];
    /** @type {Set<string>} — dedup by correction turn identity */
    this.seenCorrectionIds = new Set();
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
        if (block.type === 'thinking' && block.thinking) {
          turns.push({
            ...base,
            type: 'thinking',
            text: block.thinking,
            toolName: null,
            toolInput: null,
          });
        } else if (block.type === 'text' && block.text) {
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
   * Check the current window for reasoning→correction patterns.
   *
   * Primary trigger: correction signals in assistant turns.
   * Problem source: the nearest preceding assistant or thinking turn (agent reasoning).
   * Tool output is supplementary context only — never the problem source.
   */
  _detectPattern() {
    if (this.window.length < 2) return;

    // Self-correction path: scan for assistant turns with correction signals.
    // Look backward for the nearest preceding reasoning turn as the problem source.
    for (let i = this.window.length - 1; i >= 1; i--) {
      const correctionTurn = this.window[i];
      if (correctionTurn.type !== 'assistant') continue;

      const correctionSignals = this._matchSignals(correctionTurn.text, CORRECTION_SIGNALS);
      if (correctionSignals.length === 0) continue;

      // Dedup by correction turn identity
      const correctionKey = `${correctionTurn.messageId ?? ''}:${correctionTurn.text.slice(0, 50)}`;
      if (this.seenCorrectionIds.has(correctionKey)) continue;

      // Require a subsequent tool_call — confirms behavioral change, not just commentary
      const nextAction = this.window.slice(i + 1).find(t => t.type === 'tool_call');
      if (!nextAction) continue;

      // Find the nearest preceding assistant or thinking turn (the reasoning problem source)
      let problemTurnIdx = -1;
      for (let j = i - 1; j >= 0; j--) {
        if (this.window[j].type === 'assistant' || this.window[j].type === 'thinking') {
          problemTurnIdx = j;
          break;
        }
      }
      if (problemTurnIdx === -1) continue;

      // Find the nearest non-file-content tool_result between problem and correction as context
      let toolContextIdx = null;
      for (let k = i - 1; k > problemTurnIdx; k--) {
        const t = this.window[k];
        if (t.type === 'tool_result' && (!t.toolName || !FILE_CONTENT_TOOLS.has(t.toolName))) {
          toolContextIdx = k;
          break;
        }
      }

      this.seenCorrectionIds.add(correctionKey);
      this.candidates.push({
        turns: this.window.slice(0),
        problemTurnIndex: problemTurnIdx,
        correctionTurnIndex: i,
        toolContextIndex: toolContextIdx,
        signals: {
          correctionSignals,
          userCorrection: false,
          thinkingBlock: this.window[problemTurnIdx].type === 'thinking',
        },
        sessionId: correctionTurn.sessionId,
        timestamp: correctionTurn.timestamp,
      });
    }

    // User correction path: scan for user turns with correction signals.
    // Problem source: nearest preceding reasoning turn.
    // Solution source: the assistant's fix turn immediately after.
    for (let i = 0; i < this.window.length - 1; i++) {
      const userTurn = this.window[i];
      if (userTurn.type !== 'user') continue;

      const userSignals = this._matchSignals(userTurn.text, USER_CORRECTION_SIGNALS);
      if (userSignals.length === 0) continue;

      const fixTurn = this.window[i + 1];
      if (fixTurn?.type !== 'assistant') continue;

      // Dedup by fix turn identity
      const correctionKey = `${fixTurn.messageId ?? ''}:${fixTurn.text.slice(0, 50)}`;
      if (this.seenCorrectionIds.has(correctionKey)) continue;

      // Find the nearest preceding assistant or thinking turn (the reasoning problem source)
      let problemTurnIdx = -1;
      for (let j = i - 1; j >= 0; j--) {
        if (this.window[j].type === 'assistant' || this.window[j].type === 'thinking') {
          problemTurnIdx = j;
          break;
        }
      }
      if (problemTurnIdx === -1) continue;

      // Find the nearest non-file-content tool_result between problem and user correction
      let toolContextIdx = null;
      for (let k = i - 1; k > problemTurnIdx; k--) {
        const t = this.window[k];
        if (t.type === 'tool_result' && (!t.toolName || !FILE_CONTENT_TOOLS.has(t.toolName))) {
          toolContextIdx = k;
          break;
        }
      }

      this.seenCorrectionIds.add(correctionKey);
      this.candidates.push({
        turns: this.window.slice(0),
        problemTurnIndex: problemTurnIdx,
        correctionTurnIndex: i + 1, // the assistant fix turn, not the user complaint
        toolContextIndex: toolContextIdx,
        signals: {
          correctionSignals: userSignals,
          userCorrection: true,
          thinkingBlock: this.window[problemTurnIdx].type === 'thinking',
        },
        sessionId: userTurn.sessionId,
        timestamp: userTurn.timestamp,
      });
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
