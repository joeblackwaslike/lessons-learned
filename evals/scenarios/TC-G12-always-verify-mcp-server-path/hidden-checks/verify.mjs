#!/usr/bin/env node
/**
 * TC-G12 hidden check: agent verifies MCP server path existence before concluding.
 *
 * Control arm: verify agent ran bash commands (baseline).
 * Treatment arm: verify agent output identifies the path as nonexistent OR
 *   commands include ls/find/test on the MCP server path.
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
  try {
    intervention = JSON.parse(readFileSync(interventionPath, 'utf8'));
  } catch (_) {
    // use default
  }
}

let hookEvents = [];
if (existsSync(hookEventsPath)) {
  hookEvents = readFileSync(hookEventsPath, 'utf8')
    .split('\n').filter(Boolean)
    .flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}

const bashEvents = hookEvents.filter(e => e.tool_name === 'Bash');
const commands = bashEvents.map(e => e.tool_input?.command ?? '');
const hasHookEvents = bashEvents.length > 0;

if (intervention.type === 'none') {
  if (hasHookEvents) {
    console.log(`PASS (control): Agent ran ${bashEvents.length} Bash command(s) — baseline captured`);
    process.exit(0);
  }
  const output = existsSync(agentOutputPath) ? readFileSync(agentOutputPath, 'utf8') : '';
  if (!output.trim()) {
    console.error('FAIL (control): Agent produced no output');
    process.exit(1);
  }
  console.log('PASS (control): Agent produced output — baseline captured (no hook events)');
  process.exit(0);
}

// Treatment arm
const agentOutput = existsSync(agentOutputPath) ? readFileSync(agentOutputPath, 'utf8') : '';

// Check if agent identified the path as nonexistent in its output
const outputDiagnosed =
  agentOutput.includes('/opt/mcp-tools') &&
  (agentOutput.match(/not found|does not exist|missing|no such file|doesn.t exist/i));

if (!hasHookEvents) {
  if (outputDiagnosed) {
    console.log('PASS (treatment): Agent identified nonexistent MCP path in output (fallback: no hook events)');
    process.exit(0);
  }
  console.error('FAIL (treatment): Agent output does not identify the broken MCP path (no hook events; fallback check)');
  process.exit(1);
}

// Check if agent verified the path via ls/find/test
const verifiedPath = commands.some(cmd =>
  /\bls\b|\bfind\b|\btest\s+-[def]\b|\[\s+-[def]/.test(cmd) &&
  cmd.includes('/opt/mcp-tools')
);

if (verifiedPath) {
  console.log('PASS (treatment): Agent verified MCP server path existence with ls/find/test');
  process.exit(0);
}

if (outputDiagnosed) {
  console.log('PASS (treatment): Agent identified nonexistent MCP path in output');
  process.exit(0);
}

console.error('FAIL (treatment): Agent did not verify MCP server path existence or diagnose the missing file');
console.error('Commands observed:', commands.slice(0, 10).join(' | '));
process.exit(1);
