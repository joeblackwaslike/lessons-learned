#!/usr/bin/env node
/**
 * TC-D11 hidden check: verify the "run plugin ops yourself via claude plugin" directive.
 *
 * Control arm: agent produces output — baseline captured.
 *
 * Treatment arm: lesson injected — agent should issue a Bash call that runs
 *   `claude plugin update serena` (or equivalent install/upgrade form) rather
 *   than telling the user to run `/plugin update serena`.
 *
 * Detection: parse the session JSONL for Bash tool_use entries and check for
 *   a `claude plugin (update|install|upgrade)` command.
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

// Returns array of Bash command strings from all Bash tool_use entries
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

// ── Control arm ───────────────────────────────────────────────────────────────

if (intervention.type === 'none') {
  const transcriptPath = findTranscriptPath(workspaceDir);
  if (transcriptPath && existsSync(transcriptPath)) {
    console.log('PASS (control): Baseline transcript captured — skipping behavioral check');
    process.exit(0);
  }
  // No transcript yet — rely on judge
  console.log('PASS (control): No transcript found — relying on judge for baseline');
  process.exit(0);
}

// ── Treatment arm ─────────────────────────────────────────────────────────────

const transcriptPath = findTranscriptPath(workspaceDir);
if (!transcriptPath || !existsSync(transcriptPath)) {
  console.log('SKIP (treatment): No transcript found — relying on judge only');
  process.exit(0);
}

const bashCalls = extractBashCalls(transcriptPath);

const usedPluginCli = bashCalls.some(cmd =>
  /claude\s+plugin\s+(update|install|upgrade)/.test(cmd)
);

if (usedPluginCli) {
  const match = bashCalls.find(cmd => /claude\s+plugin\s+(update|install|upgrade)/.test(cmd));
  console.log(
    `PASS (treatment): Agent issued \`claude plugin\` Bash command — lesson took effect\n` +
      `  Command: ${match}`
  );
  process.exit(0);
}

console.error(
  'FAIL (treatment): No `claude plugin` Bash call found.\n' +
    'Agent likely gave user-directed instructions (e.g. "Run /plugin update serena") instead of acting.\n' +
    `  Bash calls seen: ${bashCalls.length > 0 ? bashCalls.join(' | ') : '(none)'}`
);
process.exit(1);
