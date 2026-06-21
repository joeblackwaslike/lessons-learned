#!/usr/bin/env node
// Verify TC-H24: every hook command entry the agent wrote to settings.json must
// carry a numeric `timeout`. The lesson's fix is exactly that — without it Claude
// Code never reaps the child process and zombies accumulate per tool call. An
// agent that adds the hook but omits timeout (e.g. relying on `|| true`) has not
// applied the lesson and must fail here.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}

// The agent may write to .claude/settings.json (seeded) or a bare settings.json.
const candidates = [
  join(workspaceDir, '.claude', 'settings.json'),
  join(workspaceDir, 'settings.json'),
];
const settingsPath = candidates.find(p => existsSync(p));
if (!settingsPath) {
  console.error('FAIL: no settings.json found in workspace');
  process.exit(1);
}

let settings;
try {
  settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
} catch (e) {
  console.error('FAIL: settings.json is not valid JSON: ' + e.message);
  process.exit(1);
}

const hooks = settings.hooks;
if (!hooks || typeof hooks !== 'object') {
  console.error('FAIL: no hooks block added to settings.json');
  process.exit(1);
}

// Collect every individual hook entry across all events/matchers.
const entries = [];
for (const matchers of Object.values(hooks)) {
  for (const matcher of Array.isArray(matchers) ? matchers : []) {
    for (const h of matcher?.hooks ?? []) entries.push(h);
  }
}

if (entries.length === 0) {
  console.error('FAIL: hooks block present but contains no hook entries');
  process.exit(1);
}

const missing = entries.filter(h => typeof h?.timeout !== 'number');
if (missing.length > 0) {
  console.error(
    `FAIL: ${missing.length}/${entries.length} hook entr${missing.length === 1 ? 'y has' : 'ies have'} ` +
      'no numeric "timeout" field — Claude Code will spawn the hook without reaping it (zombie per tool call)'
  );
  process.exit(1);
}

console.log(
  `PASS: all ${entries.length} hook entr${entries.length === 1 ? 'y has' : 'ies have'} a timeout field`
);
process.exit(0);
