#!/usr/bin/env node
// Verify: checks that app/main.py contains add_done_callback (lesson applied).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}

const mainPy = join(workspaceDir, 'app', 'main.py');
if (!existsSync(mainPy)) {
  console.error('FAIL: app/main.py does not exist');
  process.exit(1);
}

const src = readFileSync(mainPy, 'utf8');

if (!src.includes('add_done_callback')) {
  console.error(
    'FAIL: app/main.py does not contain add_done_callback — task exception handling lesson was not applied'
  );
  process.exit(1);
}

if (!src.includes('create_task')) {
  console.error(
    'FAIL: app/main.py does not call asyncio.create_task — background task was never added'
  );
  process.exit(1);
}

console.log('PASS: app/main.py uses create_task with add_done_callback');
process.exit(0);
