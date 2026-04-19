#!/usr/bin/env node

/**
 * Candidate Extractor: Converts raw scanner output into lesson candidates.
 *
 * Both Tier 1 (structured #lesson tags) and Tier 2 (heuristic windows) produce
 * different shapes. This module normalizes them into a unified LessonCandidate
 * format that can be reviewed, scored, and optionally added to the store.
 *
 * Exports:
 *   extractFromStructured(tagResult) — normalize a Tier 1 parsed tag
 *   extractFromHeuristic(candidateWindow) — normalize a Tier 2 candidate window
 *   scoreCandidateConfidence(candidate) — compute initial confidence score
 *   scoreCandidatePriority(candidate) — compute initial priority score
 */

import { createHash } from 'node:crypto';

// ─── Candidate normalization ────────────────────────────────────────

/**
 * @typedef {{
 *   source: 'structured' | 'heuristic',
 *   tool: string|null,
 *   trigger: string|null,
 *   problem: string,
 *   solution: string,
 *   tags: string[],
 *   sessionId: string|null,
 *   messageId: string|null,
 *   timestamp: string|null,
 *   confidence: number,
 *   priority: number,
 *   needsReview: boolean,
 *   contentHash: string,
 *   signals: object
 * }} LessonCandidate
 */

/**
 * Normalize a Tier 1 structured tag result into a LessonCandidate.
 *
 * @param {object} tag — output from parseLessonTags / scanLineForLessons
 * @returns {LessonCandidate}
 */
export function extractFromStructured(tag) {
  /** @type {LessonCandidate} */
  const candidate = {
    source: 'structured',
    tool: tag.tool ?? null,
    trigger: tag.trigger ?? null,
    problem: tag.problem,
    solution: tag.solution,
    tags: tag.tags ?? [],
    sessionId: tag.sessionId ?? null,
    messageId: tag.messageId ?? null,
    timestamp: tag.timestamp ?? null,
    confidence: 0,
    priority: 0,
    needsReview: true,
    contentHash: '',
    signals: { source: 'structured' },
  };

  candidate.contentHash = computeContentHash(candidate);
  candidate.confidence = scoreCandidateConfidence(candidate);
  candidate.priority = scoreCandidatePriority(candidate);
  candidate.needsReview = candidate.confidence < 0.7;

  return candidate;
}

/**
 * Normalize a Tier 2 heuristic candidate window into a LessonCandidate.
 *
 * Heuristic candidates have less structure — we extract what we can from
 * the turns and signal patterns.
 *
 * @param {object} window — output from HeuristicDetector.flush()
 * @returns {LessonCandidate}
 */
export function extractFromHeuristic(window) {
  const errorTurn = window.turns[window.errorTurnIndex];
  const correctionTurn = window.turns[window.correctionTurnIndex];

  // Use the tool that produced the error (from tool_result toolName), not the first tool in the window
  let tool = errorTurn?.toolName ?? null;
  let trigger = null;

  // Find the tool_call immediately before the error turn to get the trigger command/path
  for (let i = window.errorTurnIndex - 1; i >= 0; i--) {
    const t = window.turns[i];
    if (t.type === 'tool_call' && (t.toolName === tool || !tool)) {
      tool = tool ?? t.toolName;
      if (t.toolInput?.command) trigger = t.toolInput.command;
      else if (t.toolInput?.file_path) trigger = t.toolInput.file_path;
      break;
    }
  }

  // Extract problem and solution text from the error and correction turns
  const problem = errorTurn?.text?.slice(0, 1500) ?? 'Unknown error';
  const solution = correctionTurn?.text?.slice(0, 1500) ?? 'See correction';

  /** @type {LessonCandidate} */
  const candidate = {
    source: 'heuristic',
    tool,
    trigger,
    problem,
    solution,
    tags: inferTags(tool, trigger, window.signals),
    sessionId: window.sessionId ?? null,
    messageId: errorTurn?.messageId ?? null,
    timestamp: window.timestamp ?? null,
    confidence: 0,
    priority: 0,
    needsReview: true,
    contentHash: '',
    signals: window.signals,
  };

  candidate.contentHash = computeContentHash(candidate);
  candidate.confidence = scoreCandidateConfidence(candidate);
  candidate.priority = scoreCandidatePriority(candidate);
  // Heuristic candidates always need review
  candidate.needsReview = true;

  return candidate;
}

