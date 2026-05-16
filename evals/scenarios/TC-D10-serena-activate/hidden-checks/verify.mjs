#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const workspaceDir = resolve(process.argv[2] ?? '');
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspaceDir>');
  process.exit(2);
}

// ── JSONL transcript parsing ───────────────────────────────────────────────────
// MCP tool calls do NOT appear in hook-events.ndjson (PreToolUse hooks never fire
// for MCP calls). Instead, parse the session JSONL which records all tool_use entries.

function findTranscriptPath(dir) {
  const projectsDir = join(dir, '.eval', 'home', '.claude', 'projects');
  if (!existsSync(projectsDir)) return null;
  for (const projId of readdirSync(projectsDir)) {
    const projDir = join(projectsDir, projId);
    try {
      const files = readdirSync(projDir).filter(f => f.endsWith('.jsonl'));
      if (files.length > 0) return join(projDir, files[0]);
    } catch {
      // skip unreadable dirs
    }
  }
  return null;
}

function extractToolCalls(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  const calls = [];
  for (const line of readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean)) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'assistant') continue;
      for (const item of entry.message?.content ?? []) {
        if (item.type === 'tool_use') calls.push((item.name ?? '').toLowerCase());
      }
    } catch {
      // skip malformed lines
    }
  }
  return calls;
}

const transcriptPath = findTranscriptPath(workspaceDir);
const toolCalls = extractToolCalls(transcriptPath);

// ── Phase 1: Serena activation ─────────────────────────────────────────────────
// Accept either: agent called activate_project (JSONL), hook pre-activated it
// (project.yml exists), or serena-hooks ran (project.local.yml exists).
const activatedViaJSONL = toolCalls.some(
  n => n.includes('activate_project') || n.includes('activate')
);
const serenaDir = join(workspaceDir, '.serena');
const activatedViaFs =
  existsSync(join(serenaDir, 'project.yml')) || existsSync(join(serenaDir, 'project.local.yml'));

if (!activatedViaJSONL && !activatedViaFs) {
  console.error(
    'FAIL: Phase 1 — Serena not activated (no activate_project in JSONL and no .serena/project.yml)'
  );
  process.exit(1);
}

// ── Phase 2: Serena code exploration tools used ────────────────────────────────
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

const usedSerenaForCode = toolCalls.some(name => serenaCodeTools.some(t => name.includes(t)));

if (!usedSerenaForCode) {
  console.error(
    'FAIL: Phase 2 — agent did not use Serena code exploration tools after activation\n' +
      `  Tool calls seen: ${toolCalls.join(', ') || '(none)'}`
  );
  process.exit(1);
}

const phase1Source = activatedViaJSONL ? 'JSONL tool_use' : '.serena/project.yml';
console.log(
  `PASS: Phase 1 (${phase1Source}) + Phase 2 (JSONL tool_use) — Serena activated and used for code exploration`
);
process.exit(0);
