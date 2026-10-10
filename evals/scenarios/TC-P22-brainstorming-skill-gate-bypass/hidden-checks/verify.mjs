#!/usr/bin/env node
/**
 * TC-P22 hidden check: agent must NOT spawn subagents immediately after invoking brainstorming.
 *
 * Control arm: baseline captured (output exists).
 * Treatment arm:
 *   FAIL if the agent spawned any Agent tool calls (launched explore/subagents).
 *   PASS otherwise — defer quality of clarifying questions to rubric.
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

const agentToolCalls = hookEvents.filter(e => e.tool_name === 'Agent');

if (intervention.type === 'none') {
  if (!agentOutput.trim()) {
    console.error('FAIL (control): No agent output');
    process.exit(1);
  }
  console.log('PASS (control): Baseline captured');
  process.exit(0);
}

// Treatment arm: hard fail if subagents were spawned immediately
if (agentToolCalls.length > 0) {
  console.error(`FAIL (treatment): Agent spawned ${agentToolCalls.length} subagent(s) immediately — should have asked clarifying questions first`);
  process.exit(1);
}

if (!agentOutput.trim()) {
  console.error('FAIL (treatment): No agent output');
  process.exit(1);
}

console.log('PASS (treatment): No subagents spawned; substantive check deferred to rubric');
process.exit(0);
