/**
 * 3-Layer dedup system for lesson injection.
 *
 * Layer 1: Environment variable (LESSONS_SEEN) — fast within a single agent chain
 * Layer 2: Session temp file — cross-agent persistence
 * Layer 3: O_EXCL claim directory — atomic concurrent dedup
 *
 * Merge: seen = union(envVar, sessionFile, claimDir)
 */

import {
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  readdirSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

/**
 * Merge all 3 dedup layers into a single Set of seen lesson slugs.
 */
export function loadSeenSet(sessionId) {
  const seen = new Set();

  // Layer 1: env var
  const envSeen = process.env.LESSONS_SEEN ?? '';
  if (envSeen) {
    for (const id of envSeen.split(',')) {
      const trimmed = id.trim();
      if (trimmed) seen.add(trimmed);
    }
  }

  const { seenFile, claimDir } = dedupPaths(sessionId);

  // Layer 2: session temp file
  try {
    const content = readFileSync(seenFile, 'utf8');
    for (const id of content.split(',')) {
      const trimmed = id.trim();
      if (trimmed) seen.add(trimmed);
    }
  } catch {
    // File doesn't exist yet — that's fine
  }

  // Layer 3: claim directory entries
  try {
    if (existsSync(claimDir)) {
      for (const file of readdirSync(claimDir)) {
        seen.add(file);
      }
    }
  } catch {
    // Directory doesn't exist yet — that's fine
  }

  return seen;
}

/**
 * Atomically claim a lesson slug. Returns true if this invocation won the claim.
 * Returns false if another agent/invocation already claimed it.
 */
export function claimLesson(sessionId, slug) {
  const { claimDir } = dedupPaths(sessionId);

  // Ensure claim directory exists
  try {
    mkdirSync(claimDir, { recursive: true });
  } catch {
    // Already exists — fine
  }

  try {
    // O_EXCL: fail if file already exists — atomic claim
    const fd = openSync(join(claimDir, slug), 'wx');
    closeSync(fd);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') {
      return false; // Another agent already claimed it
    }
    // Unexpected error — treat as claimed to avoid duplicate injection
    return false;
  }
}

/**
 * Persist the full set of seen lesson slugs to the session temp file
 * and return the env var value for the next invocation.
 */
export function persistSeenState(sessionId, seenSet) {
  const slugs = [...seenSet].join(',');

  // Update Layer 2: session temp file
  const { seenFile } = dedupPaths(sessionId);
  try {
    writeFileSync(seenFile, slugs, 'utf8');
  } catch {
    // Best-effort — claim dir provides the atomic guarantee
  }

  return slugs;
}
