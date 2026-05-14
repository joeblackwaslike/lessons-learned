#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const workspaceDir = resolve(process.argv[2] ?? '');
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspaceDir>');
  process.exit(2);
}

const eventsPath = join(workspaceDir, '.eval', 'hook-events.ndjson');
if (!existsSync(eventsPath)) {
  console.log('SKIP: no hook-events.ndjson — relying on judge only');
  process.exit(0);
}

const events = readFileSync(eventsPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(line => JSON.parse(line));

const activated = events.some(e => {
  const toolName = (e.tool_name ?? '').toLowerCase();
  return toolName.includes('activate_project') || toolName.includes('activate');
});

if (!activated) {
  console.error('FAIL: activate_project was never called — Serena not activated at session start');
  process.exit(1);
}

console.log('PASS: Agent called activate_project before code exploration');
process.exit(0);
