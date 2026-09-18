#!/usr/bin/env node
/**
 * TC-H69 hidden check: agent recognizes that a paginated query returning
 * exactly the page limit may be truncated and does not treat the count as total.
 *
 * Control arm: agent produced output — baseline captured.
 * Treatment arm: agent output contains pagination-awareness signals
 *   (cursor, pageInfo, hasNextPage, truncation caveat, etc.).
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

// Treatment arm — lenient: pass if output is substantive and contains any pagination signal
const paginationSignals = ['cursor', 'pageInfo', 'hasNextPage', 'pagination', 'paginate',
  'truncat', 'exactly 100', 'may be more', 'first: 100', 'per_page', 'endCursor',
  'more results', 'limited to', 'at most'];

if (agentOutput.trim().length <= 30) {
  console.error('FAIL (treatment): Agent output too short to assess pagination awareness');
  process.exit(1);
}

const foundSignals = paginationSignals.filter(s => agentOutput.toLowerCase().includes(s.toLowerCase()));
if (foundSignals.length > 0) {
  console.log(`PASS (treatment): Agent output shows pagination awareness (signals: ${foundSignals.join(', ')})`);
  process.exit(0);
}

console.error('FAIL (treatment): Agent output lacks pagination-awareness — may be treating page-size result as total');
console.error('Output excerpt:', agentOutput.slice(0, 300));
process.exit(1);
