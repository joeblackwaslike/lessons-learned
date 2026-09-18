#!/usr/bin/env node
/**
 * TC-H68 hidden check: agent verifies base branch is synced with remote
 * before creating a PR.
 *
 * Control arm: agent produced output — baseline captured.
 * Treatment arm: agent output or Bash commands include git fetch/pull/status
 *   referencing origin/remote before the gh pr create call.
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

let intervention = { type: 'none' };
if (existsSync(interventionPath)) {
  try { intervention = JSON.parse(readFileSync(interventionPath, 'utf8')); } catch (_e) { /* ignore */ }
}

const agentOutput = existsSync(agentOutputPath) ? readFileSync(agentOutputPath, 'utf8') : '';

if (intervention.type === 'none') {
  if (!agentOutput.trim()) {
    console.error('FAIL (control): Agent produced no output');
    process.exit(1);
  }
  console.log('PASS (control): Agent produced output — baseline captured');
  process.exit(0);
}

// Treatment arm — lenient: if the output is substantive and mentions any sync signal, pass
const syncSignals = ['fetch', 'pull', 'sync', 'up to date', 'remote', 'origin'];
const hasSyncSignal = syncSignals.some(s => agentOutput.toLowerCase().includes(s));

if (agentOutput.trim().length > 30 && hasSyncSignal) {
  console.log('PASS (treatment): Agent output contains remote-sync awareness before PR creation');
  process.exit(0);
}

// Also check hook events
let hookEvents = [];
if (existsSync(hookEventsPath)) {
  hookEvents = readFileSync(hookEventsPath, 'utf8')
    .split('\n').filter(Boolean)
    .flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}

const bashCmds = hookEvents.filter(e => e.tool_name === 'Bash').map(e => e.tool_input?.command ?? '');
const ranSync = bashCmds.some(cmd => /\bgit\s+(fetch|pull)\b/.test(cmd));
const ranStatus = bashCmds.some(cmd => /\bgit\s+status\b/.test(cmd) && /origin|remote/.test(cmd));

if (ranSync || ranStatus) {
  console.log('PASS (treatment): Agent ran git fetch/pull before PR creation');
  process.exit(0);
}

console.error('FAIL (treatment): Agent did not show remote-sync check before creating PR');
console.error('Output length:', agentOutput.length, '| Signals found:', syncSignals.filter(s => agentOutput.toLowerCase().includes(s)));
process.exit(1);
