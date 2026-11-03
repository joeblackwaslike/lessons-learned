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
} catch (err) {
  // Malformed stdin would otherwise be silently indistinguishable from a quiet tool call,
  // masking lost trajectory evidence. Record it so collect-artifacts.mjs can surface it.
  const evalDir = process.env.EVAL_LOG_DIR || join(process.cwd(), '.eval');
  mkdirSync(evalDir, { recursive: true });
  appendFileSync(
    join(evalDir, 'hook-events.ndjson'),
    JSON.stringify({
      type: 'PARSE_ERROR',
      timestamp: new Date().toISOString(),
      error: err.message,
    }) + '\n'
  );
}

if (event.tool_name) {
  // event.cwd is the agent's working directory (the workspace); fall back to process.cwd()
  const workspaceDir = event.cwd || process.cwd();
  // The provider points EVAL_LOG_DIR outside the workspace so a `git clean` there keeps the
  // log. The agent can still write to it, so the log is not tamper-proof.
  const evalDir = process.env.EVAL_LOG_DIR || join(workspaceDir, '.eval');
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
