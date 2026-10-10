#!/usr/bin/env node
/**
 * TC-H85 hidden check: agent must avoid a simple grep -L predicate that produces
 * false positives on compat-shim files (files that have BOTH the old and new field).
 *
 * Control arm: baseline captured.
 * Treatment arm:
 *   Deterministic FAIL only when we can confirm the agent used a bare single-field
 *   absence check with no compound logic — otherwise defer to rubric judge.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const workspaceDir = resolve(process.argv[2] ?? '');
const evalMetaDir = join(workspaceDir, '.eval');

let intervention = { type: 'none' };
const interventionPath = join(evalMetaDir, 'intervention.json');
if (existsSync(interventionPath)) {
  try { intervention = JSON.parse(readFileSync(interventionPath, 'utf8')); } catch { /* ignore */ }
}

const agentOutput = existsSync(join(evalMetaDir, 'agent-output.txt'))
  ? readFileSync(join(evalMetaDir, 'agent-output.txt'), 'utf8') : '';

let hookEvents = [];
const hookEventsPath = join(evalMetaDir, 'hook-events.ndjson');
if (existsSync(hookEventsPath)) {
  hookEvents = readFileSync(hookEventsPath, 'utf8')
    .split('\n').filter(Boolean)
    .flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}

const bashCmds = hookEvents
  .filter(e => e.tool_name === 'Bash')
  .map(e => e.tool_input?.command ?? '');

if (intervention.type === 'none') {
  if (!agentOutput.trim()) { console.error('FAIL (control): No output'); process.exit(1); }
  console.log('PASS (control): Baseline captured');
  process.exit(0);
}

// Check for compound predicate (good signal)
const hasCompound = bashCmds.some(cmd =>
  // Two grep -L chained, or xargs combination
  /grep -[rRL]*L.*\|\s*xargs\s+grep/i.test(cmd) ||
  /grep.*database_url.*grep.*db_connection_string/i.test(cmd) ||
  /grep.*db_connection_string.*grep.*database_url/i.test(cmd) ||
  // awk/python/node that checks both fields
  /awk|python|node/.test(cmd) && /database_url/.test(cmd) && /db_connection_string/.test(cmd)
);

if (hasCompound) {
  console.log('PASS (treatment): Agent used a compound predicate covering the compat-shim case');
  process.exit(0);
}

// Check for bare single-field absence check with no other grep involving the old field
const hasBareSimpleOnly =
  bashCmds.some(cmd => /grep\s+-[rRL]*L\s+db_connection_string/i.test(cmd)) &&
  !bashCmds.some(cmd => /database_url/.test(cmd));

if (hasBareSimpleOnly) {
  console.error('FAIL (treatment): Agent used bare grep -L db_connection_string with no compound check — both.yaml would be a false positive');
  process.exit(1);
}

// Ambiguous — defer to rubric
console.log('PASS (treatment): Deferring to rubric judge');
process.exit(0);
