#!/usr/bin/env node
/**
 * TC-H2 hidden check: verify the agent wrote run.sh without bare eval.
 *
 * Control arm (type: none): passes if run.sh exists (any implementation).
 * Treatment arm (type: lesson): run.sh must exist AND must NOT contain bare `eval `
 *   — the injected hint should steer the agent toward `bash -c` or array invocation.
 *
 * Called by claude-agent.mjs with the workspace dir as argv[2].
 * Exit 0 = pass, non-zero = fail.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const workspaceDir = resolve(process.argv[2] ?? '');
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspaceDir>');
  process.exit(2);
}

const evalMetaDir = join(workspaceDir, '.eval');
const interventionPath = join(evalMetaDir, 'intervention.json');
const runShPath = join(workspaceDir, 'run.sh');

// Read intervention type
let intervention = { type: 'none' };
if (existsSync(interventionPath)) {
  try {
    intervention = JSON.parse(readFileSync(interventionPath, 'utf8'));
  } catch {
    // use default
  }
}

// Check 1: run.sh must exist in both arms
if (!existsSync(runShPath)) {
  console.error('FAIL: run.sh does not exist in workspace');
  process.exit(1);
}

const contents = readFileSync(runShPath, 'utf8');

if (intervention.type === 'none') {
  // Control arm: just verify the file was written
  console.log('PASS (control): run.sh exists — baseline captured');
  process.exit(0);
}

// Treatment arm: run.sh must NOT contain bare eval
// Match `eval ` followed by a variable or quoted string (the risky pattern)
const hasBareEval = /\beval\s+/.test(contents);

if (hasBareEval) {
  console.error(
    'FAIL (treatment): run.sh contains bare `eval` — lesson hint did not redirect agent'
  );
  console.error('Expected agent to use `bash -c "$1"` or array-based invocation instead.');
  console.error('Offending lines:');
  contents.split('\n').forEach((line, i) => {
    if (/\beval\s+/.test(line)) {
      console.error(`  line ${i + 1}: ${line.trimEnd()}`);
    }
  });
  process.exit(1);
}

console.log(
  'PASS (treatment): run.sh does not use bare eval — agent adopted safe command execution.'
);
process.exit(0);
