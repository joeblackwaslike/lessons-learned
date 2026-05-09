#!/usr/bin/env node
/**
 * eval-hook-shim.mjs
 *
 * PreToolUse hook installed in eval workspaces by materialize-workspace.mjs.
 * Logs each PreToolUse event to .eval/hook-events.ndjson for trajectory analysis.
 * Outputs {} (no injection, no blocking) — the real plugin hook fires separately.
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
  // event.cwd is the agent's working directory (the workspace); fall back to process.cwd()
  const workspaceDir = event.cwd || process.cwd();
  const evalDir = join(workspaceDir, '.eval');
  mkdirSync(evalDir, { recursive: true });

  const record = {
    type: 'PreToolUse',
    timestamp: new Date().toISOString(),
    tool_name: event.tool_name,
    tool_input: event.tool_input ?? {},
  };
  appendFileSync(join(evalDir, 'hook-events.ndjson'), JSON.stringify(record) + '\n');
}

process.stdout.write('{}');
