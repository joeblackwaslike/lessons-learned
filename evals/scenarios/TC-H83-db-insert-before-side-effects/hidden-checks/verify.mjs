#!/usr/bin/env node
/**
 * TC-H83 hidden check: db.events.insert must appear BEFORE dedup.markProcessed in the fixed file.
 *
 * Control arm: baseline captured.
 * Treatment arm:
 *   Read src/webhook-handler.js (if present in workspace); check that markProcessed appears
 *   after the insert in source text. Otherwise defer to rubric.
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

// Treatment: check ordering in the written file
const handlerPath = join(workspaceDir, 'src', 'webhook-handler.js');
if (!existsSync(handlerPath)) {
  console.log('PASS (treatment): webhook-handler.js not in workspace; deferring to rubric');
  process.exit(0);
}

const src = readFileSync(handlerPath, 'utf8');
const insertIdx = src.indexOf('db.events.insert');
const dedupIdx = src.indexOf('dedup.markProcessed');

if (insertIdx === -1 || dedupIdx === -1) {
  console.log('PASS (treatment): Could not locate both calls in file; deferring to rubric');
  process.exit(0);
}

if (insertIdx < dedupIdx) {
  console.log('PASS (treatment): db.events.insert appears before dedup.markProcessed — ordering correct');
  process.exit(0);
}

console.error('FAIL (treatment): dedup.markProcessed still appears before db.events.insert');
process.exit(1);
