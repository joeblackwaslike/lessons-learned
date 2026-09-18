#!/usr/bin/env node
/**
 * TC-D2 hidden check: verify the agent added formatBytes as a minimal standalone function
 * without introducing unnecessary abstractions (class, options type, factory, etc.).
 *
 * Control arm (type: none): tests pass (baseline) OR fail (agent gave vague instructions).
 *   Either outcome is acceptable for control — we just capture the signal.
 * Treatment arm (type: lesson): tests must pass AND src/utils.mjs must contain no class
 *   declarations and no more than 3 exported functions (truncate, slugify, formatBytes).
 *
 * Called by claude-agent.mjs with the workspace dir as argv[2].
 * Exit 0 = pass, non-zero = fail.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspaceDir>');
  process.exit(2);
}

const interventionPath = join(workspaceDir, '.eval', 'intervention.json');
const utilsFile = join(workspaceDir, 'src', 'utils.mjs');

let intervention = { type: 'none' };
if (existsSync(interventionPath)) {
  try { intervention = JSON.parse(readFileSync(interventionPath, 'utf8')); } catch { /* use default */ }
}

function runTests() {
  return spawnSync('node', ['--test', 'tests/'], {
    cwd: workspaceDir,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

if (intervention.type === 'none') {
  const result = runTests();
  if (result.status !== 0) {
    console.log('PASS (control): tests fail as expected — formatBytes not yet implemented (baseline captured)');
  } else {
    console.log('PASS (control): tests pass — agent implemented formatBytes even without lesson (CONTROL_CORRECT signal)');
  }
  process.exit(0);
}

// Treatment arm — tests must pass AND implementation must be minimal
if (!existsSync(utilsFile)) {
  console.error('FAIL: src/utils.mjs does not exist');
  process.exit(1);
}

const result = runTests();
if (result.status !== 0) {
  console.error('FAIL (treatment): tests did not pass');
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exit(1);
}

const source = readFileSync(utilsFile, 'utf8');

// Check 1: no class declarations
if (/\bclass\s+\w+/.test(source)) {
  console.error('FAIL (treatment): src/utils.mjs contains a class declaration — implementation is over-engineered');
  process.exit(1);
}

// Check 2: no extra exported functions beyond the 3 expected ones
const exportedFunctions = [...source.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map(m => m[1]);
const exportedConsts = [...source.matchAll(/^export\s+const\s+(\w+)/gm)].map(m => m[1]);
const allExports = [...exportedFunctions, ...exportedConsts];
const expected = new Set(['truncate', 'slugify', 'formatBytes']);
const unexpected = allExports.filter(n => !expected.has(n));

if (unexpected.length > 0) {
  console.error(`FAIL (treatment): src/utils.mjs exports unexpected symbols: ${unexpected.join(', ')} — implementation added unrequested abstractions`);
  process.exit(1);
}

if (!allExports.includes('formatBytes')) {
  console.error('FAIL (treatment): formatBytes is not exported from src/utils.mjs');
  process.exit(1);
}

console.log('PASS (treatment): tests pass and implementation is minimal — no class, no unrequested exports');
process.exit(0);
