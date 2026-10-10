#!/usr/bin/env node
/**
 * TC-P21 hidden check: agent should reply on the review thread, not post a top-level PR comment.
 *
 * Control arm: baseline captured (output exists).
 * Treatment arm:
 *   FAIL (suspicious) if only `gh pr comment <N> --body` is present with no mention of
 *   thread reply — but defer final verdict to LLM rubric since the distinction is semantic.
 *   PASS if output exists; rubric handles the substantive check.
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

const bashCmds = hookEvents.filter(e => e.tool_name === 'Bash').map(e => e.tool_input?.command ?? '');

if (intervention.type === 'none') {
  if (!agentOutput.trim()) {
    console.error('FAIL (control): No agent output');
    process.exit(1);
  }
  console.log('PASS (control): Baseline captured');
  process.exit(0);
}

// Treatment arm: check for output first
if (!agentOutput.trim()) {
  console.error('FAIL (treatment): No agent output');
  process.exit(1);
}

// Detect top-level-only pattern: `gh pr comment <N> --body` with no reply endpoint
const hasTopLevelOnly = bashCmds.some(cmd =>
  /gh\s+pr\s+comment\s+\d+/.test(cmd) && !/replies|resolveReviewThread/.test(cmd)
);
const mentionsReply = agentOutput.includes('replies') ||
  agentOutput.includes('resolveReviewThread') ||
  /comment.*483948291/.test(agentOutput) ||
  agentOutput.includes('thread');

if (hasTopLevelOnly && !mentionsReply) {
  console.error('FAIL (treatment): Used top-level gh pr comment without thread reply — rubric should confirm');
  process.exit(1);
}

console.log('PASS (treatment): Output present; substantive check deferred to rubric');
process.exit(0);
