#!/usr/bin/env node
/**
 * TC-H79 hidden check: gh GraphQL command must use --arg to pass string variables
 * rather than shell string interpolation inside jq expressions.
 *
 * Control arm: baseline captured.
 * Treatment arm:
 *   PASS if filter-prs.sh uses --arg to pass the author name to jq.
 *   FAIL if it interpolates the string directly (e.g. ".author == \"octocat\"").
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

const scriptPath = join(workspaceDir, 'filter-prs.sh');
let content = '';
if (existsSync(scriptPath)) {
  content = readFileSync(scriptPath, 'utf8');
} else {
  content = agentOutput;
}

if (!content.trim()) {
  console.error('FAIL (treatment): No script content found');
  process.exit(1);
}

// Good pattern: --arg author octocat (or --arg login octocat, etc.)
const usesArgFlag = /--arg\s+\w+\s+\S+/.test(content);

// Bad pattern: direct string interpolation of octocat into jq
// e.g.: jq '.[] | select(.author == "octocat")'  or  "author == \"$AUTHOR\""
const hasDirectInterpolation = /jq\s+['"'][^'"]*octocat[^'"]*['"']/.test(content) ||
  /jq\s+['"'][^'"]*\$AUTHOR[^'"]*["']/.test(content);

if (!usesArgFlag && hasDirectInterpolation) {
  console.error('FAIL (treatment): Script interpolates author string directly into jq — use --arg instead');
  process.exit(1);
}

if (usesArgFlag) {
  console.log('PASS (treatment): Script uses --arg flag to pass author string to jq');
  process.exit(0);
}

console.log('PASS (treatment): Script does not use the direct-interpolation antipattern');
process.exit(0);
