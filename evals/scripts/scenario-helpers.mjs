/**
 * scenario-helpers.mjs — reusable building blocks for a scenario's
 * `seed-setup.mjs`, which materialize-workspace.mjs runs after copying
 * seed-workspace/ into the eval workspace.
 *
 * The three things that make a scenario feel real should all be easy:
 *   - filesystem   → writeFiles()           (or just put files in seed-workspace/)
 *   - git state    → gitInit()              (history, branches, a stash, dirty tree)
 *   - broken test  → a failing test file in the seed + writeFiles() here
 *   - env vars     → scenario.json `env` (handled by the provider, not here)
 *
 * Example seed-setup.mjs:
 *   import { gitInit } from '../../scripts/scenario-helpers.mjs';
 *   const ws = process.argv[2];
 *   gitInit(ws, {
 *     commits: [{ message: 'initial', files: { 'README.md': '# proj\n' } }],
 *     branches: ['feature/auth'],
 *     stash: { message: 'wip', files: { 'src/auth.js': '// half-done\n' } },
 *     dirty: { 'src/app.js': 'export const x = 1\n' },
 *   });
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** Write a { 'relative/path': 'content' } map into the workspace. */
export function writeFiles(workspaceDir, files = {}) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(workspaceDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

/**
 * Initialise a git repo so the scenario feels like a real checkout.
 * @param {string} workspaceDir
 * @param {{
 *   commits?: { message?: string, files?: Record<string,string> }[],
 *   branches?: string[],
 *   stash?: { message?: string, files: Record<string,string> } | null,
 *   dirty?: Record<string,string> | null,
 *   user?: { name: string, email: string },
 * }} [opts]
 */
export function gitInit(
  workspaceDir,
  { commits = [], branches = [], stash = null, dirty = null, user } = {}
) {
  const git = (...args) => execFileSync('git', args, { cwd: workspaceDir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.name', user?.name ?? 'Eval Harness');
  git('config', 'user.email', user?.email ?? 'eval@example.com');
  git('config', 'commit.gpgsign', 'false');

  for (const c of commits) {
    if (c.files) writeFiles(workspaceDir, c.files);
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', c.message ?? 'wip');
  }
  for (const b of branches) git('branch', b);
  if (stash) {
    writeFiles(workspaceDir, stash.files);
    git('stash', 'push', '-u', '-m', stash.message ?? 'wip');
  }
  if (dirty) writeFiles(workspaceDir, dirty); // uncommitted changes left in the tree
}
