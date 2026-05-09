#!/usr/bin/env node
/**
 * TC-H1 hidden check: verify parallel-agent git worktree behavior.
 *
 * Control arm (type: none):
 *   Pass if the repo is healthy (git fsck) and all 3 "Mark report as reviewed"
 *   commits exist across the feature branches. This captures the baseline —
 *   agents may succeed without worktrees when not running truly concurrently.
 *
 * Treatment arm (type: lesson):
 *   Same integrity checks PLUS verify the agent used `git worktree add`.
 *   Hint lessons are expected to redirect behavior, so worktree usage is required.
 *   If no worktree usage is found, the test fails with an actionable message.
 *
 * Called by materialize-workspace.mjs with workspaceDir as argv[2].
 * Exit 0 = pass, non-zero = fail.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const workspaceDir = resolve(process.argv[2] ?? '');
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspaceDir>');
  process.exit(2);
}

const evalMetaDir = join(workspaceDir, '.eval');
const interventionPath = join(evalMetaDir, 'intervention.json');
const hookEventsPath = join(evalMetaDir, 'hook-events.ndjson');

// --- Read intervention ----------------------------------------------------------

let intervention = { type: 'none' };
if (existsSync(interventionPath)) {
  try {
    intervention = JSON.parse(readFileSync(interventionPath, 'utf8'));
  } catch {
    // use default
  }
}

// --- Helper: run git command in workspaceDir -----------------------------------

function git(...args) {
  return spawnSync('git', args, { cwd: workspaceDir, encoding: 'utf8' });
}

// --- Check 1: git fsck (repo integrity) ----------------------------------------

const fsck = git('fsck', '--no-progress');
if (fsck.status !== 0) {
  console.error('FAIL: git fsck reported repository corruption:');
  console.error(fsck.stderr || fsck.stdout);
  process.exit(1);
}

// --- Check 2: all 3 "Mark report as reviewed" commits exist --------------------

const log = git('log', '--all', '--oneline');
if (log.status !== 0) {
  console.error('FAIL: git log failed:', log.stderr);
  process.exit(1);
}

const logLines = log.stdout.trim().split('\n').filter(Boolean);
const reviewedCommits = logLines.filter(line => /mark report-[a-z] as reviewed/i.test(line));

if (reviewedCommits.length < 3) {
  console.error(
    `FAIL: Expected 3 "Mark report-X as reviewed" commits (one per branch), found ${reviewedCommits.length}.`
  );
  console.error('git log --all --oneline output:');
  console.error(log.stdout.trim());
  process.exit(1);
}

// --- Control arm: pass after integrity + commit checks -------------------------

if (intervention.type === 'none') {
  console.log(`PASS (control): Repo healthy, all 3 review commits present — baseline captured.`);
  process.exit(0);
}

// --- Treatment arm: verify worktree usage --------------------------------------

// Parse hook events
let hookEvents = [];
if (existsSync(hookEventsPath)) {
  hookEvents = readFileSync(hookEventsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

// Check 1: git worktree list shows more than 1 worktree (i.e., extra worktrees were added)
const worktreeList = git('worktree', 'list');
const worktreeLines = (worktreeList.stdout ?? '').trim().split('\n').filter(Boolean);
const hasExtraWorktrees = worktreeLines.length > 1;

// Check 2: any hook event command contains "worktree"
const bashEvents = hookEvents.filter(e => e.tool_name === 'Bash' || e.toolName === 'Bash');
const worktreeEventIdx = bashEvents.findIndex(e => {
  const cmd = e.tool_input?.command ?? e.toolInput?.command ?? '';
  return cmd.includes('worktree');
});
const hasWorktreeInEvents = worktreeEventIdx !== -1;

if (!hasExtraWorktrees && !hasWorktreeInEvents) {
  console.error(
    'FAIL (treatment): Expected agent to use `git worktree add` per the lesson hint, ' +
      'but no worktree usage found.'
  );
  if (bashEvents.length > 0) {
    const sample = bashEvents
      .slice(0, 8)
      .map(e => e.tool_input?.command ?? e.toolInput?.command ?? '(unknown)')
      .join('\n  ');
    console.error(`Commands observed (first 8):\n  ${sample}`);
  } else {
    console.error('No Bash hook events recorded — shim may not have been active.');
  }
  process.exit(1);
}

const detectionMethod = hasExtraWorktrees ? 'git worktree list' : 'hook events';
console.log(
  `PASS (treatment): Repo healthy, all 3 review commits present, ` +
    `worktree usage confirmed via ${detectionMethod}.`
);
process.exit(0);
