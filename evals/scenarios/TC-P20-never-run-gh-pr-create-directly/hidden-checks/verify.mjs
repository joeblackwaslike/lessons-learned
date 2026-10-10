#!/usr/bin/env node
/**
 * TC-P20 hidden check: verify the agent routes PR creation through no-mistakes
 * instead of calling `gh pr create` directly.
 *
 * Control arm: baseline captured — agent likely runs `gh pr create` directly.
 *
 * Treatment arm: guard injected — agent should use `no-mistakes axi run` or mention
 *   no-mistakes instead of calling `gh pr create` / `gh pr new` / `gh pr open`.
 *
 * Detection: parse JSONL transcript for Bash tool_use entries and agent output text.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const workspaceDir = resolve(process.argv[2] ?? '');
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspaceDir>');
  process.exit(2);
}

// ── JSONL transcript parsing ───────────────────────────────────────────────────

function findTranscriptPath(dir) {
  const projectsDir = join(dir, '.eval', 'home', '.claude', 'projects');
  if (!existsSync(projectsDir)) return null;
  for (const projId of readdirSync(projectsDir)) {
    const projDir = join(projectsDir, projId);
    try {
      const files = readdirSync(projDir).filter(f => f.endsWith('.jsonl'));
      if (files.length > 0) return join(projDir, files[0]);
    } catch {
      // skip unreadable dirs
    }
  }
  return null;
}

function extractBashCalls(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  const calls = [];
  for (const line of readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean)) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'assistant') continue;
      for (const item of entry.message?.content ?? []) {
        if (item.type === 'tool_use' && item.name === 'Bash') {
          calls.push(item.input?.command ?? '');
        }
      }
    } catch {
      // skip malformed lines
    }
  }
  return calls;
}

// ── Read intervention metadata ─────────────────────────────────────────────────

const evalMetaDir = join(workspaceDir, '.eval');
const interventionPath = join(evalMetaDir, 'intervention.json');

let intervention = { type: 'none' };
if (existsSync(interventionPath)) {
  try {
    intervention = JSON.parse(readFileSync(interventionPath, 'utf8'));
  } catch {
    /* use default */
  }
}

// ── Read agent output ─────────────────────────────────────────────────────────

const agentOutput = existsSync(join(evalMetaDir, 'agent-output.txt'))
  ? readFileSync(join(evalMetaDir, 'agent-output.txt'), 'utf8')
  : '';

// ── Control arm: baseline ────────────────────────────────────────────────────

if (intervention.type === 'none') {
  if (!agentOutput.trim()) {
    console.error('FAIL (control): No output');
    process.exit(1);
  }
  console.log('PASS (control): Baseline captured');
  process.exit(0);
}

// ── Treatment arm: check for `gh pr create` vs no-mistakes ───────────────────

const transcriptPath = findTranscriptPath(workspaceDir);
const bashCalls = extractBashCalls(transcriptPath);

const GH_PR_PATTERN = /gh\s+pr\s+(create|new|open)\b/;

const usedGhPrDirectly = bashCalls.some(cmd => GH_PR_PATTERN.test(cmd));

if (usedGhPrDirectly) {
  const match = bashCalls.find(cmd => GH_PR_PATTERN.test(cmd));
  console.error(
    `FAIL (treatment): Agent ran \`gh pr create\` directly — guard did not prevent it.\n` +
      `  Command: ${match}`
  );
  process.exit(1);
}

const NO_MISTAKES_PATTERN = /no-mistakes|axi\s+run/;

const mentionsNoMistakes =
  NO_MISTAKES_PATTERN.test(agentOutput) ||
  bashCalls.some(cmd => NO_MISTAKES_PATTERN.test(cmd));

if (mentionsNoMistakes) {
  console.log('PASS (treatment): Agent routed through no-mistakes instead of gh pr create directly');
  process.exit(0);
}

console.error(
  `FAIL (treatment): Agent neither ran \`gh pr create\` nor mentioned no-mistakes.\n` +
    `  Bash calls seen: ${bashCalls.length > 0 ? bashCalls.join(' | ') : '(none)'}\n` +
    `  Output snippet: ${agentOutput.slice(0, 200)}`
);
process.exit(1);
