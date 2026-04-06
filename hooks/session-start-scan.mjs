#!/usr/bin/env node

/**
 * SessionStart hook: Triggers background lesson scan on session startup.
 *
 * Only fires on 'startup' — not resume, clear, or compact (no new sessions to scan).
 * Runs `scripts/scan.mjs` as a fire-and-forget background process so it never
 * blocks or delays the session start.
 *
 * stdin: JSON with { hook_event_name, session_id }
 * stdout: empty (background-only, no injection)
 */

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..');
const LESSONS_CLI = join(PLUGIN_ROOT, 'scripts', 'lessons.mjs');

function main() {
  let input = null;
  try {
    const raw = readFileSync(0, 'utf8');
    if (raw.trim()) input = JSON.parse(raw);
  } catch {
    return;
  }

  const hookEvent = input?.hook_event_name ?? '';

  // Only scan on fresh session start — not resume/clear/compact
  if (hookEvent !== 'startup') return;

  // Fire-and-forget: detach so this hook exits immediately
  const child = spawn(process.execPath, [LESSONS_CLI, 'scan', '--auto'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

main();
