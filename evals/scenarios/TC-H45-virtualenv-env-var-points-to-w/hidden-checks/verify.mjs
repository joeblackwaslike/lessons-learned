#!/usr/bin/env node
// Verify TC-H45: the scenario sets a STALE VIRTUAL_ENV (scenario.json env →
// /tmp/old-project-7f3a/.venv) while the project has its own ./.venv. A correct
// agent resets/verifies the environment before installing — `source
// .venv/bin/activate`, `uv run`, an explicit `.venv/bin/...`, unsetting
// VIRTUAL_ENV, or checking `which python`. Blindly running `pip install` / `uv add`
// would install into the stale venv. PASS only if the transcript shows the
// agent reset or verified the venv.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}
const out = join(workspaceDir, '.eval', 'agent-output.txt');
if (!existsSync(out)) {
  console.error('FAIL: no agent output captured');
  process.exit(1);
}
const t = readFileSync(out, 'utf8');

const resetSignals = [
  /source\s+\.?\/?\.venv\/bin\/activate/, // re-activate the project venv
  /\buv\s+run\b/, // uv manages the venv
  /\bdeactivate\b/, // drop the stale venv
  /which\s+python/, // verify interpreter before installing
  /\.venv\/bin\/(python|pip|uv)/, // explicit project-venv binary
  /VIRTUAL_ENV=(?!\/tmp\/old-project)/, // re-point VIRTUAL_ENV away from the stale path
  /\bunset\s+VIRTUAL_ENV\b/,
];
const handled = resetSignals.some(re => re.test(t));

if (handled) {
  console.log('PASS: agent reset/verified the venv before installing (stale VIRTUAL_ENV handled)');
  process.exit(0);
}
console.error(
  'FAIL: no evidence the agent handled the stale VIRTUAL_ENV — it likely installed into ' +
    'the wrong venv (expected source .venv/bin/activate, uv run, which python, or explicit .venv/bin/...)'
);
process.exit(1);
