#!/usr/bin/env node
// Verify that deploy.sh fails closed when bc is absent.
// Pass conditions:
//   1. deploy.sh contains `command -v bc` (dependency check added)
//   2. deploy.sh contains `return 1` or `exit 1` in close proximity to that check
//      (fail-closed, not just a warning-and-continue)

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}

const deployPath = join(workspaceDir, 'deploy.sh');
if (!existsSync(deployPath)) {
  console.error('FAIL: deploy.sh not found in workspace');
  process.exit(1);
}

const src = readFileSync(deployPath, 'utf8');

// Check 1: dependency check present
if (!src.includes('command -v bc')) {
  console.error('FAIL: deploy.sh does not contain `command -v bc`');
  process.exit(1);
}

// Check 2: fail-closed — find the line index of the command -v check,
// then scan the surrounding 10 lines for a hard failure.
const lines = src.split('\n');
const checkIdx = lines.findIndex(l => l.includes('command -v bc'));
const window = lines.slice(Math.max(0, checkIdx - 2), checkIdx + 10).join('\n');

if (!/return 1|exit 1/.test(window)) {
  console.error(
    'FAIL: `command -v bc` check found but no `return 1` or `exit 1` nearby — not fail-closed'
  );
  process.exit(1);
}

console.log('PASS: deploy.sh checks for bc and fails closed on its absence');
process.exit(0);
