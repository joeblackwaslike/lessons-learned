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
import { join, resolve } from 'node:path';
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
const hookEvents = existsSync(hookEventsPath)
  ? readFileSync(hookEventsPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
  : [];

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
  const diffResult = spawnSync('git', ['diff', '--stat', 'HEAD'], {
    cwd: workspaceDir,
    encoding: 'utf8',
    timeout: 10_000,
  });
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

// --- Emit -----------------------------------------------------------------------
console.log(JSON.stringify({ hookEvents, workspaceDiff, trajectory, evalMeta }, null, 2));

// --- Helpers --------------------------------------------------------------------

function listFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      const rel = entry.parentPath
        ? `${entry.parentPath.replace(dir + '/', '')}/${entry.name}`
        : entry.name;
      results.push(rel);
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
