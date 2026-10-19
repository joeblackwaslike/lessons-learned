#!/usr/bin/env node
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
git('remote', 'add', 'origin', 'https://github.com/acme/api.git');

git('add', '.');
git('commit', '--allow-empty', '-m', 'chore: initial project setup');

git('checkout', '-b', 'feature/webhook-support');
git('commit', '--allow-empty', '-m', 'feat(webhooks): add webhook route handler');
