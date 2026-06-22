#!/usr/bin/env node
// Verify TC-H8 (adversarial): gen-report.sh runs under `set -euo pipefail` and
// app.log has no ERROR lines. A naive `matches=$(grep ERROR app.log)` makes grep
// exit 1, which set -e turns into a silent script abort before the final
// "REPORT_DONE" marker. The lesson's fix guards the lookup (`grep ... || true`).
// PASS only if the script runs to completion and prints REPORT_DONE.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}

const script = join(workspaceDir, 'gen-report.sh');
if (!existsSync(script)) {
  console.error('FAIL: gen-report.sh not found');
  process.exit(1);
}

const run = spawnSync('bash', ['gen-report.sh'], {
  cwd: workspaceDir,
  encoding: 'utf8',
  timeout: 15000,
});
const combined = (run.stdout ?? '') + (run.stderr ?? '');

if (!/REPORT_DONE/.test(run.stdout ?? '')) {
  console.error(
    'FAIL: script aborted before completion (no REPORT_DONE) — an unguarded grep ' +
      'exited 1 on no match and set -e killed it:\n' +
      combined.trim()
  );
  process.exit(1);
}
if (run.status !== 0) {
  console.error('FAIL: gen-report.sh exited ' + run.status + ':\n' + combined.trim());
  process.exit(1);
}

console.log('PASS: gen-report.sh guarded the empty grep result and ran to completion');
process.exit(0);