// ─── Scoring ────────────────────────────────────────────────────────

/**
 * Compute initial confidence score for a candidate.
 *
 * Structured tags get higher base confidence because they were explicitly
 * emitted by the assistant.
 *
 * @param {object} candidate
 * @returns {number} — 0.0 to 1.0
 */
export function scoreCandidateConfidence(candidate) {
  let confidence = candidate.source === 'structured' ? 0.6 : 0.4;

  // Structured source bonuses
  if (candidate.source === 'structured') {
    // Has all fields filled
    if (candidate.tool && candidate.trigger && candidate.tags.length > 0) {
      confidence += 0.15;
    }
    // Has tags with category:value format
    if (candidate.tags.some(t => t.includes(':'))) {
      confidence += 0.05;
    }
  }

  // Heuristic source bonuses
  if (candidate.source === 'heuristic') {
    const signals = candidate.signals;
    // User correction is a strong signal
    if (signals?.userCorrection) {
      confidence += 0.15;
    }
    // Multiple error signals = clearer pattern
    if (signals?.errorSignals?.length >= 2) {
      confidence += 0.1;
    }
    // Multiple correction signals
    if (signals?.correctionSignals?.length >= 2) {
      confidence += 0.05;
    }
  }

  return Math.min(1.0, Math.max(0.0, confidence));
}

/**
 * Compute initial priority score for a candidate.
 *
 * Single-session candidates start low. Priority increases when patterns
 * are seen across sessions/projects (handled at aggregation time, not here).
 *
 * @param {object} candidate
 * @returns {number} — 1 to 10
 */
export function scoreCandidatePriority(candidate) {
  let priority = 3; // base for auto-discovered

  // Severity bonuses
  const tags = candidate.tags;
  if (tags.some(t => t.includes('severity:hang') || t.includes('severity:timeout'))) {
    priority += 1;
  }
  if (tags.some(t => t.includes('severity:data-loss') || t.includes('severity:silent'))) {
    priority += 1;
  }

  // User correction bonus
  if (candidate.signals?.userCorrection) {
    priority += 1;
  }

  // Penalty for single occurrence (unknown at scan time, but mark the baseline)
  // This will be adjusted during aggregation

  return Math.min(10, Math.max(1, priority));
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Compute a content hash for deduplication.
 */
function computeContentHash(candidate) {
  const data = `${candidate.problem}|${candidate.solution}|${candidate.trigger ?? ''}`;
  return 'sha256:' + createHash('sha256').update(data).digest('hex');
}

/**
 * Infer tags from tool name, trigger, and signals.
 */
function inferTags(tool, trigger, signals) {
  const tags = [];

  // Tool tag
  if (tool) {
    const toolLower = tool.toLowerCase();
    if (toolLower === 'bash' && trigger) {
      // Try to identify the actual CLI tool
      const firstWord = trigger.trim().split(/\s+/)[0];
      if (firstWord) tags.push(`tool:${firstWord}`);
    }
  }

  // Language detection from trigger/error text
  if (trigger) {
    if (/\bpython|pip|pytest|django|flask\b/i.test(trigger)) tags.push('lang:python');
    if (/\bnode|npm|npx|yarn|pnpm\b/i.test(trigger)) tags.push('lang:javascript');
    if (/\bruby|gem|rake|bundle\b/i.test(trigger)) tags.push('lang:ruby');
    if (/\bgo\s+(?:build|test|run|get)\b/i.test(trigger)) tags.push('lang:go');
    if (/\bcargo|rustc\b/i.test(trigger)) tags.push('lang:rust');
  }

  // Severity from error signals
  if (signals?.errorSignals) {
    const joined = signals.errorSignals.join(' ');
    if (/hang|timeout/i.test(joined)) tags.push('severity:hang');
    if (/OOM|killed/i.test(joined)) tags.push('severity:crash');
  }

  return [...new Set(tags)];
}
