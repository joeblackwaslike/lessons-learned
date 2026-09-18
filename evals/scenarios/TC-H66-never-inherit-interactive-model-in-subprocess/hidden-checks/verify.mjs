#!/usr/bin/env node
/**
 * TC-H66 hidden check: hook command that spawns claude -p must pin the model
 * (--model) or isolate it (--no-session-persistence / --setting-sources "").
 *
 * Control arm: agent produced some output — baseline captured.
 * Treatment arm: settings.json contains a hook with claude -p AND one of the
 *   required isolation flags.
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

// Treatment arm: read written settings.json
const settingsPath = join(workspaceDir, '.claude', 'settings.json');
if (!existsSync(settingsPath)) {
  // Fall back to agent output text
  const hasClaudeP = agentOutput.includes('claude -p') || agentOutput.includes('claude --print');
  const hasIsolation = /--model\b|--no-session-persistence|--setting-sources\s+""|--setting-sources\s+''/.test(agentOutput);
  if (hasClaudeP && hasIsolation) {
    console.log('PASS (treatment, output-only): Agent output shows claude -p with isolation flag');
    process.exit(0);
  }
  console.error('FAIL (treatment): settings.json not written and output lacks isolation flag on claude -p');
  process.exit(1);
}

const settingsRaw = readFileSync(settingsPath, 'utf8');

// Check for any claude -p or claude --print in the settings
const hasClaudeP = settingsRaw.includes('claude -p') || settingsRaw.includes('claude --print');
if (!hasClaudeP) {
  // Agent may have used agent output to describe what to do; check there
  const outHasP = agentOutput.includes('claude -p') || agentOutput.includes('claude --print');
  const outHasIsolation = /--model\b|--no-session-persistence|--setting-sources\s*["']{2}/.test(agentOutput);
  if (outHasP && outHasIsolation) {
    console.log('PASS (treatment, output-only): Agent showed claude -p with isolation flag in output');
    process.exit(0);
  }
  console.error('FAIL (treatment): Hook does not contain claude -p at all — cannot verify isolation');
  process.exit(1);
}

// Check for isolation flags
const hasIsolation = /--model\b|--no-session-persistence|--setting-sources\s*["']{0,1}\s*["']{0,1}/.test(settingsRaw);
if (hasIsolation) {
  console.log('PASS (treatment): Hook contains claude -p with model isolation flag');
  process.exit(0);
}

console.error('FAIL (treatment): Hook contains claude -p without --model, --no-session-persistence, or --setting-sources ""');
process.exit(1);
