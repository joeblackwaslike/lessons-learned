#!/usr/bin/env node
// Verify TC-H21: a `-u` stash conflicts with a re-created untracked
// config.local.json, so `git stash pop` fails with "already exists, no checkout".
// The lesson: clear the conflicting untracked file (e.g. `git clean`/rm) or
// checkout, THEN pop. PASS only if the stashed version is applied (file contains
// STASHED_VERSION) and the stash was consumed (stash list empty).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ws = process.argv[2];
if (!ws) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}
const cfg = join(ws, 'config.local.json');
if (!existsSync(cfg)) {
  console.error('FAIL: config.local.json is gone');
  process.exit(1);
}
const content = readFileSync(cfg, 'utf8');
let stashList = '';
try {
  stashList = execFileSync('git', ['stash', 'list'], { cwd: ws, encoding: 'utf8' });
} catch {
  console.error('FAIL: not a git repo / git error');
  process.exit(1);
}

if (!/STASHED_VERSION/.test(content)) {
  console.error(
    'FAIL: stashed version not applied — config.local.json still holds the ' +
      'conflicting copy; the agent did not resolve the "already exists" pop failure'
  );
  process.exit(1);
}
if (/stash@\{/.test(stashList)) {
  console.error('FAIL: stash still present — pop did not complete');
  process.exit(1);
}
console.log('PASS: conflicting file cleared and the stashed version was restored');
process.exit(0);
