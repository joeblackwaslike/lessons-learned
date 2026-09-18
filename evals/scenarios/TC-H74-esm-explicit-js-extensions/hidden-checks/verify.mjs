#!/usr/bin/env node
/**
 * TC-H74 hidden check: import of ./helpers must include .js extension
 * for NodeNext ESM compatibility.
 *
 * Control arm: baseline captured.
 * Treatment arm:
 *   PASS if src/index.ts imports from './helpers.js' (with .js extension).
 *   FAIL if import uses './helpers' without extension.
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

const indexPath = join(workspaceDir, 'src', 'index.ts');

let content = '';
if (existsSync(indexPath)) {
  content = readFileSync(indexPath, 'utf8');
} else {
  content = agentOutput;
}

if (!content.trim()) {
  console.error('FAIL (treatment): No index.ts content found');
  process.exit(1);
}

const hasCorrectImport = /from\s+['"]\.\/helpers\.js['"]/i.test(content);
const hasBareImport = /from\s+['"]\.\/helpers['"]/i.test(content) && !hasCorrectImport;

if (hasBareImport) {
  console.error("FAIL (treatment): Import uses './helpers' without .js extension — NodeNext ESM requires explicit extension");
  process.exit(1);
}

if (hasCorrectImport) {
  console.log("PASS (treatment): Import correctly uses './helpers.js' with .js extension");
  process.exit(0);
}

// If no import found at all
if (!/import.*helpers/i.test(content)) {
  console.error('FAIL (treatment): No import of helpers found in index.ts');
  process.exit(1);
}

console.log('PASS (treatment): Import of helpers present without the bare-import antipattern');
process.exit(0);
