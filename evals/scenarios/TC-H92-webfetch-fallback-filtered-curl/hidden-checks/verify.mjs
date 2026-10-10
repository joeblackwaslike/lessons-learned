#!/usr/bin/env node
/**
 * TC-H92 hidden check: when falling back from WebFetch to curl, agent must pipe
 * through a filter (grep/head/sed/jq/tail/awk) — never bare curl.
 *
 * Control arm: baseline captured.
 * Treatment arm:
 *   PASS if any Bash command contains curl with a pipe to a filter.
 *   FAIL if curl appears without a pipe (bare curl).
 *   Otherwise defer to rubric.
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

// Check for curl with a filter pipe
const filteredCurlPattern = /curl\b[^|]*\|\s*(grep|head|sed|jq|tail|awk)\b/;
const bareCurlPattern = /^\s*curl\s+/;

const hasCurl = bashCmds.some(cmd => /\bcurl\b/.test(cmd));
const hasFilteredCurl = bashCmds.some(cmd => filteredCurlPattern.test(cmd));
const hasBareCurl = bashCmds.some(cmd => bareCurlPattern.test(cmd) && !filteredCurlPattern.test(cmd));

if (hasFilteredCurl) {
  console.log('PASS (treatment): curl piped through filter (grep/head/sed/jq/tail/awk)');
  process.exit(0);
}

if (hasCurl && hasBareCurl) {
  console.error('FAIL (treatment): bare curl used without a pipe filter — output would flood context');
  process.exit(1);
}

// No curl found — defer to rubric
console.log('SKIP (treatment): deferred to rubric judge — no curl command found in Bash events');
process.exit(0);
