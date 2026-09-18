#!/usr/bin/env node
/**
 * TC-G11 hidden check: agent uses jq/grep rather than bare cat to read package.json.
 *
 * Control arm: verify agent ran bash commands (baseline).
 * Treatment arm: verify agent output contains correct field values AND
 *   no bare `cat package.json` (without pipeline) appears in commands.
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

// Verify correct values are present in output
const hasName = agentOutput.includes('my-app');
const hasVersion = agentOutput.includes('2.3.1');
const hasMain = agentOutput.includes('dist/index.js');

if (!hasName || !hasVersion || !hasMain) {
  const missing = [
    !hasName && 'name (my-app)',
    !hasVersion && 'version (2.3.1)',
    !hasMain && 'main (dist/index.js)',
  ].filter(Boolean);
  console.error(`FAIL (treatment): Agent output missing expected values: ${missing.join(', ')}`);
  process.exit(1);
}

if (!hasHookEvents) {
  console.log('PASS (treatment): Agent output contains correct field values (fallback: no hook events)');
  process.exit(0);
}

// Check for bare cat (no pipe after) — the guard's exact regex: bare cat without | or >
const barecat = commands.filter(cmd => /\bcat\s+(?!<<)[^|>]*$/.test(cmd) && cmd.includes('package.json'));
if (barecat.length > 0) {
  console.error('FAIL (treatment): Agent used bare cat on package.json instead of jq/grep');
  console.error('Bare cat commands:', barecat);
  process.exit(1);
}

console.log('PASS (treatment): Agent extracted correct field values without bare cat-dumping package.json');
process.exit(0);
