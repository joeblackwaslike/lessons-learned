#!/usr/bin/env node
/**
 * TC-H6 hidden check: verify the agent added an EXIT trap to the backup script.
 *
 * The lesson teaches: when using set -euo pipefail, always register a
 * `trap '...' EXIT` handler so failures are logged rather than silently absorbed.
 *
 * Control arm (type: none): passes if agent produced non-empty output (baseline).
 * Treatment arm (type: lesson): additionally verifies that the final backup.sh
 *   in the workspace contains a `trap` statement targeting EXIT.
 *
 * Called by claude-agent.mjs with the workspace dir as argv[2].
 * Exit 0 = pass, non-zero = fail.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const workspaceDir = resolve(process.argv[2] ?? '');
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspaceDir>');
  process.exit(2);
}

const evalMetaDir = join(workspaceDir, '.eval');
const interventionPath = join(evalMetaDir, 'intervention.json');
const agentOutputPath = join(evalMetaDir, 'agent-output.txt');

// Read intervention type
let intervention = { type: 'none' };
if (existsSync(interventionPath)) {
  try {
    intervention = JSON.parse(readFileSync(interventionPath, 'utf8'));
  } catch {
    // use default
  }
}

// Read agent output
const agentOutput = existsSync(agentOutputPath) ? readFileSync(agentOutputPath, 'utf8') : '';

if (!agentOutput.trim()) {
  console.error('FAIL: Agent produced no output');
  process.exit(1);
}

// Control arm: baseline — agent produced output, that's enough
if (intervention.type === 'none') {
  console.log('PASS (control): Agent produced output — baseline captured');
  process.exit(0);
}

// Treatment arm: check that backup.sh in the workspace contains a trap ... EXIT
const backupPath = join(workspaceDir, 'backup.sh');
if (!existsSync(backupPath)) {
  console.error('FAIL (treatment): backup.sh not found in workspace');
  process.exit(1);
}

const backupContent = readFileSync(backupPath, 'utf8');

// The lesson's goal is failure VISIBILITY under `set -e`. A trap on EXIT or ERR
// both satisfy that (ERR fires on the failing command, EXIT on script exit) —
// accept either so a valid lesson-following fix is not rejected.
// Match `trap '...' EXIT|ERR`, `trap "..." EXIT|ERR`, or `trap _fn EXIT|ERR`.
const trapPattern = /\btrap\s+.+\s+(EXIT|ERR)\b/;
const hasTrap = trapPattern.test(backupContent);

if (hasTrap) {
  console.log('PASS (treatment): backup.sh contains a trap ... EXIT/ERR handler');
  process.exit(0);
} else {
  console.error(
    'FAIL (treatment): backup.sh uses set -euo pipefail but has no `trap ... EXIT/ERR` handler — ' +
      'silent failures will abort the script without any diagnostic output'
  );
  process.exit(1);
}
