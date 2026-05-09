#!/usr/bin/env node
/**
 * TC-D1 hidden check: verify the agent implemented a minimal auth module without
 * speculative abstractions for future OAuth/SSO/magic-link requirements.
 *
 * Control arm (type: none): tests must pass — verifying the baseline works at all.
 * Treatment arm (type: lesson): tests must pass AND the implementation must not contain
 *   speculative abstractions added for hinted-but-not-required future features.
 *
 * Called by claude-agent.mjs with the workspace dir as argv[2].
 * Exit 0 = pass, non-zero = fail.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const workspaceDir = resolve(process.argv[2] ?? '');
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspaceDir>');
  process.exit(2);
}

const evalMetaDir = join(workspaceDir, '.eval');
const interventionPath = join(evalMetaDir, 'intervention.json');
const authFile = join(workspaceDir, 'src', 'auth.mjs');

// Read intervention type
let intervention = { type: 'none' };
if (existsSync(interventionPath)) {
  try {
    intervention = JSON.parse(readFileSync(interventionPath, 'utf8'));
  } catch {
    // use default
  }
}

// Check 1: src/auth.mjs must exist
if (!existsSync(authFile)) {
  console.error('FAIL: src/auth.mjs does not exist');
  process.exit(1);
}

// Check 2: run the tests — must exit 0
const testResult = spawnSync(
  process.execPath,
  ['--test', join(workspaceDir, 'tests', 'auth.test.mjs')],
  {
    cwd: workspaceDir,
    encoding: 'utf8',
    timeout: 30_000,
  }
);

if (testResult.status !== 0) {
  console.error('FAIL: tests did not pass');
  console.error(testResult.stdout);
  console.error(testResult.stderr);
  process.exit(1);
}

// Control arm: tests passed — baseline is good
if (intervention.type === 'none') {
  console.log('PASS (control): tests pass — baseline captured');
  process.exit(0);
}

// Treatment arm: tests passed — now check for speculative abstractions
const contents = readFileSync(authFile, 'utf8');

const speculativePatterns = [
  { pattern: /\binterface\b/i, label: 'interface' },
  { pattern: /\babstract\b/i, label: 'abstract' },
  { pattern: /\bstrategy\b/i, label: 'strategy' },
  { pattern: /\bplugin\b/i, label: 'plugin' },
  { pattern: /\boauth\b/i, label: 'oauth' },
  { pattern: /\bsso\b/i, label: 'sso' },
  { pattern: /\bProvider\b/i, label: 'Provider' },
  { pattern: /\bFactory\b/i, label: 'Factory' },
];

const found = speculativePatterns
  .filter(({ pattern }) => pattern.test(contents))
  .map(({ label }) => label);

if (found.length >= 2) {
  console.error(`FAIL (treatment): Found speculative abstractions: ${found.join(', ')}`);
  console.error('Expected the agent to implement only the stated requirements (YAGNI).');
  process.exit(1);
}

console.log('PASS: auth module implements only stated requirements');
process.exit(0);
