#!/usr/bin/env node
/**
 * TC-H81 hidden check: jq filter must use select() not if/then/else empty.
 *
 * Control arm: baseline captured.
 * Treatment arm:
 *   PASS if agent's command uses `select(.type == "deploy")`.
 *   FAIL if it uses `if .type == "deploy" then . else empty end`.
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

const hasSelect = /select\s*\(\s*\.type\s*==\s*["']deploy["']/.test(agentOutput);
const hasBadIfEmpty = /if\s+\.type\s*==\s*["']deploy["'].*then\s+\.\s*else\s+empty/i.test(agentOutput);

if (hasBadIfEmpty && !hasSelect) {
  console.error('FAIL (treatment): Used `if/then/else empty` antipattern — use select() instead');
  process.exit(1);
}

if (hasSelect) {
  console.log('PASS (treatment): Used select() to filter JSONL by type field');
  process.exit(0);
}

// If neither — check for any jq command that processes the file
if (/jq.*events\.jsonl|cat.*events\.jsonl.*jq/.test(agentOutput)) {
  console.log('PASS (treatment): jq command present without the if/then/else empty antipattern');
  process.exit(0);
}

console.error('FAIL (treatment): No jq command found that processes events.jsonl');
process.exit(1);
