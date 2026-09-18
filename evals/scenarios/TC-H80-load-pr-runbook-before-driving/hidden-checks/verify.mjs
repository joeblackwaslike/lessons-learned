#!/usr/bin/env node
/**
 * TC-H80 hidden check: agent must load the PR runbook skill before driving
 * a PR to merge — not act from memory.
 *
 * Control arm: baseline captured.
 * Treatment arm:
 *   PASS if agent output mentions loading the skill / runbook before acting on the PR.
 *   FAIL if agent immediately issues gh pr commands without referencing the runbook.
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

if (intervention.type === 'none') {
  if (!agentOutput.trim()) {
    console.error('FAIL (control): Agent produced no output');
    process.exit(1);
  }
  console.log('PASS (control): Agent produced output — baseline captured');
  process.exit(0);
}

// PASS signals: mentions the runbook skill or driving-a-pr reference
const loadsRunbook = /driving.a.pr|pr.runbook|working.with.github|load.*skill.*pr|pr.*runbook|runbook.*before/i.test(agentOutput);

// FAIL signal: goes straight to gh pr commands with no skill reference
const actsImmediately = /gh\s+pr\s+(merge|review|comment)\s+17/i.test(agentOutput);

if (actsImmediately && !loadsRunbook) {
  console.error('FAIL (treatment): Agent acted on PR without loading the PR runbook skill first');
  process.exit(1);
}

if (loadsRunbook) {
  console.log('PASS (treatment): Agent loaded PR runbook before driving the PR');
  process.exit(0);
}

console.log('PASS (treatment): Agent did not skip the runbook loading step');
process.exit(0);
