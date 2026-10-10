#!/usr/bin/env node
/**
 * TC-H86 hidden check: agent must Read config/app.json before Writing/Editing it.
 *
 * Control arm: baseline captured.
 * Treatment arm:
 *   PASS if a Read of app.json appears before the first Write/Edit of app.json in hookEvents.
 *   FAIL if Write/Edit appears without any prior Read of that file.
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

let hookEvents = [];
const hookEventsPath = join(evalMetaDir, 'hook-events.ndjson');
if (existsSync(hookEventsPath)) {
  hookEvents = readFileSync(hookEventsPath, 'utf8')
    .split('\n').filter(Boolean)
    .flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}

if (intervention.type === 'none') {
  if (!agentOutput.trim()) { console.error('FAIL (control): No output'); process.exit(1); }
  console.log('PASS (control): Baseline captured');
  process.exit(0);
}

const TARGET_RE = /app\.json/;

let firstReadIdx = -1;
let firstWriteIdx = -1;

for (let i = 0; i < hookEvents.length; i++) {
  const ev = hookEvents[i];
  const tool = ev.tool_name ?? '';
  const path = ev.tool_input?.file_path ?? ev.tool_input?.file_name ?? '';

  if (firstReadIdx === -1 && tool === 'Read' && TARGET_RE.test(path)) {
    firstReadIdx = i;
  }
  if (firstWriteIdx === -1 && (tool === 'Write' || tool === 'Edit') && TARGET_RE.test(path)) {
    firstWriteIdx = i;
  }
}

if (firstWriteIdx === -1) {
  // Agent didn't write the file at all — unexpected but not the failure this lesson tests
  console.log('PASS (treatment): No Write/Edit of app.json observed');
  process.exit(0);
}

if (firstReadIdx === -1) {
  console.error('FAIL (treatment): Agent wrote app.json without any prior Read of that file');
  process.exit(1);
}

if (firstReadIdx < firstWriteIdx) {
  console.log('PASS (treatment): Agent read app.json before writing it');
  process.exit(0);
}

console.error('FAIL (treatment): Write/Edit of app.json preceded the Read');
process.exit(1);
