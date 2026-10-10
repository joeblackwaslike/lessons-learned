#!/usr/bin/env node
/**
 * TC-H90 hidden check: agent must bound find/grep-r output to avoid silent truncation.
 *
 * Control arm: baseline captured.
 * Treatment arm:
 *   PASS (deterministic) if any Bash command contains an output-bounding technique.
 *   Otherwise defer to LLM rubric judge.
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

// Deterministic: check for output-bounding patterns in any Bash command
const boundingPatterns = [
  /\|\s*head\b/,       // pipe to head
  /\|\s*wc\b/,         // pipe to wc
  /grep\s+-rl?\b/,     // grep -rl (list filenames only)
  /--include=/,        // --include filter
  /\|\s*tail\b/,       // pipe to tail
];

const hasBounding = bashCmds.some(cmd =>
  boundingPatterns.some(pat => pat.test(cmd))
);

if (hasBounding) {
  console.log('PASS (treatment): Output-bounding technique used (head/wc/grep -rl/--include/tail)');
  process.exit(0);
}

// Defer to rubric
console.log('SKIP (treatment): deferred to rubric judge — no deterministic bounding pattern found');
process.exit(0);
