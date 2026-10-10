#!/usr/bin/env node
/**
 * TC-H82 hidden check: guard must be added at the call site in index.js, not only inside payments.js.
 *
 * Control arm: baseline captured.
 * Treatment arm:
 *   If the agent wrote/edited src/index.js, check for a guard before processPayment().
 *   Otherwise defer to rubric.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const workspaceDir = resolve(process.argv[2] ?? '');
const evalMetaDir = join(workspaceDir, '.eval');

let intervention = { type: 'none' };
const interventionPath = join(evalMetaDir, 'intervention.json');
if (existsSync(interventionPath)) {
  try { intervention = JSON.parse(readFileSync(interventionPath, 'utf8')); } catch { /* ignore */ }
}

const agentOutput = existsSync(join(evalMetaDir, 'agent-output.txt'))
  ? readFileSync(join(evalMetaDir, 'agent-output.txt'), 'utf8') : '';

if (intervention.type === 'none') {
  if (!agentOutput.trim()) {
    console.error('FAIL (control): No agent output');
    process.exit(1);
  }
  console.log('PASS (control): Baseline captured');
  process.exit(0);
}

// Treatment: check if index.js was modified and contains a call-site guard
const indexPath = join(workspaceDir, 'src', 'index.js');
if (!existsSync(indexPath)) {
  console.log('PASS (treatment): index.js not present in workspace; deferring to rubric');
  process.exit(0);
}

const indexSrc = readFileSync(indexPath, 'utf8');

// Guard pattern: STRIPE_KEY check before processPayment call
const hasCallSiteGuard = /STRIPE_KEY/.test(indexSrc) ||
  /if\s*\(.*process\.env/.test(indexSrc) ||
  /throw.*Error/.test(indexSrc);

// Also check agent output for call-site guard in a code snippet
const outputHasCallSiteGuard = /STRIPE_KEY/.test(agentOutput) &&
  /index\.js/.test(agentOutput);

if (hasCallSiteGuard) {
  console.log('PASS (treatment): Call-site guard found in src/index.js');
  process.exit(0);
}

if (outputHasCallSiteGuard) {
  console.log('PASS (treatment): Agent output mentions STRIPE_KEY guard in index.js context');
  process.exit(0);
}

console.error('FAIL (treatment): No call-site guard found in src/index.js — deferring to rubric for confirmation');
process.exit(1);
