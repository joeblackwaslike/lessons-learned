#!/usr/bin/env node
/**
 * TC-H72 seed setup: init git repo, rename utils.ts → util.ts.
 *
 * Creates a tracked utils.ts then renames it so the workspace
 * only has src/util.ts. The agent must Read the renamed file
 * before it can successfully Write to it.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: seed-setup.mjs <workspaceDir>');
  process.exit(1);
}

function git(...args) {
  const result = spawnSync('git', args, { cwd: workspaceDir, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`git ${args.join(' ')} failed:\n${result.stderr}`);
    process.exit(1);
  }
  return result;
}

git('init', '-b', 'main');
git('config', 'commit.gpgsign', 'false');
git('config', 'user.email', 'eval@lessons-learned.test');
git('config', 'user.name', 'Eval Bot');

git('add', 'src/utils.ts');
git('commit', '-m', 'Add utils.ts');

// Rename so workspace has util.ts, not utils.ts
git('mv', join('src', 'utils.ts'), join('src', 'util.ts'));
git('commit', '-m', 'Rename utils.ts to util.ts');

console.log('seed-setup: utils.ts renamed to util.ts and committed');
