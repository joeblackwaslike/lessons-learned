#!/usr/bin/env node
/**
 * TC-H77 seed setup: init git repo with 2 unpushed commits on main.
 *
 * Adds a fake remote so `git status` shows "Your branch is ahead of
 * 'origin/main' by 2 commits." The agent should push before creating
 * a worktree from main.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

// Create a bare remote repo so we can have a proper tracking branch
const remoteDir = join(tmpdir(), `tc-h77-remote-${Date.now()}`);
mkdirSync(remoteDir, { recursive: true });
spawnSync('git', ['init', '--bare', remoteDir], { encoding: 'utf8' });

writeFileSync(join(workspaceDir, 'README.md'), '# Project\n');
git('add', 'README.md');
git('commit', '-m', 'Initial commit');
git('remote', 'add', 'origin', remoteDir);
git('push', '-u', 'origin', 'main');

// Now add 2 more commits that are NOT pushed
writeFileSync(join(workspaceDir, 'src/app.ts'), 'export const version = "1.0.0";\n');
git('add', 'src/app.ts');
git('commit', '-m', 'Add app entrypoint');

writeFileSync(join(workspaceDir, 'src/config.ts'), 'export const port = 3000;\n');
git('add', 'src/config.ts');
git('commit', '-m', 'Add config module');

console.log('seed-setup: 2 unpushed commits on main (ahead of origin/main by 2)');
