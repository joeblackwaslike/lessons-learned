#!/usr/bin/env node

/**
 * PostToolUse hook — injects `reminder` type lessons after a tool result is returned.
 *
 * Matches lessons against tool_input (command/path) and tool_response (stdout) rather than
 * the pre-execution state that PreToolUse sees. This is the correct injection point for
 * "you just did X, now you must do Y" patterns.
 *
 * Output: raw markdown text to stdout (not JSON). Empty stdout = silent no-op.
 * See website/docs/architecture/reminder-type.md for the full design rationale.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { loadSeenSet, claimLesson } from './lib/dedup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH =
  process.env.LESSONS_MANIFEST_PATH ?? join(__dirname, '..', 'data', 'lesson-manifest.json');

const PATH_TOOLS = new Set(['Write', 'Edit', 'Read', 'Glob']);

function compileRegexes(sources) {
  return (sources ?? [])
    .map(({ source, flags }) => {
      try {
        return new RegExp(source, flags);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function matchesLesson(lesson, toolName, command, filePath, toolResponse) {
  const commandPatterns = compileRegexes(lesson.commandRegexSources);
  const pathPatterns = compileRegexes(lesson.pathRegexSources);
  const outputPatterns = compileRegexes(lesson.outputRegexSources);

  const hasCommand = commandPatterns.length > 0;
  const hasPath = pathPatterns.length > 0;
  const hasOutput = outputPatterns.length > 0;

  if (!hasCommand && !hasPath && !hasOutput) return true; // no patterns = always-match

  if (hasCommand && toolName === 'Bash' && command) {
    if (commandPatterns.some(re => re.test(command))) return true;
  }
  if (hasPath && filePath) {
    if (pathPatterns.some(re => re.test(filePath))) return true;
  }
  if (hasOutput && toolResponse) {
    if (outputPatterns.some(re => re.test(toolResponse))) return true;
  }

  return false;
}

function dedupKey(sessionId, toolName, command, filePath) {
  const payload = sessionId + toolName + (command || filePath || '');
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

function formatReminder(lesson) {
  const solutionLines = lesson.solution
    .split('\n')
    .map(l => `> ${l}`)
    .join('\n');
  return `> **[Reminder]** ${lesson.summary}\n>\n${solutionLines}\n`;
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

  const toolName = input?.tool_name ?? '';
  const toolInput = input?.tool_input ?? {};
  const toolResponse = typeof input?.tool_response === 'string' ? input.tool_response : '';
  const command = toolName === 'Bash' ? (toolInput.command ?? '') : '';
  const filePath = PATH_TOOLS.has(toolName) ? (toolInput.file_path ?? '') : '';
  const cwd = input?.cwd ?? '';
  const projectId = cwd ? cwd.replace(/\//g, '-').replace(/^-/, '') : null;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return;
  }

  const reminders = Object.values(manifest.lessons ?? {}).filter(lesson => {
    if (lesson.type !== 'reminder') return false;
    if (lesson.disabled) return false;
    if (!(lesson.toolNames ?? []).includes(toolName)) return false;
    if (lesson.scope && lesson.scope !== projectId) return false;
    return true;
  });

  if (reminders.length === 0) return;

  const seenSet = loadSeenSet(sessionId);
  const output = [];

  for (const lesson of reminders) {
    if (!matchesLesson(lesson, toolName, command, filePath, toolResponse)) continue;

    const key = `reminder-${lesson.slug}-${dedupKey(sessionId, toolName, command, filePath)}`;
    if (seenSet.has(key)) continue;
    if (!claimLesson(sessionId, key)) continue;

    output.push(formatReminder(lesson));
  }

  if (output.length > 0) {
    process.stdout.write(output.join('\n'));
  }
}

main();
