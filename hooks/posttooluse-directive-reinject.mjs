#!/usr/bin/env node

/**
 * PostToolUse hook: Re-injects directives and protocols at token-budget thresholds.
 *
 * Directives and protocols injected at session start lose Claude's attention as context
 * fills. This hook fires at 30%, 52%, and 70% usage to refresh them before quality degrades.
 *
 * Context % source (tried in order):
 *   1. input.context_window.used_percentage (PostToolUse stdin field)
 *   2. Parse transcript JSONL for `Token usage: X/Y` entries
 *   3. Fallback: fire every N tool calls (configurable, default 20)
 *
 * State: $TMPDIR/lessons-<hash>-reinject.json → { fired: [30], toolCount: 7 }
 *
 * stdin: JSON with { session_id, tool_name, tool_input, tool_response, transcript_path, context_window? }
 * stdout: raw text injected as context (empty string = no-op)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { groupByTag } from './lib/session-start.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH =
  process.env.LESSONS_MANIFEST_PATH ?? join(__dirname, '..', 'data', 'lesson-manifest.json');

const DEFAULT_THRESHOLDS = [30, 52, 70];
const DEFAULT_TOOL_COUNT_INTERVAL = 20;
const DEFAULT_FIRE_CAP = 3;

function sessionHash(sessionId) {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 16);
}

function reinjectStatePath(sessionId) {
  return join(tmpdir(), `lessons-${sessionHash(sessionId)}-reinject.json`);
}

function loadState(sessionId) {
  try {
    return JSON.parse(readFileSync(reinjectStatePath(sessionId), 'utf8'));
  } catch {
    return { fired: [], toolCount: 0, totalFired: 0 };
  }
}

function saveState(sessionId, state) {
  try {
    writeFileSync(reinjectStatePath(sessionId), JSON.stringify(state));
  } catch {
    // temp dir write failure — non-fatal, will just re-fire thresholds next call
  }
}

/** Layer 1: context_window.used_percentage from PostToolUse stdin */
function percentageFromInput(input) {
  const pct = input?.context_window?.used_percentage;
  return typeof pct === 'number' ? pct : null;
}

const MODEL_CONTEXT_LIMITS = { default: 200_000 };

function contextLimitForModel(modelId) {
  return MODEL_CONTEXT_LIMITS[modelId] ?? MODEL_CONTEXT_LIMITS.default;
}

/** Layer 2: parse transcript JSONL for the most recent assistant message usage block */
function percentageFromTranscript(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  try {
    const lines = readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        const usage = entry?.message?.usage;
        if (usage && entry?.message?.role === 'assistant') {
          const total =
            (usage.input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0);
          const limit = contextLimitForModel(entry?.message?.model);
          if (total > 0 && limit > 0) return (total / limit) * 100;
        }
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function buildOutput(manifest, projectId = null) {
  const cfg = manifest.config ?? {};
  const ssMaxLessons = cfg.maxSessionStartLessons ?? 20;
  const ssMaxBytes = cfg.sessionStartBudgetBytes ?? 8192;

  const allLessons = Object.values(manifest.lessons).filter(
    l =>
      (l.type === 'directive' || l.type === 'protocol') &&
      !l.disabled &&
      (l.scope == null || l.scope === projectId)
  );

  const allSorted = allLessons.slice().sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5));
  let ssBytesUsed = 0;
  const ssSelected = [];
  for (const lesson of allSorted) {
    if (ssSelected.length >= ssMaxLessons) break;
    const lessonBytes =
      (lesson.summary || '').length +
      (lesson.problem || '').length +
      (lesson.solution || '').length;
    if (ssBytesUsed + lessonBytes > ssMaxBytes) continue;
    ssSelected.push(lesson);
    ssBytesUsed += lessonBytes;
  }

  const directives = ssSelected
    .filter(l => l.type === 'directive')
    .sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5));
  const protocols = ssSelected
    .filter(l => l.type === 'protocol')
    .sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5));

  if (directives.length === 0 && protocols.length === 0) return '';

  let out = '## [lessons-learned] Directive & Protocol Refresh\n\n';
  out += '_Context budget approaching — re-injecting active directives and protocols._\n';

  if (directives.length > 0) {
    out += '\n\n### Non-Negotiable Directives\n\n';
    out += '<IMPORTANT>\n';
    out +=
      'These are non-negotiable rules derived from real failures. Applying them is not optional.\n';
    out += '</IMPORTANT>\n';
    const groups = groupByTag(directives);
    for (const [tag, group] of groups) {
      if (groups.length > 1) out += `\n#### ${tag}\n`;
      for (const l of group) out += `\n${l.message}\n`;
    }
  }

  if (protocols.length > 0) {
    out += '\n\n### Active Protocols\n\n';
    const groups = groupByTag(protocols);
    for (const [tag, group] of groups) {
      if (groups.length > 1) out += `\n#### ${tag}\n`;
      for (const l of group) out += `\n${l.message}\n`;
    }
  }

  return out;
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return;
  }

  const sessionId = input?.session_id;
  if (!sessionId) return;

  const cwd = input?.cwd ?? '';
  const projectId = cwd ? cwd.replace(/\//g, '-').replace(/^-/, '') : null;

  const thresholds = process.env.LESSONS_REINJECT_THRESHOLDS
    ? process.env.LESSONS_REINJECT_THRESHOLDS.split(',').map(Number).filter(isFinite)
    : DEFAULT_THRESHOLDS;
  const toolCountInterval = process.env.LESSONS_REINJECT_TOOL_COUNT
    ? parseInt(process.env.LESSONS_REINJECT_TOOL_COUNT, 10)
    : DEFAULT_TOOL_COUNT_INTERVAL;
  const fireCap = process.env.LESSONS_REINJECT_FIRE_CAP
    ? parseInt(process.env.LESSONS_REINJECT_FIRE_CAP, 10)
    : DEFAULT_FIRE_CAP;

  const state = loadState(sessionId);
  state.toolCount = (state.toolCount ?? 0) + 1;

  // Determine current context %
  let pct = percentageFromInput(input);
  if (pct === null) pct = percentageFromTranscript(input?.transcript_path);

  let shouldFire = false;

  if (pct !== null) {
    // Threshold-based: find the highest threshold that has been crossed but not yet fired
    const nextThreshold = thresholds.find(t => pct >= t && !(state.fired ?? []).includes(t));
    if (nextThreshold !== undefined && (state.totalFired ?? 0) < fireCap) {
      state.fired = [...(state.fired ?? []), nextThreshold];
      state.totalFired = (state.totalFired ?? 0) + 1;
      shouldFire = true;
    }
  } else {
    // Tool-count fallback: fire every N calls
    if (state.toolCount % toolCountInterval === 0 && (state.totalFired ?? 0) < fireCap) {
      state.totalFired = (state.totalFired ?? 0) + 1;
      shouldFire = true;
    }
  }

  saveState(sessionId, state);

  if (!shouldFire) return;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return;
  }

  const output = buildOutput(manifest, projectId);
  if (output) process.stdout.write(output);
}

main();
