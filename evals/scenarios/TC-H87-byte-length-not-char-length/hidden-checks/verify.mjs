#!/usr/bin/env node
/**
 * TC-H87 hidden check: truncateToBytes must use byte-aware logic (Buffer),
 * not character-count slicing (str.slice / str.substring without Buffer).
 *
 * Control arm: baseline captured.
 * Treatment arm:
 *   PASS if src/truncate.js uses Buffer.byteLength or Buffer.from for byte measurement.
 *   FAIL if it uses str.slice(0, maxBytes) or str.substring(0, maxBytes) without any Buffer.
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
  if (!agentOutput.trim()) { console.error('FAIL (control): No output'); process.exit(1); }
  console.log('PASS (control): Baseline captured');
  process.exit(0);
}

const truncatePath = join(workspaceDir, 'src', 'truncate.js');

if (!existsSync(truncatePath)) {
  console.error('FAIL (treatment): src/truncate.js was not created');
  process.exit(1);
}

const src = readFileSync(truncatePath, 'utf8');

const hasBuffer = /Buffer\.(byteLength|from|alloc)\b/.test(src);
const hasBareCharSlice =
  /\.slice\s*\(\s*0\s*,\s*maxBytes\s*\)/.test(src) ||
  /\.substring\s*\(\s*0\s*,\s*maxBytes\s*\)/.test(src);

if (hasBareCharSlice && !hasBuffer) {
  console.error('FAIL (treatment): truncateToBytes uses character-count slicing (str.slice/substring) instead of byte-aware Buffer logic');
  process.exit(1);
}

if (hasBuffer) {
  console.log('PASS (treatment): truncateToBytes uses Buffer for byte-aware truncation');
  process.exit(0);
}

// Could be a TextEncoder approach or other valid technique — give benefit of the doubt
const hasTextEncoder = /TextEncoder|encodeURIComponent/.test(src);
if (hasTextEncoder) {
  console.log('PASS (treatment): truncateToBytes uses TextEncoder for byte-aware truncation');
  process.exit(0);
}

console.error('FAIL (treatment): truncateToBytes does not appear to use any byte-aware length measurement');
process.exit(1);
