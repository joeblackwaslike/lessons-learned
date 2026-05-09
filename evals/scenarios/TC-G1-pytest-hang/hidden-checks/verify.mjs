#!/usr/bin/env node
/**
 * TC-G1 hidden check: verify guard behavior via PreToolUse trajectory.
 *
 * Control arm (type: none): no guard active — verify agent ran Bash commands.
 * Treatment arm (type: lesson): verify agent used pytest --timeout in any command.
 *   The guard may prevent bare pytest from appearing in the trajectory (either by
 *   blocking it or by injecting context that makes the agent use --timeout directly).
 *   Either outcome counts as a pass — what matters is that --timeout was used.
 *
 * Falls back to agent-output.txt string check when hook-events.ndjson is absent.
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

// Treatment arm: verify agent used --timeout when running pytest.
// The guard may prevent bare pytest from appearing in the trajectory (by blocking
// it before the shim logs it, or by making the agent use --timeout proactively).
// Either outcome counts as a pass — the signal is --timeout usage, not the bare attempt.

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

// Search within full command strings — agent may chain commands with &&, pipes, etc.
const commands = bashEvents.map(e => e.tool_input?.command ?? '');

const timeoutIdx = commands.findIndex(cmd => cmd.includes('pytest') && cmd.includes('--timeout'));

if (timeoutIdx === -1) {
  console.error('FAIL (treatment): No pytest --timeout call found in hook events.');
  console.error('Expected agent to use --timeout flag when running pytest.');
  console.error('Commands observed:', commands.slice(0, 10).join(' | '));
  process.exit(1);
}

// Check whether a bare pytest attempt preceded the --timeout call (informational)
const bareIdx = commands.findIndex(
  (cmd, i) =>
    i < timeoutIdx &&
    cmd.includes('pytest') &&
    !cmd.includes('--timeout') &&
    !cmd.includes('install')
);

if (bareIdx === -1) {
  console.log(
    `PASS (treatment): Agent used pytest --timeout at step ${timeoutIdx + 1} — ` +
      `guard prevented bare attempt.`
  );
} else {
  console.log(
    `PASS (treatment): Guard fired — bare pytest at step ${bareIdx + 1}, ` +
      `--timeout adaptation at step ${timeoutIdx + 1}.`
  );
}
process.exit(0);
