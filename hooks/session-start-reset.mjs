#!/usr/bin/env node

/**
 * SessionStart hook: Manages dedup state across session lifecycle events.
 *
 * - startup/resume: no-op (preserve existing dedup state)
 * - clear: wipe ALL dedup state for this session
 * - compact: clear dedup for high-priority lessons (allow re-injection after context loss)
 *
 * Dedup state lives in 3 layers:
 *   1. Env var (LESSONS_SEEN) — reset via env output
 *   2. Session temp file ($TMPDIR/lessons-<hash>-seen.txt)
 *   3. O_EXCL claim directory ($TMPDIR/lessons-<hash>-seen.d/)
 *
 * stdin: JSON with { hook_event_name, session_id }
 * stdout: raw text (empty for no-op, or JSON env reset)
 */

import { readFileSync, readdirSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CONTEXT_CLEARING_EVENTS = new Set(['clear', 'compact']);

function sessionHash(sessionId) {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 16);
}

function dedupPaths(sessionId) {
  const hash = sessionHash(sessionId);
  const tmp = tmpdir();
  return {
    seenFile: join(tmp, `lessons-${hash}-seen.txt`),
    claimDir: join(tmp, `lessons-${hash}-seen.d`),
  };
}

function clearAllDedupState(sessionId) {
  const { seenFile, claimDir } = dedupPaths(sessionId);
  let removedFiles = 0;

  // Remove session seen file
  try {
    if (existsSync(seenFile)) {
      unlinkSync(seenFile);
      removedFiles++;
    }
  } catch {
    /* ignore */
  }

  // Remove all claim files and the directory
  try {
    if (existsSync(claimDir)) {
      for (const file of readdirSync(claimDir)) {
        try {
          unlinkSync(join(claimDir, file));
          removedFiles++;
        } catch {
          /* ignore */
        }
      }
      rmdirSync(claimDir);
    }
  } catch {
    /* ignore */
  }

  return removedFiles;
}

function clearHighPriorityDedupState(sessionId) {
  // On compact, we want to allow re-injection of high-priority lessons
  // that Claude may have forgotten. We do this by reading the manifest
  // to find high-priority lesson slugs, then removing their claim files.
  //
  // For now (Phase 0), we take a simpler approach: clear ALL dedup state
  // on compact. This is slightly aggressive but ensures no important
  // lessons are lost after compaction. We'll refine this in Phase 2
  // when the manifest is available.
  return clearAllDedupState(sessionId);
}

function main() {
  let input = null;
  try {
    const raw = readFileSync(0, 'utf8');
    if (raw.trim()) {
      input = JSON.parse(raw);
    }
  } catch {
    return; // Can't determine event without input
  }

  const hookEvent = input?.hook_event_name ?? '';
  const sessionId = input?.session_id ?? '';

  if (!sessionId || !CONTEXT_CLEARING_EVENTS.has(hookEvent)) {
    return; // startup/resume — no-op
  }

  if (hookEvent === 'clear') {
    clearAllDedupState(sessionId);
  } else if (hookEvent === 'compact') {
    clearHighPriorityDedupState(sessionId);
  }

  // Reset the env var layer — empty string clears the accumulator
  // Note: for SessionStart hooks, env reset is NOT via JSON stdout.
  // We rely on the claim dir and seen file being cleared; the env var
  // will naturally reset since Claude Code doesn't carry it across compaction.
}

main();
