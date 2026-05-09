#!/usr/bin/env node
/**
 * TC-P1 hidden check: verify the agent produced a useful log error summary.
 *
 * Control arm (type: none): passes if agent output is non-empty and contains
 *   some indicator of error analysis (the word "error" case-insensitive, or a
 *   Markdown table with pipe characters).
 *
 * Treatment arm (type: lesson): same outcome check — the lesson primes the agent
 *   to use Read/Glob rather than Bash for file operations in a subagent context.
 *   We additionally check hook events (if present): if the agent used Read or Glob
 *   to inspect the log files, that signals the lesson guidance was absorbed.
 *   Bash usage is not a hard fail — the outer agent may still shell out — but
 *   Read/Glob usage in the trajectory earns a stronger PASS label.
 *
 * Called by claude-agent.mjs with the workspace dir as argv[2].
 * Exit 0 = pass, non-zero = fail.
 */

import { existsSync, readFileSync } from 'node:fs';
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

// Read intervention type
let intervention = { type: 'none' };
if (existsSync(interventionPath)) {
  try {
    intervention = JSON.parse(readFileSync(interventionPath, 'utf8'));
  } catch {
    // use default
  }
}

// Read agent output
const agentOutput = existsSync(agentOutputPath) ? readFileSync(agentOutputPath, 'utf8').trim() : '';

if (!agentOutput) {
  console.error('FAIL: agent-output.txt is empty or missing — agent produced no output');
  process.exit(1);
}

// Check output contains some form of error summary:
//   - contains the word "error" (case-insensitive), OR
//   - contains a Markdown table row (| character appears at least twice on one line)
const hasErrorWord = /error/i.test(agentOutput);
const hasTableRow = agentOutput.split('\n').some(line => (line.match(/\|/g) ?? []).length >= 2);

if (!hasErrorWord && !hasTableRow) {
  console.error('FAIL: agent output does not contain an error summary or Markdown table');
  console.error('Output preview (first 500 chars):');
  console.error(agentOutput.slice(0, 500));
  process.exit(1);
}

// Parse hook events
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

const hasHookEvents = hookEvents.length > 0;

if (intervention.type === 'none') {
  console.log('PASS (control): Agent produced a log error summary — baseline captured');
  process.exit(0);
}

// Treatment arm: check whether the agent used Read/Glob for file access (preferred)
// vs relying solely on Bash shell commands.
if (!hasHookEvents) {
  // No hook events — can only validate outcome
  console.log(
    'PASS (treatment): Agent produced error summary (no hook events; tool preference unknown)'
  );
  process.exit(0);
}

const readEvents = hookEvents.filter(e => e.tool_name === 'Read' || e.tool_name === 'Glob');
const bashEvents = hookEvents.filter(e => e.tool_name === 'Bash');

// Check whether any Bash command tried to cat/grep log files (less ideal in subagent)
const bashLogCmds = bashEvents.filter(e => {
  const cmd = e.tool_input?.command ?? '';
  return /\b(cat|grep|tail|head|awk|sed)\b/.test(cmd) && /\.log/.test(cmd);
});

if (readEvents.length > 0) {
  console.log(
    `PASS (treatment): Agent used Read/Glob (${readEvents.length} call(s)) to read log files — ` +
      `lesson guidance absorbed. Bash log commands: ${bashLogCmds.length}.`
  );
  process.exit(0);
}

if (bashLogCmds.length > 0) {
  // Produced a valid summary but via Bash — still passes, informational note
  console.log(
    `PASS (treatment): Agent produced error summary via Bash shell commands — ` +
      `outcome correct but Read/Glob preferred in subagent context. ` +
      `(${bashLogCmds.length} Bash log command(s), 0 Read/Glob calls)`
  );
  process.exit(0);
}

// Summary produced but no log-reading events found — agent may have inlined the analysis
console.log(
  'PASS (treatment): Agent produced error summary — no file-reading events found in trajectory'
);
process.exit(0);
