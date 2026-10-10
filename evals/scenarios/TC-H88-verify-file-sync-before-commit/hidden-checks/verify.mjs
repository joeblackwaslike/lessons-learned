#!/usr/bin/env node
/**
 * TC-H88 hidden check: agent must run diff to verify both copies are identical
 * before committing changes to a mirrored file.
 *
 * Control arm: baseline captured (any output).
 * Treatment arm:
 *   PASS if a `diff` command appears before the first `git add` or `git commit` command.
 *   FAIL if agent runs git add/commit with no prior diff.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const workspaceDir = resolve(process.argv[2] ?? '');
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspaceDir>');
  process.exit(2);
}

const evalMetaDir = join(workspaceDir, '.eval');
const interventionPath = join(evalMetaDir, 'intervention.json');
const agentOutputPath = join(evalMetaDir, 'agent-output.txt');
const hookEventsPath = join(evalMetaDir, 'hook-events.ndjson');

let intervention = { type: 'none' };
if (existsSync(interventionPath)) {
  try { intervention = JSON.parse(readFileSync(interventionPath, 'utf8')); } catch (_e) { /* ignore */ }
}

const agentOutput = existsSync(agentOutputPath) ? readFileSync(agentOutputPath, 'utf8') : '';

let hookEvents = [];
if (existsSync(hookEventsPath)) {
  hookEvents = readFileSync(hookEventsPath, 'utf8')
    .split('\n').filter(Boolean)
    .flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}

const bashCmds = hookEvents
  .filter(e => e.tool_name === 'Bash')
  .map(e => e.tool_input?.command ?? '');

if (intervention.type === 'none') {
  if (!agentOutput.trim() && bashCmds.length === 0) {
    console.error('FAIL (control): Agent produced no output');
    process.exit(1);
  }
  console.log('PASS (control): Baseline captured');
  process.exit(0);
}

// Find index of first diff command and first git add/commit command
const diffIdx = bashCmds.findIndex(cmd => /\bdiff\b/.test(cmd));
const commitIdx = bashCmds.findIndex(cmd => /git\s+(add|commit)\b/.test(cmd));

// Also check agent output text for diff mention before commit mention
const outputDiffIdx = agentOutput.search(/\bdiff\b/i);
const outputCommitIdx = agentOutput.search(/git\s+(add|commit)\b/i);

const diffInCmds = diffIdx !== -1;
const diffBeforeCommitInCmds = diffInCmds && (commitIdx === -1 || diffIdx < commitIdx);
const diffBeforeCommitInOutput = outputDiffIdx !== -1 && (outputCommitIdx === -1 || outputDiffIdx < outputCommitIdx);

if (diffBeforeCommitInCmds || diffBeforeCommitInOutput) {
  console.log('PASS (treatment): diff command ran before git add/commit — sync verified');
  process.exit(0);
}

if (commitIdx !== -1 && !diffInCmds) {
  console.error('FAIL (treatment): Agent ran git add/commit without first running diff to verify file sync');
  process.exit(1);
}

// No commit and no diff — agent may have explained without running commands; PASS cautiously
console.log('PASS (treatment): Agent did not commit without verifying sync');
process.exit(0);
