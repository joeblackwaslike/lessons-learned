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

if (!args['--workspace'] || !args['--scenario']) {
  console.error('Usage: collect-artifacts.mjs --workspace <dir> --scenario <dir>');
  process.exit(1);
}

const workspaceDir = resolve(args['--workspace']);

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
const postHookEvents = [];
if (existsSync(toolCallsPath)) {
  for (const line of readFileSync(toolCallsPath, 'utf8').split('\n').filter(Boolean)) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      toolCallParseErrors += 1;
      continue;
    }
    if (record.type === 'PARSE_ERROR') {
      toolCallParseErrors += 1;
    } else {
      postHookEvents.push(record);
    }
  }
}

// --- Extract tool trajectory ----------------------------------------------------
// Pre-hook events carry the invocation; post-hook events carry the same call's response.
// Both are kept (not deduped against each other — they are different phases of one call)
// and merged in timestamp order so a reader sees invocation followed by completion.
const trajectory = [...hookEvents, ...postHookEvents]
  .filter(e => e.type === 'PreToolUse' || e.type === 'PostToolUse')
  .map(e => ({
    type: e.type,
    tool: e.tool_name ?? e.tool ?? e.toolName,
    command: e.tool_input?.command ?? e.input?.command,
    path: e.tool_input?.file_path ?? e.input?.file_path,
    response: e.tool_response,
    timestamp: e.timestamp,
  }))
  .sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));

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

  const untrackedResult = spawnSync(
    'git',
    ['-c', 'core.fsmonitor=false', 'ls-files', '--others', '--exclude-standard'],
    { cwd: workspaceDir, encoding: 'utf8', timeout: 10_000 }
  );
  if (untrackedResult.error || untrackedResult.status !== 0) {
    throw new Error(
      `untracked file listing (${workspaceDir}) failed: ${untrackedResult.error?.message ?? `exit ${untrackedResult.status}: ${(untrackedResult.stderr ?? '').slice(0, 2000)}`}`
    );
  }
  const untrackedFiles = untrackedResult.stdout
    .split('\n')
    .filter(f => f && !f.startsWith('.eval/'));
  if (untrackedFiles.length > 0) {
    workspaceDiff += `\nUntracked files:\n${untrackedFiles.join('\n')}`;
  }
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
