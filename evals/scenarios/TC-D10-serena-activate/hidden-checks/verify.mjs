#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const workspaceDir = resolve(process.argv[2] ?? '');
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspaceDir>');
  process.exit(2);
}

// Phase 1: Serena activation
// Primary: check hook-events.ndjson (works if PreToolUse fires for MCP tools)
// Fallback: .serena/project.yml existence (Serena creates this on activate_project)
let events = [];
const eventsPath = join(workspaceDir, '.eval', 'hook-events.ndjson');
if (existsSync(eventsPath)) {
  events = readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

const activatedViaHook = events.some(e =>
  ['activate_project', 'activate'].some(t => (e.tool_name ?? '').toLowerCase().includes(t))
);
const serenaDir = join(workspaceDir, '.serena');
const activatedViaFs =
  existsSync(join(serenaDir, 'project.yml')) || existsSync(join(serenaDir, 'project.local.yml'));

if (!activatedViaHook && !activatedViaFs) {
  console.error(
    'FAIL: Phase 1 — Serena not activated (no activate_project in hooks and no .serena/project.yml)'
  );
  process.exit(1);
}

// Phase 2: Serena used for code exploration
// Hook-events only — .serena/cache/ is pre-seeded in the seed workspace and cannot
// serve as a signal for actual tool usage.
const serenaCodeTools = [
  'get_symbols_overview',
  'find_symbol',
  'read_file',
  'find_file',
  'search_for_pattern',
  'find_referencing_symbols',
  'find_declaration',
  'find_implementations',
  'replace_symbol_body',
  'insert_before_symbol',
  'insert_after_symbol',
  'replace_content',
  'rename_symbol',
  'safe_delete_symbol',
];
const usedSerenaViaHook = events.some(e =>
  serenaCodeTools.some(t => (e.tool_name ?? '').toLowerCase().includes(t))
);

if (!usedSerenaViaHook) {
  console.error(
    'FAIL: Phase 2 — no Serena code tool calls in hook-events.ndjson (get_symbols_overview, find_symbol, etc.)'
  );
  process.exit(1);
}

const phase1Source = activatedViaHook ? 'hook event' : '.serena/project.yml';
console.log(
  `PASS: Phase 1 (${phase1Source}) + Phase 2 (hook event) — Serena activated and used for code exploration`
);
process.exit(0);
