/**
 * hooks/lib/model.mjs — Runtime model identity detection for lesson scope filtering.
 *
 * Detection chain (first full model ID wins):
 *   1. LESSONS_LEARNED_MODEL env var — explicit override
 *   2. `model` in the hook input — SessionStart passes the session's model
 *   3. Last assistant entry's `message.model` in the transcript tail
 *   4. ~/.claude/settings.json "model" — only when it is a full ID, not an alias like "sonnet"
 *   5. null — unknown; callers fire the lesson anyway (safe default)
 */

import { closeSync, openSync, readSync, readFileSync, fstatSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const TAIL_BYTES = 256 * 1024;
const FULL_MODEL_ID = /^claude-[a-z]+-\d/i;

/**
 * @param {unknown} value
 * @returns {string|null} the value when it is a full Claude model ID, else null
 */
function fullModelId(value) {
  return typeof value === 'string' && FULL_MODEL_ID.test(value) ? value : null;
}

/**
 * Most recent assistant `message.model` in the last 256 KiB of a transcript.
 *
 * @param {string|undefined} transcriptPath
 * @returns {string|null}
 */
export function modelFromTranscript(transcriptPath) {
  if (!transcriptPath) return null;
  let fd;
  try {
    fd = openSync(transcriptPath, 'r');
    const { size } = fstatSync(fd);
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"model"')) continue;
      try {
        const id = fullModelId(JSON.parse(lines[i])?.message?.model);
        if (id) return id;
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return null;
}

/**
 * @returns {string|null} the configured default model from ~/.claude/settings.json when it is a full ID
 */
function modelFromSettings() {
  try {
    const settings = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8'));
    return fullModelId(settings.model);
  } catch {
    return null;
  }
}

/**
 * Detect the running model. Only Claude Code sessions are detected; other platforms
 * (`LESSONS_AGENT_PLATFORM` of codex or gemini) report unknown. A subagent may run a different model from the session whose
 * transcript the hook sees, so a hook input carrying an `agent_id` reports unknown.
 *
 * @param {{ model?: unknown, transcript_path?: string, agent_id?: string }|null|undefined} hookInput parsed hook stdin
 * @returns {string|null}
 */
export function detectModel(hookInput) {
  if (process.env.LESSONS_LEARNED_MODEL) return process.env.LESSONS_LEARNED_MODEL;
  if (process.env.LESSONS_AGENT_PLATFORM && process.env.LESSONS_AGENT_PLATFORM !== 'cc')
    return null;
  if (hookInput?.agent_id) return null;
  return (
    fullModelId(hookInput?.model) ??
    modelFromTranscript(hookInput?.transcript_path) ??
    modelFromSettings()
  );
}
