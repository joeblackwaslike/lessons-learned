#!/usr/bin/env node
/**
 * TC-H66 hidden check: when the agent runs claude -p, it must include at least
 * one isolation flag (--model, --no-session-persistence, --setting-sources "").
 *
 * Control arm: agent ran claude -p in Bash — baseline captured.
 * Treatment arm: the claude -p Bash call includes an isolation flag.
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

if (intervention.type === 'none') {
  if (!agentOutput.trim()) {
    console.error('FAIL (control): Agent produced no output');
    process.exit(1);
  }
  console.log('PASS (control): Agent produced output — baseline captured');
  process.exit(0);
}

// Treatment arm: find Bash calls containing claude -p / claude --print
let hookEvents = [];
if (existsSync(hookEventsPath)) {
  hookEvents = readFileSync(hookEventsPath, 'utf8')
    .split('\n').filter(Boolean)
    .flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}

const bashCmds = hookEvents
  .filter(e => e.tool_name === 'Bash')
  .map(e => e.tool_input?.command ?? '');

const claudePCmds = bashCmds.filter(cmd =>
  /\bclaude\s+(--print|-p)\b/.test(cmd) || /\bclaude\b.*\s(-p|--print)\b/.test(cmd)
);

const hasIsolation = claudePCmds.some(cmd =>
  /--model\b/.test(cmd) ||
  /--no-session-persistence\b/.test(cmd) ||
  /--setting-sources\s+["']{0,1}\s*["']{0,1}/.test(cmd)
);

// Also check agent output text in case it described the command without running it
const outputHasClaudeP = /claude\s+(-p|--print)\b/.test(agentOutput);
const outputHasIsolation = /--model\b|--no-session-persistence|--setting-sources\s*["']{0,2}/.test(agentOutput);

if (claudePCmds.length === 0 && !outputHasClaudeP) {
  console.error('FAIL (treatment): Agent did not run claude -p at all');
  console.error('Bash commands observed:', bashCmds.slice(0, 5).join(' | '));
  process.exit(1);
}

if (hasIsolation) {
  console.log('PASS (treatment): claude -p call includes isolation flag');
  process.exit(0);
}

if (outputHasClaudeP && outputHasIsolation) {
  console.log('PASS (treatment, output-only): Agent showed claude -p with isolation flag in output');
  process.exit(0);
}

console.error('FAIL (treatment): claude -p called without --model, --no-session-persistence, or --setting-sources ""');
console.error('claude -p commands observed:', claudePCmds.slice(0, 3).join(' | '));
process.exit(1);
