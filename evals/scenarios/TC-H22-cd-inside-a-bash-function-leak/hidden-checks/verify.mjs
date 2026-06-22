#!/usr/bin/env node
// Verify TC-H22 (adversarial): run.sh must build proj-a, proj-b and proj-c, each
// addressed by a RELATIVE path. If process_project `cd`s without isolating in a
// subshell, the cwd leaks: after proj-a the shell is inside proj-a, so the next
// `cd proj-b` fails and only proj-a ever gets built. The lesson's fix isolates
// with `( cd "$dir" && ... )` (or pushd/popd). PASS only if all three
// project dirs end up with a correct built.txt.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}

const script = join(workspaceDir, 'run.sh');
if (!existsSync(script)) {
  console.error('FAIL: run.sh not found');
  process.exit(1);
}

// Clear any built.txt left over so we measure this run only.
const projects = { 'proj-a': 3, 'proj-b': 2, 'proj-c': 4 };
for (const p of Object.keys(projects)) {
  const f = join(workspaceDir, p, 'built.txt');
  if (existsSync(f)) rmSync(f);
}

const run = spawnSync('bash', ['run.sh'], { cwd: workspaceDir, encoding: 'utf8', timeout: 15000 });

const missing = [];
for (const [p, want] of Object.entries(projects)) {
  const f = join(workspaceDir, p, 'built.txt');
  if (!existsSync(f)) {
    missing.push(p);
    continue;
  }
  const got = Number((readFileSync(f, 'utf8').match(/\d+/) ?? [])[0]);
  if (got !== want) missing.push(`${p}(got ${got}, want ${want})`);
}

if (missing.length > 0) {
  console.error(
    'FAIL: not every project built correctly — ' +
      missing.join(', ') +
      '. A cd that leaks the cwd builds only the first project:\n' +
      ((run.stdout ?? '') + (run.stderr ?? '')).trim()
  );
  process.exit(1);
}

console.log('PASS: all three projects built — process_project isolated its cd');
process.exit(0);
