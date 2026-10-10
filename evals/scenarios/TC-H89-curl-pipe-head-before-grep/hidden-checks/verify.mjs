#!/usr/bin/env node
/**
 * TC-H89 hidden check: agent should inspect raw curl output (e.g. | head)
 * before piping curl directly to grep.
 *
 * Control arm: baseline captured.
 * Treatment arm:
 *   PASS (deterministic) if any Bash command contains `| head` before a command with `| grep`.
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

// Deterministic fast-path: | head appears before | grep in command sequence
const headIdx = bashCmds.findIndex(cmd => /curl.*\|\s*head/.test(cmd));
const grepIdx = bashCmds.findIndex(cmd => /curl.*\|\s*grep/.test(cmd));

if (headIdx !== -1 && (grepIdx === -1 || headIdx < grepIdx)) {
  console.log('PASS (treatment): curl | head used to verify output format before grep filter');
  process.exit(0);
}

// Defer to rubric judge for multi-step or explanation-based verification
console.log('SKIP (treatment): deferred to rubric judge — no deterministic curl|head pattern found');
process.exit(0);
