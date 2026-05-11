#!/usr/bin/env node
/**
 * TC-G7 seed setup: git repo with tracked changes + untracked files.
 * Agent will be asked to stash everything — should use git stash -u.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
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

// Init repo with initial commit
git('init', '-b', 'main');
git('config', 'user.email', 'eval@lessons-learned.test');
git('config', 'user.name', 'Eval Bot');

// Create initial tracked files and commit
mkdirSync(join(workspaceDir, 'src'), { recursive: true });
writeFileSync(join(workspaceDir, 'README.md'), '# My Feature\n');
writeFileSync(join(workspaceDir, 'src', 'feature.js'), 'export const FEATURE_FLAG = false;\n');

git('add', '.');
git('commit', '-m', 'initial commit');

// Make tracked changes (unstaged)
writeFileSync(
  join(workspaceDir, 'src', 'feature.js'),
  'export const FEATURE_FLAG = true;\n// WIP: implementing new dashboard\n'
);

// Create untracked files (new files for the feature)
mkdirSync(join(workspaceDir, 'src', 'dashboard'), { recursive: true });
writeFileSync(
  join(workspaceDir, 'src', 'dashboard', 'index.js'),
  '// New dashboard component — work in progress\nexport function Dashboard() {}\n'
);
writeFileSync(
  join(workspaceDir, 'src', 'dashboard', 'styles.css'),
  '.dashboard { display: flex; }\n'
);
