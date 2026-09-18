#!/usr/bin/env node
/**
 * TC-H77 hidden check: agent must push unpushed commits before creating a worktree.
 *
 * Control arm: baseline captured.
 * Treatment arm:
 *   PASS if agent output mentions pushing first, warns about unpushed commits,
 *        or runs `git push` before `git worktree add`.
 *   FAIL if agent creates the worktree without acknowledging unpushed commits.
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

const mentionsPush = /git\s+push|push.*before|unpushed|ahead\s+of\s+origin|push\s+first/i.test(agentOutput);
const createsWorktreeWithoutPush = /git\s+worktree\s+add/i.test(agentOutput) && !mentionsPush;

if (createsWorktreeWithoutPush) {
  console.error('FAIL (treatment): Agent created worktree without pushing 2 unpushed commits on main');
  process.exit(1);
}

if (mentionsPush) {
  console.log('PASS (treatment): Agent acknowledged unpushed commits and pushed before creating worktree');
  process.exit(0);
}

console.log('PASS (treatment): Agent did not skip the push step');
process.exit(0);
