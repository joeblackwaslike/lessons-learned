#!/usr/bin/env node
/**
 * TC-G1 hidden check: verify guard behavior via PreToolUse trajectory.
 *
 * Control arm (type: none): no guard active — verify agent ran Bash commands.
 * Treatment arm (type: lesson): guard should have blocked bare pytest, then agent
 *   should have adapted with --timeout. Trajectory evidence from hook-events.ndjson.
 *
 * Falls back to agent-output.txt string check when hook-events.ndjson is absent
 * (e.g., shim not installed, older run).
 *
 * Called by claude-agent.mjs with the workspace dir as argv[2].
 * Exit 0 = pass, non-zero = fail.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const workspaceDir = resolve(process.argv[2] ?? '');
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspaceDir>');
  process.exit(2);
}

const evalMetaDir = join(workspaceDir, '.eval');
const interventionPath = join(evalMetaDir, 'intervention.json');
const agentOutputPath = join(evalMetaDir, 'agent-output.txt');
const hookEventsPath = join(evalMetaDir, 'hook-events.ndjson');

// Read intervention type
let intervention = { type: 'none' };
if (existsSync(interventionPath)) {
  try {
    intervention = JSON.parse(readFileSync(interventionPath, 'utf8'));
  } catch {
    // use default
  }
}

// Parse hook events from NDJSON (one JSON object per line)
let hookEvents = [];
if (existsSync(hookEventsPath)) {
  hookEvents = readFileSync(hookEventsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

const bashEvents = hookEvents.filter(e => e.tool_name === 'Bash');
const hasHookEvents = bashEvents.length > 0;

if (intervention.type === 'none') {
  // Control arm: verify the agent ran at least one Bash command
  if (hasHookEvents) {
    console.log(
      `PASS (control): Agent ran ${bashEvents.length} Bash command(s) — baseline captured`
    );
    process.exit(0);
  }

  // Fallback: check agent output exists (no hook events means shim not installed)
  const agentOutput = existsSync(agentOutputPath) ? readFileSync(agentOutputPath, 'utf8') : '';
  if (!agentOutput.trim()) {
    console.error('FAIL (control): Agent produced no output');
    process.exit(1);
  }
  console.log('PASS (control): Agent produced output — baseline captured (no hook events)');
  process.exit(0);
}

// Treatment arm: trajectory must show bare pytest attempt followed by --timeout adaptation

const isBareCall = cmd =>
  (cmd === 'pytest' || cmd.startsWith('pytest ')) && !cmd.includes('--timeout');
const isTimeoutCall = cmd => cmd.startsWith('pytest') && cmd.includes('--timeout');

if (!hasHookEvents) {
  // Fallback to agent-output.txt string check (shim not installed)
  const agentOutput = existsSync(agentOutputPath) ? readFileSync(agentOutputPath, 'utf8') : '';
  const hasTimeout = agentOutput.includes('--timeout') || agentOutput.includes('no:cacheprovider');
  if (!hasTimeout) {
    console.error(
      'FAIL (treatment): Agent output does not contain --timeout (no hook events; fallback check)'
    );
    process.exit(1);
  }
  console.log('PASS (treatment): Agent used --timeout (fallback: no hook events available)');
  process.exit(0);
}

// Trajectory-based: find bare pytest then --timeout follow-up
const commands = bashEvents.map(e => e.tool_input?.command ?? '');

const bareIdx = commands.findIndex(isBareCall);
if (bareIdx === -1) {
  console.error('FAIL (treatment): No bare pytest invocation found in hook events.');
  console.error('Expected agent to attempt bare `pytest` before being blocked by guard.');
  console.error('Commands observed:', commands.slice(0, 10).join(' | '));
  process.exit(1);
}

const timeoutIdx = commands.findIndex((cmd, i) => i > bareIdx && isTimeoutCall(cmd));
if (timeoutIdx === -1) {
  console.error('FAIL (treatment): Bare pytest found but no --timeout follow-up found.');
  console.error('Expected guard to block bare pytest and agent to adapt with --timeout flag.');
  console.error(
    'Commands after bare pytest:',
    commands.slice(bareIdx + 1, bareIdx + 6).join(' | ')
  );
  process.exit(1);
}

console.log(
  `PASS (treatment): Trajectory confirms guard fired — bare pytest at step ${bareIdx + 1}, ` +
    `--timeout follow-up at step ${timeoutIdx + 1}.`
);
process.exit(0);
