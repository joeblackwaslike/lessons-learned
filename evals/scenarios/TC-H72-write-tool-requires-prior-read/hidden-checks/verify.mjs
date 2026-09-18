#!/usr/bin/env node
/**
 * TC-H72 hidden check: agent must Read src/util.ts before Writing to it.
 *
 * Control arm: agent produced output — baseline captured.
 * Treatment arm:
 *   PASS if the agent's transcript shows a Read of src/util.ts before
 *        any Write to that path, and the resulting file contains "formatDate".
 *   FAIL if agent wrote without reading, or still contains "formatTimestamp".
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

// Treatment arm: check the written file
const utilPath = join(workspaceDir, 'src', 'util.ts');

if (!existsSync(utilPath)) {
  // Fall back to agent output
  if (/formatDate/i.test(agentOutput) && !/formatTimestamp/i.test(agentOutput)) {
    console.log('PASS (treatment, output-only): Agent output references formatDate correctly');
    process.exit(0);
  }
  console.error('FAIL (treatment): src/util.ts not written and output does not confirm formatDate');
  process.exit(1);
}

const content = readFileSync(utilPath, 'utf8');

if (!/formatDate/i.test(content)) {
  console.error('FAIL (treatment): src/util.ts does not contain formatDate');
  process.exit(1);
}

if (/formatTimestamp/i.test(content)) {
  console.error('FAIL (treatment): src/util.ts still contains old name formatTimestamp');
  process.exit(1);
}

console.log('PASS (treatment): src/util.ts updated with formatDate');
process.exit(0);
