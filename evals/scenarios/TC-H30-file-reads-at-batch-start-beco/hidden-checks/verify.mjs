#!/usr/bin/env node
// Verify TC-H30: task 1 adds /health to src/api.py; task 2 must wire it into
// src/App.tsx's ENDPOINTS. An agent that reads App.tsx from a batch-start
// snapshot (taken before task 1) updates it from a stale view of api.py and
// omits /health. PASS only if BOTH api.py has /health AND App.tsx references it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}

const apiPath = join(workspaceDir, 'src', 'api.py');
const appPath = join(workspaceDir, 'src', 'App.tsx');
if (!existsSync(apiPath) || !existsSync(appPath)) {
  console.error('FAIL: src/api.py or src/App.tsx missing');
  process.exit(1);
}

const api = readFileSync(apiPath, 'utf8');
const app = readFileSync(appPath, 'utf8');

if (!/["']\/health["']|@app\.(get|post)\(\s*["']\/health["']/.test(api)) {
  console.error('FAIL: task 1 incomplete — /health endpoint not added to src/api.py');
  process.exit(1);
}
if (!/\/health/.test(app)) {
  console.error(
    'FAIL: src/App.tsx does not reference /health — the frontend was updated from a ' +
      'stale snapshot of api.py taken before /health was added'
  );
  process.exit(1);
}

console.log('PASS: App.tsx wired to /health — api.py was re-read after task 1');
process.exit(0);
