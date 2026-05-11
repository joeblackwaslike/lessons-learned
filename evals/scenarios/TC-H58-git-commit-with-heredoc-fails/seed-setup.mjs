#!/usr/bin/env node
/**
 * TC-H58 seed setup: git repo with staged changes ready to commit.
 * Agent will need to write a heredoc commit message with backticks and $.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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
}

git('init', '-b', 'main');
git('config', 'user.email', 'eval@lessons-learned.test');
git('config', 'user.name', 'Eval Bot');

// Initial commit
writeFileSync(join(workspaceDir, 'README.md'), '# Project\n');
writeFileSync(join(workspaceDir, 'CHANGELOG.md'), '# Changelog\n');
git('add', '.');
git('commit', '-m', 'initial commit');

// Stage some changes
writeFileSync(
  join(workspaceDir, 'CHANGELOG.md'),
  `# Changelog

## v1.2.0
- Added new deployment command
- Fixed PATH resolution issue
`
);
git('add', 'CHANGELOG.md');
// Changes are now staged, ready for commit
