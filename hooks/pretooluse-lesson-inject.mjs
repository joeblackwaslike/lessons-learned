#!/usr/bin/env node

/**
 * PreToolUse hook — Claude Code adapter for the lessons-learned injection pipeline.
 *
 * Thin I/O glue: parse Claude Code stdin → core match/select → format Claude Code output.
 * All business logic lives in core/match.mjs and core/select.mjs.
 *
 * Performance target: <50ms total, typically <10ms.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseHookInput } from './lib/stdin.mjs';
import { loadSeenSet, claimLesson, persistSeenState } from './lib/dedup.mjs';
import { formatHookOutput, formatEmptyOutput } from './lib/output.mjs';
import { matchLessons, findBlocker } from '../core/match.mjs';
import { selectCandidates } from '../core/select.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH =
  process.env.LESSONS_MANIFEST_PATH ?? join(__dirname, '..', 'data', 'lesson-manifest.json');

// ─── Stage 1: Parse Input ───────────────────────────────────────────

const input = parseHookInput();
if (!input) {
  process.stdout.write(formatEmptyOutput());
  process.exit(0);
}

const { toolName, toolInput, sessionId } = input;

// ─── Stage 2: Load Manifest ─────────────────────────────────────────

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
} catch {
  process.stdout.write(formatEmptyOutput());
  process.exit(0);
}

const config = manifest.config ?? {};
const maxLessons = config.maxLessonsPerInjection ?? 3;
const budgetBytes = config.injectionBudgetBytes ?? 4096;

// ─── Stage 3: Match + Block check ───────────────────────────────────

const command = toolName === 'Bash' ? (toolInput.command ?? '') : '';
const filePath = toolName !== 'Bash' ? (toolInput.file_path ?? '') : '';

const matches = matchLessons(manifest.lessons ?? {}, toolName, command, filePath);

if (matches.length === 0) {
  process.stdout.write(formatEmptyOutput());
  process.exit(0);
}

const blocker = findBlocker(matches, command);
if (blocker) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: blocker.reason,
      },
    })
  );
  process.exit(0);
}

// ─── Stage 4–5: Dedup, rank, budget ─────────────────────────────────

const seenSet = loadSeenSet(sessionId);
const { injected, dropped, seen } = selectCandidates(matches, seenSet, {
  maxLessons,
  budgetBytes,
  claimFn: slug => claimLesson(sessionId, slug),
});

if (injected.length === 0) {
  process.stdout.write(formatEmptyOutput());
  process.exit(0);
}

// ─── Stage 6: Format Output ─────────────────────────────────────────

const lessonsSeen = persistSeenState(sessionId, seen);

const target = command
  ? `\`${command.slice(0, 80)}${command.length > 80 ? '...' : ''}\``
  : `${toolName}: ${filePath}`;

const count = injected.length;
const summary = `[lessons-learned] ${count} lesson${count > 1 ? 's' : ''} matched for ${target}`;
const body = injected.map(l => l.text).join('\n\n');

const context = [
  '<details>',
  `<summary>${summary} — <em>Why am I seeing this?</em></summary>`,
  '',
  'The **[lessons-learned](https://github.com/joeblackwaslike/lessons-learned)** plugin matched this tool call against known pitfall patterns and injected the following warnings for Claude to consider before executing.',
  '',
  '---',
  '',
  body,
  '',
  '</details>',
].join('\n');

process.stdout.write(
  formatHookOutput(context, lessonsSeen, {
    injected: injected.map(l => l.slug),
    dropped,
  })
);
