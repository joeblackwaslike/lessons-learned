#!/usr/bin/env node
/**
 * collect-artifacts.mjs
 *
 * Parses a completed workspace run and emits structured artifact JSON to stdout.
 * Called by claude-agent.mjs after the agent process exits.
 *
 * Usage:
 *   node scripts/collect-artifacts.mjs \
 *     --workspace <path/to/temp-dir> \
 *     --scenario <path/to/TC-XX-name>
 *
 * Emits (stdout):
 *   {
 *     hookEvents: [],       // parsed hook stdout events (NDJSON lines)
 *     workspaceDiff: "",    // git diff of workspace changes (if .git present)
 *     trajectory: [],       // tool call sequence extracted from hook events
 *     evalMeta: {}          // intervention.json contents
 *   }
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const workspaceDir = resolve(args['--workspace'] ?? '');
const scenarioDir = resolve(args['--scenario'] ?? '');

if (!workspaceDir || !scenarioDir) {
  console.error('Usage: collect-artifacts.mjs --workspace <dir> --scenario <dir>');
  process.exit(1);
}

const evalMetaDir = join(workspaceDir, '.eval');

// --- Collect hook events --------------------------------------------------------
// Hook events are written to .eval/hook-events.ndjson by the eval hook shim
// (installed during workspace materialization in Phase 2)
const hookEventsPath = join(evalMetaDir, 'hook-events.ndjson');
let droppedLines = 0;
const hookEvents = existsSync(hookEventsPath)
  ? readFileSync(hookEventsPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          droppedLines += 1;
          return null;
        }
      })
      .filter(Boolean)
  : [];

// Post-hook events are written to .eval/tool-calls.jsonl by the eval post-hook shim.
// Malformed stdin there is recorded as a PARSE_ERROR line, same convention as above.
const toolCallsPath = join(evalMetaDir, 'tool-calls.jsonl');
let toolCallParseErrors = 0;
if (existsSync(toolCallsPath)) {
  for (const line of readFileSync(toolCallsPath, 'utf8').split('\n').filter(Boolean)) {
    try {
      if (JSON.parse(line).type === 'PARSE_ERROR') toolCallParseErrors += 1;
    } catch {
      toolCallParseErrors += 1;
    }
  }
}

// --- Extract tool trajectory ----------------------------------------------------
const trajectory = hookEvents
  .filter(e => e.type === 'PreToolUse' || e.type === 'PostToolUse')
  .map(e => ({
    type: e.type,
    tool: e.tool_name ?? e.tool ?? e.toolName,
    command: e.tool_input?.command ?? e.input?.command,
    path: e.tool_input?.file_path ?? e.input?.file_path,
    timestamp: e.timestamp,
  }));

// --- Workspace diff -------------------------------------------------------------
let workspaceDiff = '';
if (existsSync(join(workspaceDir, '.git'))) {
  const diffResult = spawnSync(
    'git',
    [
      '-c',
      'diff.external=',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.pager=cat',
      'diff',
      '--no-ext-diff',
      '--stat',
      'HEAD',
    ],
    {
      cwd: workspaceDir,
      encoding: 'utf8',
      timeout: 10_000,
      env: (() => {
        const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
        delete env.GIT_EXTERNAL_DIFF;
        return env;
      })(),
    }
  );
  if (diffResult.error || diffResult.status !== 0) {
    throw new Error(
      `workspace diff (${workspaceDir}) failed: ${diffResult.error?.message ?? `exit ${diffResult.status}${diffResult.signal ? ` signal ${diffResult.signal}` : ''}: ${(diffResult.stderr ?? '').slice(0, 2000)}`}`
    );
  }
  workspaceDiff = diffResult.stdout ?? '';
} else {
  // No .git in seed — list all files created
  workspaceDiff = listFiles(workspaceDir)
    .filter(f => !f.startsWith('.eval/'))
    .join('\n');
}

// --- Eval metadata --------------------------------------------------------------
const evalMetaPath = join(evalMetaDir, 'intervention.json');
const evalMeta = existsSync(evalMetaPath) ? JSON.parse(readFileSync(evalMetaPath, 'utf8')) : {};

// --- Telemetry integrity ---------------------------------------------------------
// A record the hook shim couldn't parse means lost trajectory evidence for that tool
// call — the caller must not treat this run as a cleanly observed success.
const parseErrors =
  hookEvents.filter(e => e.type === 'PARSE_ERROR').length + droppedLines + toolCallParseErrors;

// --- Emit -----------------------------------------------------------------------
console.log(
  JSON.stringify({ hookEvents, workspaceDiff, trajectory, evalMeta, parseErrors }, null, 2)
);

// --- Helpers --------------------------------------------------------------------

function listFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      results.push(relative(dir, join(entry.parentPath, entry.name)));
    }
  }
  return results;
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      result[argv[i]] = argv[i + 1];
      i++;
    }
  }
  return result;
}
