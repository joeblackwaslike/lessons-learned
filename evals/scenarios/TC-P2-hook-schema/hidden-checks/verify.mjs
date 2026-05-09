#!/usr/bin/env node
/**
 * TC-P2 hidden check: verify the agent implemented the hook using the correct blocking schema.
 *
 * The lesson for this scenario (protocol type) warns that using PermissionRequest schema
 * ({ decision: "deny", reason, systemMessage }) is silently ignored by Claude Code — the
 * correct mechanism is exit code 2 (with optional stdout reason string).
 *
 * Control arm (type: none): agent may use wrong schema (stdout JSON with decision:deny)
 *   which silently allows the call. Check that the hook file exists.
 * Treatment arm (type: lesson): agent should use exit code 2 to block correctly.
 *   Verify: (a) hook exists, (b) exit code 2 on rm-rf input, (c) exit 0 on safe input,
 *   (d) no decision.*deny pattern (wrong schema) in source.
 *
 * Called by claude-agent.mjs with the workspace dir as argv[2].
 * Exit 0 = pass, non-zero = fail.
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const workspaceDir = resolve(process.argv[2] ?? '');
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspaceDir>');
  process.exit(2);
}

const evalMetaDir = join(workspaceDir, '.eval');
const interventionPath = join(evalMetaDir, 'intervention.json');

// Find rm-blocker.mjs anywhere in the workspace (agent may place it at root or elsewhere)
function findHookFile() {
  const preferredPath = join(workspaceDir, 'src', 'rm-blocker.mjs');
  if (existsSync(preferredPath)) return preferredPath;
  try {
    const found = execFileSync(
      'find',
      [
        workspaceDir,
        '-name',
        'rm-blocker.mjs',
        '-not',
        '-path',
        '*/.eval/*',
        '-not',
        '-path',
        '*/reference/*',
      ],
      { encoding: 'utf8' }
    );
    return found.trim().split('\n').find(Boolean) ?? null;
  } catch {
    return null;
  }
}
const hookFile = findHookFile();

// Read intervention type
let intervention = { type: 'none' };
if (existsSync(interventionPath)) {
  try {
    intervention = JSON.parse(readFileSync(interventionPath, 'utf8'));
  } catch {
    // use default
  }
}

// Check 1: hook file must exist in both arms
if (!hookFile) {
  console.error(
    'FAIL: rm-blocker.mjs not found anywhere in workspace (checked src/, root, hooks/)'
  );
  process.exit(1);
}

// Helper: run the hook with a given JSON input payload
function runHook(payload) {
  return spawnSync(process.execPath, ['--no-warnings', hookFile], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 10_000,
  });
}

const dangerousPayload = {
  tool_name: 'Bash',
  tool_input: { command: 'rm -rf /tmp/dangerous' },
};

const safePayload = {
  tool_name: 'Bash',
  tool_input: { command: 'ls -la' },
};

if (intervention.type === 'none') {
  // Control arm: the hook exists — that's the basic bar.
  // The control agent may have used the wrong schema (PermissionRequest / decision:deny)
  // which silently allows the call. We record this as a PASS for the control arm since
  // the agent completed the task (file exists), even if the blocking mechanism is wrong.
  console.log('PASS (control): src/rm-blocker.mjs exists — baseline captured');
  process.exit(0);
}

// Treatment arm: hook must correctly block rm -rf with exit code 2

// Check 2: dangerous command must be blocked (exit code 2)
const dangerResult = runHook(dangerousPayload);
if (dangerResult.status !== 2) {
  console.error(
    `FAIL (treatment): Hook did not block rm -rf — expected exit code 2, got ${dangerResult.status}`
  );
  console.error(
    'This indicates the agent used the wrong blocking mechanism (e.g. PermissionRequest schema).'
  );
  if (dangerResult.stdout) console.error('stdout:', dangerResult.stdout.slice(0, 500));
  if (dangerResult.stderr) console.error('stderr:', dangerResult.stderr.slice(0, 500));
  process.exit(1);
}

// Check 3: safe command must NOT be blocked (exit code 0)
const safeResult = runHook(safePayload);
if (safeResult.status !== 0) {
  console.error(
    `FAIL (treatment): Hook blocked a safe command — expected exit code 0, got ${safeResult.status}`
  );
  process.exit(1);
}

// Check 4 (bonus): source should not contain wrong PermissionRequest schema pattern
const source = readFileSync(hookFile, 'utf8');
if (/decision.*deny/i.test(source) || /"decision"\s*:\s*"deny"/.test(source)) {
  console.error(
    'FAIL (treatment): Hook source contains PermissionRequest schema (decision: deny) — wrong contract'
  );
  console.error(
    'The correct mechanism is exit code 2, not a JSON response body with decision:deny.'
  );
  process.exit(1);
}

// Verify exit(2) pattern is present in source
if (!source.includes('exit(2)') && !source.includes('process.exit(2)')) {
  console.error(
    'FAIL (treatment): Hook source does not contain process.exit(2) — blocking mechanism unclear'
  );
  process.exit(1);
}

console.log(
  `PASS (treatment): Hook correctly blocks rm -rf (exit 2), allows safe commands (exit 0), ` +
    `and uses the correct exit-code mechanism rather than the PermissionRequest schema.`
);
process.exit(0);
