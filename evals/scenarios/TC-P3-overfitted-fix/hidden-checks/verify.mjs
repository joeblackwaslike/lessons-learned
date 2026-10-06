#!/usr/bin/env node
/**
 * TC-P3 hidden check: verify the agent fixed the Read false-positive without over-narrowing.
 *
 * The lesson for this scenario warns about "overfitted fixes" — when a problem is observed
 * on one tool (Read), the correct fix is to exclude that specific tool (denylist approach),
 * not to redesign the hook as an allowlist with only Bash or a narrow set of tools.
 *
 * Control arm (type: none): agent may switch to an allowlist that drops Edit, Write, MCP tools.
 *   Basic check: Read no longer fires. Does NOT check that other tools are preserved.
 * Treatment arm (type: lesson): agent must exclude only Read.
 *   Verify: (a) Read is excluded, (b) Edit still fires, (c) Write still fires,
 *           (d) Bash still fires.
 *
 * Called by claude-agent.mjs with the workspace dir as argv[2].
 * Exit 0 = pass, non-zero = fail.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const workspaceDir = resolve(process.argv[2] ?? '');
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspaceDir>');
  process.exit(2);
}

const evalMetaDir = join(workspaceDir, '.eval');
const interventionPath = join(evalMetaDir, 'intervention.json');
const hookFile = join(workspaceDir, 'hooks', 'inject.mjs');

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
if (!existsSync(hookFile)) {
  console.error('FAIL: hooks/inject.mjs does not exist');
  process.exit(1);
}

// Helper: run the hook with a given tool name and return the result
function runHook(toolName, command = '') {
  const payload = { tool_name: toolName, tool_input: { command } };
  return spawnSync(process.execPath, ['--no-warnings', hookFile], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 10_000,
  });
}

// Check 2: Read must NOT produce lesson-inject output (both arms — this is the stated task)
const readResult = runHook('Read');
if (readResult.stdout.includes('lesson-inject')) {
  console.error('FAIL: Hook still fires on Read tool — fix was not applied');
  process.exit(1);
}

// Both arms: verify Read is excluded AND other tools still fire (not over-narrowed).
// Control FAIL → over-narrowed (failure mode). Control PASS → CONTROL_CORRECT.

const arm = intervention.type === 'none' ? 'control' : 'treatment';
const toolsToCheck = ['Bash', 'Edit', 'Write'];
const failures = [];

for (const toolName of toolsToCheck) {
  const result = runHook(toolName, toolName === 'Bash' ? 'ls -la' : '');
  if (!result.stdout.includes('lesson-inject')) {
    failures.push(toolName);
  }
}

if (failures.length > 0) {
  console.error(`FAIL (${arm}): Hook no longer fires on: ${failures.join(', ')}`);
  console.error(
    'The fix over-narrowed the hook. Match the scope of the fix to the scope of the ' +
      'observation: if Read was noisy, exclude Read — do not redesign around the absence of Read.'
  );
  const source = readFileSync(hookFile, 'utf8');
  const triggerMatch = source.match(/TRIGGER_TOOLS\s*=\s*\[([^\]]*)\]/);
  if (triggerMatch) console.error(`Observed TRIGGER_TOOLS: [${triggerMatch[1].trim()}]`);
  process.exit(1);
}

if (readResult.stdout.includes('lesson-inject')) {
  console.error(`FAIL (${arm}): Read exclusion check failed (re-check)`);
  process.exit(1);
}

const label = intervention.type === 'none'
  ? `PASS (control): CONTROL_CORRECT — Read excluded, other tools (${toolsToCheck.join(', ')}) still fire without lesson`
  : `PASS (treatment): Read is excluded and all other tools (${toolsToCheck.join(', ')}) still fire — fix correctly scoped`;
console.log(label);
process.exit(0);
