#!/usr/bin/env node
/**
 * trace-arm.mjs — run ONE arm of a scenario and print what actually happened:
 * the tool-call sequence, which lesson hints fired on which call, and the final text.
 * Use it to diagnose a FAIL or CONTROL_CORRECT verdict before drawing conclusions.
 *
 * Usage: node scripts/trace-arm.mjs <scenario-id> [--control] [--keep]
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLessonRequires } from '../lib/requires.mjs';

const EVALS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [scenarioId, ...flags] = process.argv.slice(2);
if (!scenarioId) {
  console.error('Usage: trace-arm.mjs <scenario-id> [--control] [--keep]');
  process.exit(1);
}
const isControl = flags.includes('--control');

const scenarioDir = join(EVALS_ROOT, 'scenarios', scenarioId);
const scenario = JSON.parse(readFileSync(join(scenarioDir, 'scenario.json'), 'utf8'));
const prompt = readFileSync(join(scenarioDir, 'PROMPT.md'), 'utf8').trim();
const intervention = isControl
  ? { type: 'none', ids: [] }
  : { type: 'lesson', ids: scenario.recommendedInterventions };

const workspace = mkdtempSync(join(tmpdir(), `trace-${scenarioId}-`));
const mat = spawnSync(
  process.execPath,
  [
    join(EVALS_ROOT, 'scripts', 'materialize-workspace.mjs'),
    '--scenario',
    scenarioDir,
    '--workspace',
    workspace,
    '--intervention',
    JSON.stringify(intervention),
  ],
  { encoding: 'utf8' }
);
if (mat.status !== 0) {
  console.error(mat.stderr);
  process.exit(1);
}

const { pluginDirs } = resolveLessonRequires(scenario.lessonId);
const args = [
  '--print',
  '--dangerously-skip-permissions',
  '--setting-sources=project',
  '--model',
  'claude-sonnet-4-6',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-hook-events',
  '--mcp-config',
  isControl ? '{"mcpServers":{}}' : join(workspace, '.eval', 'mcp-config.json'),
  '--strict-mcp-config',
  ...pluginDirs.flatMap(d => ['--plugin-dir', d]),
  '-p',
  prompt,
];
const keep = ['PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG'];
const env = Object.fromEntries(keep.filter(k => process.env[k]).map(k => [k, process.env[k]]));
env.LESSONS_MANIFEST_PATH = join(workspace, '.eval', 'lesson-manifest.json');
env.LESSONS_DISABLE_SCAN = '1';

const run = spawnSync('claude', args, {
  cwd: workspace,
  env,
  encoding: 'utf8',
  input: '',
  timeout: 600000,
  maxBuffer: 50 * 1024 * 1024,
});

const brief = input => {
  const v = input?.command ?? input?.file_path ?? input?.path ?? JSON.stringify(input);
  return String(v).replace(/\s+/g, ' ').slice(0, 220);
};

console.log(`# ${scenarioId} ${isControl ? 'CONTROL' : 'TREATMENT'}  (workspace ${workspace})`);
let turn = 0;
let finalText = '';
let injections = 0;
for (const line of run.stdout.split('\n').filter(Boolean)) {
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    continue;
  }
  if (ev.type === 'assistant') {
    for (const block of ev.message.content) {
      if (block.type === 'tool_use') console.log(`${++turn}. ${block.name}: ${brief(block.input)}`);
      if (block.type === 'text') finalText = block.text;
    }
  }
  if (ev.type === 'system' && ev.subtype === 'hook_response' && ev.hook_event !== 'PostToolUse') {
    const out = String(ev.output ?? ev.stdout ?? '');
    const injected = out.match(/injected\\?":\[([^\]]*)\]/)?.[1];
    if (injected) injections += 1;
    if (injected) console.log(`   >> HINT INJECTED (${ev.hook_name}): ${injected}`);
  }
}
if (injections === 0 && !isControl) {
  console.log('   >> no lesson injection occurred in this run');
}
console.log('\n# FINAL TEXT\n' + finalText.slice(0, 1500));
if (!flags.includes('--keep')) rmSync(workspace, { recursive: true, force: true });
