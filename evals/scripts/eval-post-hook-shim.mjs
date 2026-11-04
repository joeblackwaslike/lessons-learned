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
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`parsed event is not an object: ${typeof parsed}`);
  }
  event = parsed;
} catch (err) {
  // Malformed or non-object stdin would otherwise be silently indistinguishable from a quiet
  // tool call, masking lost trajectory evidence. Record it so collect-artifacts.mjs can surface it.
  const evalDir = process.env.EVAL_LOG_DIR || join(process.cwd(), '.eval');
  mkdirSync(evalDir, { recursive: true });
  appendFileSync(
    join(evalDir, 'tool-calls.jsonl'),
    JSON.stringify({
      type: 'PARSE_ERROR',
      timestamp: new Date().toISOString(),
      error: err.message,
    }) + '\n'
  );
}

if (event.tool_name) {
  const workspaceDir = event.cwd || process.cwd();
  // The provider points EVAL_LOG_DIR outside the workspace so the agent cannot erase the log.
  const evalDir = process.env.EVAL_LOG_DIR || join(workspaceDir, '.eval');
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
