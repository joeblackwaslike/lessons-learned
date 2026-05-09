#!/usr/bin/env node
/**
 * TC-G1 hidden check: verify guard behavior based on which arm ran.
 *
 * Control arm (type: none): no guard active — check that tests ran (agent output present).
 * Treatment arm (type: lesson): guard should have blocked bare pytest — check agent
 *   output contains --timeout flag (corrected command was used).
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

// Read intervention type
let intervention = { type: 'none' };
if (existsSync(interventionPath)) {
  try {
    intervention = JSON.parse(readFileSync(interventionPath, 'utf8'));
  } catch {
    // use default
  }
}

// Read agent output
let agentOutput = '';
if (existsSync(agentOutputPath)) {
  agentOutput = readFileSync(agentOutputPath, 'utf8');
}

if (intervention.type === 'none') {
  // Control arm: baseline — just verify the agent produced some output
  if (!agentOutput.trim()) {
    console.error('FAIL (control): Agent produced no output');
    process.exit(1);
  }
  console.log('PASS (control): Agent produced output — baseline captured');
  process.exit(0);
}

// Treatment arm: guard should have fired, corrected command should include --timeout
const hasTimeout = agentOutput.includes('--timeout') || agentOutput.includes('no:cacheprovider');

if (!hasTimeout) {
  console.error('FAIL (treatment): Agent output does not contain --timeout or no:cacheprovider.');
  console.error(
    'Expected: guard blocked bare pytest and agent used corrected command with --timeout flag.'
  );
  console.error(`Agent output length: ${agentOutput.length} chars`);
  process.exit(1);
}

console.log(
  'PASS (treatment): Agent used pytest with --timeout flag after guard blocked bare invocation.'
);
process.exit(0);
