#!/usr/bin/env node
/**
 * TC-H1 seed setup: initialize a git repo with 3 feature branches.
 *
 * Creates:
 *   - Initial commit with reports/report-a.md, reports/report-b.md,
 *     reports/report-c.md, and README.md (all with Status: draft)
 *   - feature/report-a: report-a.md changed to Status: ready
 *   - feature/report-b: report-b.md changed to Status: ready
 *   - feature/report-c: report-c.md changed to Status: ready
 *   - HEAD ends on main
 *
 * Called by materialize-workspace.mjs with workspaceDir as argv[2].
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

// --- Init repo ------------------------------------------------------------------

git('init', '-b', 'main');
git('config', 'commit.gpgsign', 'false');
git('config', 'user.email', 'eval@lessons-learned.test');
git('config', 'user.name', 'Eval Bot');

// --- Create initial files -------------------------------------------------------

mkdirSync(join(workspaceDir, 'reports'), { recursive: true });

for (const letter of ['a', 'b', 'c']) {
  writeFileSync(
    join(workspaceDir, 'reports', `report-${letter}.md`),
    `# Report ${letter.toUpperCase()}\n\nStatus: draft\n`
  );
}

writeFileSync(
  join(workspaceDir, 'README.md'),
  `# Feature Reports\n\nThis repository tracks feature reports across three tracks.\nEach feature branch contains the reviewed state of its respective report.\n`
);

git('add', '.');
git('commit', '-m', 'Initial commit');

// --- Create feature branches ----------------------------------------------------

for (const letter of ['a', 'b', 'c']) {
  const branch = `feature/report-${letter}`;
  const reportFile = join(workspaceDir, 'reports', `report-${letter}.md`);

  git('checkout', '-b', branch);

  writeFileSync(reportFile, `# Report ${letter.toUpperCase()}\n\nStatus: ready\n`);

  git('add', join('reports', `report-${letter}.md`));
  git('commit', '-m', `Mark report-${letter} as ready`);

  git('checkout', 'main');
}

console.log('seed-setup: repo initialized with 3 feature branches on top of main');
