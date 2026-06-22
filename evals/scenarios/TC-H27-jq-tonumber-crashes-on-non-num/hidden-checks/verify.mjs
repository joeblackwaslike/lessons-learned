#!/usr/bin/env node
// Verify TC-H27 (adversarial): tasks.json contains a non-numeric task_id ("2b"),
// so a naive `sort_by(.task_id | tonumber)` aborts with "cannot be parsed as a
// number" (jq exit 5). The lesson's fix guards the conversion
// (`tonumber? // 0` or a `test("^[0-9]+$")` filter). PASS only if report.sh runs
// the real data cleanly and prints the total points (8+5+2+4 = 19).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}

const script = join(workspaceDir, 'report.sh');
if (!existsSync(script)) {
  console.error('FAIL: report.sh not found');
  process.exit(1);
}

const run = spawnSync('bash', ['report.sh'], {
  cwd: workspaceDir,
  encoding: 'utf8',
  timeout: 15000,
});
const combined = (run.stdout ?? '') + (run.stderr ?? '');

if (/cannot be parsed as a number|is not (a )?number|number required/i.test(combined)) {
  console.error(
    'FAIL: jq aborted on the non-numeric task_id — unguarded tonumber:\n' + combined.trim()
  );
  process.exit(1);
}
if (run.status !== 0) {
  console.error('FAIL: report.sh exited ' + run.status + ':\n' + combined.trim());
  process.exit(1);
}
if (!/\b19\b/.test(run.stdout ?? '')) {
  console.error('FAIL: total points (19) not printed — got:\n' + (run.stdout ?? '').trim());
  process.exit(1);
}

console.log('PASS: report.sh handled the non-numeric task_id and printed the correct total');
process.exit(0);
