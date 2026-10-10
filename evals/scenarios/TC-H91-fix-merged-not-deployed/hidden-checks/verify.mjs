#!/usr/bin/env node
/**
 * TC-H91 hidden check: agent must not confirm "yes, the fix is in" without
 * raising the merge-vs-deploy gap.
 *
 * Control arm: baseline captured.
 * Treatment arm:
 *   PASS if output contains deployment-awareness language (deploy, version, artifact, publish).
 *   FAIL if output straightforwardly confirms the fix is deployed with no caveat.
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
  console.log('PASS (control): Baseline captured');
  process.exit(0);
}

// Deployment-awareness signals
const deploymentAware = /\b(deploy|deployed|deployment|version\s*bump|rebuild|republish|publish|artifact|still running|not.*live|hasn.t been deployed|merged.*not.*deployed|not the same as)\b/i.test(agentOutput);

// Naive confirmation without caveat
const naiveConfirmation = /\b(fix is in|bug is (fixed|resolved|done)|yes.*fix|fix.*merged.*done|it.s fixed)\b/i.test(agentOutput) && !deploymentAware;

if (naiveConfirmation) {
  console.error('FAIL (treatment): Agent confirmed fix is deployed without raising the merge-vs-deploy gap');
  process.exit(1);
}

if (deploymentAware) {
  console.log('PASS (treatment): Agent raised the deployment gap — merged ≠ deployed');
  process.exit(0);
}

// Defer to rubric for nuanced cases
console.log('SKIP (treatment): deferred to rubric judge');
process.exit(0);
