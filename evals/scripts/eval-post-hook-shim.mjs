#!/usr/bin/env node
/**
 * eval-post-hook-shim.mjs
 *
 * PostToolUse hook installed in eval workspaces by materialize-workspace.mjs.
 * Logs each PostToolUse event to .eval/tool-calls.jsonl for trajectory analysis.
 * Outputs {} (no blocking).
 */

import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

let raw = '';
try {
  raw = readFileSync(0, 'utf8');
} catch {
  // no stdin — output empty and exit
}

let event = {};
try {
  event = JSON.parse(raw);
} catch {
  // malformed stdin — log nothing, allow tool call
}

if (event.tool_name) {
  const workspaceDir = event.cwd || process.cwd();
  const evalDir = join(workspaceDir, '.eval');
  mkdirSync(evalDir, { recursive: true });

  const record = {
    type: 'PostToolUse',
    timestamp: new Date().toISOString(),
    tool_name: event.tool_name,
    tool_input: event.tool_input ?? {},
    tool_response: event.tool_response ?? {},
  };
  appendFileSync(join(evalDir, 'tool-calls.jsonl'), JSON.stringify(record) + '\n');
}

process.stdout.write('{}');
