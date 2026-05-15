#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
// Primary: check hook-events for Serena code tool names
// Fallback: .serena/cache/ populated (language server indexed code when Serena tools were called)
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

const serenaCache = join(serenaDir, 'cache');
const usedSerenaViaFs = existsSync(serenaCache) && readdirSync(serenaCache).length > 0;

if (!usedSerenaViaHook && !usedSerenaViaFs) {
  console.error(
    'FAIL: Phase 2 — Serena activated but no evidence of code exploration (no Serena tool calls and no .serena/cache/ files)'
  );
  process.exit(1);
}

const phase1Source = activatedViaHook ? 'hook event' : '.serena/project.yml';
const phase2Source = usedSerenaViaHook ? 'hook event' : '.serena/cache/';
console.log(
  `PASS: Phase 1 (${phase1Source}) + Phase 2 (${phase2Source}) — Serena activated and used for code exploration`
);
process.exit(0);
