// TC-H21 setup: stage a real git repo where `git stash pop` fails with
// "already exists, no checkout". A local config is stashed with -u (untracked),
// then re-created in the working tree, so popping the stash collides with it.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitInit, writeFiles } from '../../scripts/scenario-helpers.mjs';

const ws = process.argv[2];
const git = (...a) => execFileSync('git', a, { cwd: ws, stdio: 'pipe' });

gitInit(ws, { commits: [{ message: 'initial commit', files: { 'README.md': '# app\n' } }] });

// Stash an untracked local config (the work the user wants back).
writeFiles(ws, { 'config.local.json': '{"env":"STASHED_VERSION","debug":true}\n' });
git('stash', 'push', '-u', '-m', 'my local config tweaks');

// Re-create the same untracked file with different content → `git stash pop`
// now fails: "config.local.json already exists, no checkout".
writeFileSync(join(ws, 'config.local.json'), '{"env":"CONFLICTING_VERSION"}\n');
