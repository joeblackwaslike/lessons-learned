#!/usr/bin/env node
/**
 * TC-H93 hidden check: periodic worker must include an inFlight boolean guard
 * to skip concurrent invocations.
 *
 * Control arm: baseline captured if agent produces output or writes the file.
 * Treatment arm:
 *   PASS if src/embedding-worker.js contains a boolean guard variable with a skip condition.
 *   FAIL if setInterval is used without any concurrency guard.
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

let intervention = { type: 'none' };
if (existsSync(interventionPath)) {
  try { intervention = JSON.parse(readFileSync(interventionPath, 'utf8')); } catch (_e) { /* ignore */ }
}

const agentOutput = existsSync(agentOutputPath) ? readFileSync(agentOutputPath, 'utf8') : '';
const workerFile = join(workspaceDir, 'src', 'embedding-worker.js');

if (intervention.type === 'none') {
  if (!agentOutput.trim() && !existsSync(workerFile)) {
    console.error('FAIL (control): Agent produced no output and did not write the worker file');
    process.exit(1);
  }
  console.log('PASS (control): Baseline captured');
  process.exit(0);
}

// Treatment: worker file must exist and contain a guard
if (!existsSync(workerFile)) {
  console.error('FAIL (treatment): src/embedding-worker.js was not written');
  process.exit(1);
}

const contents = readFileSync(workerFile, 'utf8');

// Check file was actually implemented (not just the stub)
const isStub = contents.includes('// TODO: implement') && !contents.includes('setInterval') && !contents.includes('let ') && !contents.includes('const ');
if (isStub) {
  console.error('FAIL (treatment): src/embedding-worker.js was not implemented — still shows stub');
  process.exit(1);
}

// Check for periodic execution (setInterval or equivalent)
const hasInterval = /setInterval|setTimeout|cron|schedule/i.test(contents);
if (!hasInterval) {
  console.error('FAIL (treatment): No periodic execution found (setInterval/setTimeout/cron)');
  process.exit(1);
}

// Check for a concurrency guard variable
const guardPatterns = [
  /\binFlight\b/,
  /\bisRunning\b/,
  /\brunning\b.*=\s*(true|false)/,
  /\bprocessing\b.*=\s*(true|false)/,
  /\blocked\b.*=\s*(true|false)/,
  /\bbusy\b.*=\s*(true|false)/,
  /\bactive\b.*=\s*(true|false)/,
];

const hasGuard = guardPatterns.some(pat => pat.test(contents));

if (!hasGuard) {
  console.error('FAIL (treatment): No inFlight/isRunning boolean guard found — concurrent invocations not protected');
  process.exit(1);
}

// Check the guard is actually used to skip (return early if true)
const hasSkipCondition = /if\s*\(\s*(inFlight|isRunning|running|processing|locked|busy|active)\s*\)/.test(contents) ||
  /if\s*\(\s*!(inFlight|isRunning|running|processing|locked|busy|active)\s*\)/.test(contents);

if (!hasSkipCondition) {
  console.error('FAIL (treatment): Guard variable found but no skip condition (if guard return) detected');
  process.exit(1);
}

console.log('PASS (treatment): Worker implements inFlight boolean guard with skip-on-concurrent logic');
process.exit(0);
