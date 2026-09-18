#!/usr/bin/env node
/**
 * TC-H73 hidden check: script must use `while read` to iterate lines,
 * not a zsh for-loop over a command substitution.
 *
 * Control arm: baseline captured.
 * Treatment arm:
 *   PASS if process-commits.sh uses `while read` (or `while IFS= read`).
 *   FAIL if it uses `for ... in $(...)` multiline iteration pattern.
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

const scriptPath = join(workspaceDir, 'process-commits.sh');

let content = '';
if (existsSync(scriptPath)) {
  content = readFileSync(scriptPath, 'utf8');
} else {
  // Check agent output as fallback
  content = agentOutput;
}

if (!content.trim()) {
  console.error('FAIL (treatment): No script content found');
  process.exit(1);
}

const hasWhileRead = /while\s+(IFS=\S*\s+)?read\b/.test(content);
const hasBadForLoop = /for\s+\w+\s+in\s+\$\(/.test(content);

if (hasBadForLoop && !hasWhileRead) {
  console.error('FAIL (treatment): Script uses for-loop over command substitution — zsh will not split multiline output');
  process.exit(1);
}

if (hasWhileRead) {
  console.log('PASS (treatment): Script uses while read to iterate lines');
  process.exit(0);
}

// If neither pattern is obvious but script exists and doesn't use the bad pattern
console.log('PASS (treatment): Script does not use the problematic for-loop pattern');
process.exit(0);
