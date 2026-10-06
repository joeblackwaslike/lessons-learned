/**
 * hooks/lib/model.mjs — Runtime model identity detection for lesson scope filtering.
 *
 * Detection chain (first non-null wins):
 *   1. LESSONS_LEARNED_MODEL env var — explicit override, skip cache
 *   2. /tmp/ll-model-<sessionId>.txt — cached from a prior call this session
 *   3. Session JSONL scan — reads first 30 lines, stops on first entry with "model" key
 *   4. ~/.claude/settings.json "model" field — configured default
 *   5. null — unknown; callers should fire the lesson anyway (safe default)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Derive the project ID from a cwd path, matching ~/.claude/projects/<folder> naming.
 * @param {string} cwd
 * @returns {string}
 */
function cwdToProjectId(cwd) {
  return cwd.replace(/\//g, '-').replace(/^-/, '');
}

/**
 * Detect the running model from env override, session cache, JSONL, or settings.
 *
 * @param {string|null} sessionId
 * @param {string|null} cwd
 * @returns {string|null}
 */
export function detectModel(sessionId, cwd) {
  // 1. Explicit override — highest priority, skip cache write
  if (process.env.LESSONS_LEARNED_MODEL) return process.env.LESSONS_LEARNED_MODEL;

  if (!sessionId) return null;

  const cacheFile = `/tmp/ll-model-${sessionId}.txt`;

  // 2. Cache hit
  try {
    const cached = readFileSync(cacheFile, 'utf8').trim();
    if (cached) return cached;
  } catch {
    // cache miss — continue
  }

  // 3. Session JSONL scan
  const model = scanSessionJsonl(sessionId, cwd);
  if (model) {
    try {
      writeFileSync(cacheFile, model, 'utf8');
    } catch {
      // non-fatal — cache write failure degrades to re-scanning next call
    }
    return model;
  }

  // 4. ~/.claude/settings.json configured default
  try {
    const settings = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8'));
    if (settings.model && typeof settings.model === 'string') return settings.model;
  } catch {
    // not present or unparseable
  }

  return null;
}

/**
 * Scan the session's JSONL file for a model ID, reading at most 30 lines.
 * The model field typically appears around line 18 of a session JSONL.
 *
 * @param {string} sessionId
 * @param {string|null} cwd
 * @returns {string|null}
 */
function scanSessionJsonl(sessionId, cwd) {
  const platform = process.env.LESSONS_AGENT_PLATFORM;
  const configBase = platform === 'codex' ? join(homedir(), '.codex') : join(homedir(), '.claude');

  const projectsDir = join(configBase, 'projects');
  const projectId = cwd ? cwdToProjectId(cwd) : null;

  // Try the known project directory first, then scan all project dirs as fallback
  const candidateDirs = projectId
    ? [join(projectsDir, projectId), projectsDir]
    : [projectsDir];

  for (const dir of candidateDirs) {
    const model = tryReadJsonlModel(join(dir, `${sessionId}.jsonl`));
    if (model) return model;
  }

  return null;
}

/**
 * Read up to 30 lines from a JSONL file, return the first "model" string value found.
 * @param {string} filePath
 * @returns {string|null}
 */
function tryReadJsonlModel(filePath) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const lines = content.split('\n');
  const limit = Math.min(lines.length, 30);
  for (let i = 0; i < limit; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj.model === 'string' && obj.model) return obj.model;
    } catch {
      // not valid JSON — skip
    }
  }
  return null;
}
