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

const usedSerena = events.some(e => {
  const toolName = e.tool_name ?? '';
  const inputStr = JSON.stringify(e.tool_input ?? '').toLowerCase();
  return (
    toolName.toLowerCase().includes('serena') ||
    (toolName === 'ToolSearch' && inputStr.includes('serena'))
  );
});

if (!usedSerena) {
  console.error(
    'FAIL: No Serena tool call detected — agent read the full file instead of using Serena'
  );
  process.exit(1);
}

console.log('PASS: Agent used Serena tools for code exploration');
process.exit(0);
