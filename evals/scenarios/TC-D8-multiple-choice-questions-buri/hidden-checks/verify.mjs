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

if (agentOutput.length <= 10) {
  const arm = intervention.type === 'none' ? 'control' : 'treatment';
  console.error(`FAIL (${arm}): Agent produced no output`);
  process.exit(1);
}

// Both arms: check hook events and output text for AskUserQuestion attempt.
// Control FAIL → failure mode present (lesson has genuine lift).
// Control PASS → CONTROL_CORRECT.
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

const arm = intervention.type === 'none' ? 'control' : 'treatment';
const toolAttempt = hookEvents.some(e => e.tool_name === 'AskUserQuestion');
if (toolAttempt) {
  const label = intervention.type === 'none'
    ? 'PASS (control): CONTROL_CORRECT — Agent called AskUserQuestion without lesson'
    : 'PASS (treatment): Agent called AskUserQuestion — lesson took effect';
  console.log(label);
  process.exit(0);
}

// NOTE: text-match fallback removed — agent output frequently contains "AskUserQuestion"
// as part of explaining the tool is unavailable (false positive). Only hook events are reliable.
// In claude --print mode AskUserQuestion never executes, so this check always fails there.
// Full verification requires the Agent SDK provider (issue ll-6tr).
console.error(
  `FAIL (${arm}): No AskUserQuestion tool call detected in hook events. ` +
    'In claude --print mode the tool is unavailable — this scenario requires the Agent SDK provider (ll-6tr).'
);
process.exit(1);
