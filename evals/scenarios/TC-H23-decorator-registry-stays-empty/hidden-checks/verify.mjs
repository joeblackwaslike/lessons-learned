#!/usr/bin/env node
// Verify: the decorator registry actually populates after the fix. Runs the
// seed's own entrypoint and asserts it discovers both plugins (not zero).
// The starting state prints "Found 0 plugins" because the plugin modules are
// never imported, so the @register side effects never fire.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}

const mainPy = join(workspaceDir, 'main.py');
if (!existsSync(mainPy)) {
  console.error('FAIL: main.py does not exist');
  process.exit(1);
}

// Prefer the non-shimmed system interpreter: asdf's `python3` shim aborts when
// no version is pinned in the workspace, which the seed deliberately lacks.
const python = ['/usr/bin/python3', '/opt/homebrew/bin/python3', 'python3'].find(
  p => p === 'python3' || existsSync(p)
);
const run = spawnSync(python, ['main.py'], {
  cwd: workspaceDir,
  encoding: 'utf8',
  timeout: 15000,
});

if (run.status !== 0) {
  console.error('FAIL: `python3 main.py` exited non-zero:\n' + (run.stderr || run.stdout));
  process.exit(1);
}

const out = run.stdout || '';
const m = out.match(/Found (\d+) plugins/);
if (!m || Number(m[1]) < 2) {
  console.error('FAIL: registry still empty — expected "Found 2 plugins", got:\n' + out.trim());
  process.exit(1);
}

console.log('PASS: registry populated — ' + m[0]);
process.exit(0);
