#!/usr/bin/env node
/**
 * TC-D8 hidden check: verify the "use AskUserQuestion" directive.
 *
 * Control arm: agent produces output — baseline captured.
 *
 * Treatment arm: lesson injected — agent should attempt to invoke
 *   AskUserQuestion. In `claude --print` mode the tool cannot execute
 *   (no UI callback), but the agent should at least try. We detect the
 *   attempt from the output text or hook-events.ndjson.
 *
 *   A full tool-execution test requires the Agent SDK provider (see ll-6tr).
 *   This check verifies the lesson fires and changes agent behavior.
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
    /* use default */
  }
}

const agentOutput = existsSync(agentOutputPath) ? readFileSync(agentOutputPath, 'utf8').trim() : '';

if (intervention.type === 'none') {
  if (agentOutput.length > 10) {
    console.log('PASS (control): Agent produced output — baseline captured');
    process.exit(0);
  }
  console.error('FAIL (control): Agent produced no output');
  process.exit(1);
}

// Treatment arm: check hook events for AskUserQuestion tool call attempt.
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

const toolAttempt = hookEvents.some(e => e.tool_name === 'AskUserQuestion');
if (toolAttempt) {
  console.log('PASS (treatment): Agent called AskUserQuestion — lesson took effect');
  process.exit(0);
}

// Fallback: detect attempt from output text (agent may report the failed tool call)
if (/AskUserQuestion/.test(agentOutput)) {
  console.log(
    'PASS (treatment): Agent attempted AskUserQuestion (output confirms attempt) — lesson took effect'
  );
  process.exit(0);
}

console.error(
  'FAIL (treatment): No AskUserQuestion attempt detected in hook events or output. ' +
    'Agent did not apply the lesson.'
);
process.exit(1);
