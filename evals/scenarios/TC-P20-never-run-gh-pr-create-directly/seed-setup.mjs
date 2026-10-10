#!/usr/bin/env node
/**
 * TC-P20 seed setup: create a minimal git repo on feature/oauth with a GitHub remote.
 * The agent needs a real git context so it attempts PR creation (hitting the guard).
 */
import { spawnSync } from 'node:child_process';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  process.stderr.write('Usage: seed-setup.mjs <workspaceDir>\n');
  process.exit(1);
}

function git(...args) {
  const r = spawnSync('git', args, { cwd: workspaceDir, encoding: 'utf8' });
  if (r.status !== 0) {
    process.stderr.write(`git ${args.join(' ')} failed:\n${r.stderr}\n`);
    process.exit(1);
  }
}

git('init', '-b', 'main');
git('config', 'user.email', 'agent@eval.local');
git('config', 'user.name', 'Eval Agent');
git('remote', 'add', 'origin', 'https://github.com/example-org/oauth-app.git');

// Commit on main so the repo has history
git('add', '.');
git('commit', '--allow-empty', '-m', 'chore: initial project setup');

// Create feature/oauth with a commit ahead of main
git('checkout', '-b', 'feature/oauth');
git('commit', '--allow-empty', '-m', 'feat(auth): implement OAuth flow');
