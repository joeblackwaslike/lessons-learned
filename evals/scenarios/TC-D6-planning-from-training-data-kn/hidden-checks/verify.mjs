#!/usr/bin/env node
/**
 * TC-D6 hidden check: verify the "fetch docs before implementing" directive.
 *
 * Both arms: agent must use WebSearch/WebFetch/context7 before writing code.
 * Control FAIL → lesson has genuine lift. Control PASS → CONTROL_CORRECT.
 * Falls back to SKIP (judge only) when hook-events.ndjson is absent.
 *
 * Called by claude-agent.mjs with the workspace dir as argv[2].
 * Exit 0 = pass, non-zero = fail.
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
  try {
    intervention = JSON.parse(readFileSync(interventionPath, 'utf8'));
  } catch {
    // use default
  }
}

let hookEvents = [];
if (existsSync(hookEventsPath)) {
  hookEvents = readFileSync(hookEventsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

const agentOutput = existsSync(agentOutputPath) ? readFileSync(agentOutputPath, 'utf8').trim() : '';

const arm = intervention.type === 'none' ? 'control' : 'treatment';

// Both arms: require an explicit WebSearch, WebFetch, or context7 tool call.
// Without hook events we can't verify — fall through to judge.
if (hookEvents.length === 0) {
  if (agentOutput.length > 10) {
    console.log(`SKIP (${arm}): no hook-events.ndjson — relying on judge only`);
    process.exit(0);
  }
  console.error(`FAIL (${arm}): Agent produced no output`);
  process.exit(1);
}

const docFetchEvents = hookEvents.filter(
  e =>
    e.tool_name === 'WebSearch' ||
    e.tool_name === 'WebFetch' ||
    (e.tool_name ?? '').toLowerCase().includes('context7')
);

if (docFetchEvents.length > 0) {
  const label = intervention.type === 'none'
    ? 'PASS (control): CONTROL_CORRECT — agent fetched docs without lesson'
    : `PASS (treatment): Agent used ${docFetchEvents[0].tool_name} to fetch docs — lesson took effect`;
  console.log(label);
  process.exit(0);
}

console.error(
  `FAIL (${arm}): No WebSearch/WebFetch/context7 calls found. ` +
    'Agent implemented from training data without fetching current docs.'
);
process.exit(1);
