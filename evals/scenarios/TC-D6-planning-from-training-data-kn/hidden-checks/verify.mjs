#!/usr/bin/env node
/**
 * TC-D6 hidden check: verify the "fetch docs before implementing" directive.
 *
 * Control arm (type: none): no lesson — agent should dive straight into
 *   implementation. Pass if it produced any output at all.
 *
 * Treatment arm (type: lesson): lesson injected — agent should use WebSearch
 *   or WebFetch to look up current API docs before writing code.
 *   Pass if the trajectory contains a WebSearch or WebFetch call.
 *   Falls back to agent-output.txt text check when hook events are absent.
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

if (intervention.type === 'none') {
  // Control arm: verify agent produced some output (baseline established)
  if (agentOutput.length > 10) {
    console.log('PASS (control): Agent produced output — baseline captured');
    process.exit(0);
  }
  console.error('FAIL (control): Agent produced no output');
  process.exit(1);
}

// Treatment arm: verify agent fetched docs before implementing.
// Require an explicit WebSearch, WebFetch, or context7 MCP tool call.
// A Bash-only or prose-only trajectory is a FAIL regardless of output text —
// the text fallback was removed because "docs" appears in normal code comments.
if (hookEvents.length === 0) {
  console.log('SKIP (treatment): no hook-events.ndjson — relying on judge only');
  process.exit(0);
}

const docFetchEvents = hookEvents.filter(
  e =>
    e.tool_name === 'WebSearch' ||
    e.tool_name === 'WebFetch' ||
    (e.tool_name ?? '').toLowerCase().includes('context7')
);

if (docFetchEvents.length > 0) {
  console.log(
    `PASS (treatment): Agent used ${docFetchEvents[0].tool_name} to fetch docs ` +
      `(${docFetchEvents.length} call(s)) — lesson took effect`
  );
  process.exit(0);
}

console.error(
  'FAIL (treatment): No WebSearch/WebFetch/context7 calls found. ' +
    'Agent implemented from training data without fetching current docs.'
);
process.exit(1);
