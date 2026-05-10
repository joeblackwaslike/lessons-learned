#!/usr/bin/env node
/**
 * judge.mjs — Tier 3 LLM judge for lesson injection evals.
 *
 * Invokes the `claude` CLI subprocess in non-interactive (--print) mode,
 * reusing the existing Claude Code OAuth session — no ANTHROPIC_API_KEY needed.
 *
 * Form A (hint/guard): receives both control and treatment transcripts.
 * Form B (protocol/directive): receives treatment transcript only.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SYSTEM =
  'You are an AI evaluator assessing whether a lesson injection changed agent behavior. ' +
  'Respond with valid JSON only — no markdown, no code blocks, no extra text.';

const JUDGE_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['outcome', 'reasoning', 'dimension_scores'],
  properties: {
    outcome: { type: 'string', enum: ['PASS', 'FAIL', 'CONTROL_CORRECT', 'SKIP'] },
    reasoning: { type: 'string' },
    dimension_scores: {
      type: 'object',
      properties: {
        control: { oneOf: [{ type: 'null' }, { type: 'array', items: { type: 'number' } }] },
        treatment: { oneOf: [{ type: 'null' }, { type: 'array', items: { type: 'number' } }] },
      },
    },
    delta: { oneOf: [{ type: 'null' }, { type: 'number' }] },
  },
});

/**
 * @param {{ lesson: object, controlTranscript: string|null, treatmentTranscript: string, form: 'A'|'B' }} params
 * @returns {Promise<{ outcome: string, reasoning: string, dimension_scores: object, delta: number|null }>}
 */
export async function judge({ lesson, controlTranscript, treatmentTranscript, form }) {
  const bin = findClaudeBin();
  if (!bin) throw new Error('claude binary not found — ensure claude is installed and on PATH');

  const userContent =
    form === 'A'
      ? buildFormA(lesson, controlTranscript, treatmentTranscript)
      : buildFormB(lesson, treatmentTranscript);

  const result = spawnSync(
    bin,
    [
      '--print',
      '--model',
      'claude-sonnet-4-6',
      '--system-prompt',
      SYSTEM,
      '--tools',
      '',
      '--no-session-persistence',
      '--output-format',
      'json',
      '--json-schema',
      JUDGE_SCHEMA,
    ],
    { input: userContent, encoding: 'utf8', timeout: 60_000 }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`claude exited ${result.status}: ${(result.stderr ?? '').slice(0, 300)}`);
  }

  const envelope = JSON.parse(result.stdout);
  // With --json-schema, the validated result lands in structured_output (not result).
  // Without it, result contains the raw text string.
  const parsed = envelope.structured_output ?? envelope.result;
  if (parsed !== null && typeof parsed === 'object') return parsed;
  const raw = String(parsed ?? '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Judge returned non-JSON: ${raw.slice(0, 300)}`);
  }
}

function findClaudeBin() {
  const candidates = [
    process.env.CLAUDE_BIN,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    join(process.env.HOME ?? '', '.claude', 'bin', 'claude'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  try {
    const r = spawnSync('which', ['claude'], { encoding: 'utf8' });
    if (r.status === 0) return r.stdout.trim();
  } catch {
    /* ignore */
  }
  return null;
}

function buildFormA(lesson, controlTranscript, treatmentTranscript) {
  return `LESSON SUMMARY: ${lesson.summary}
LESSON PROBLEM: ${lesson.problem}
LESSON SOLUTION: ${lesson.solution}

CONTROL TRANSCRIPT:
${controlTranscript}

TREATMENT TRANSCRIPT:
${treatmentTranscript}

TASK 1 — OUTCOME:
Did the treatment agent actually apply the lesson's solution?
- PASS: Took concrete action preventing the failure mode.
- FAIL: Acknowledged or warned but did not apply the solution.
- CONTROL_CORRECT: Control already avoids the problem without the lesson.
- SKIP: Ambiguous or insufficient information.

TASK 2 — DIMENSION SCORES (0–10 each):
Rate BOTH transcripts on these 5 dimensions:
1. Correctness — did the agent produce a correct result?
2. Scope adherence — did the agent stay within the task scope?
3. Clarity — were the agent's actions and explanations clear?
4. Testability — did the agent produce verifiable, testable output?
5. Absence of failure mode — did the agent avoid the specific failure described in LESSON PROBLEM?

Compute delta = avg(treatment scores) - avg(control scores).

OUTPUT (JSON only, no other text):
{"outcome":"...","reasoning":"<one paragraph>","dimension_scores":{"control":[c1,c2,c3,c4,c5],"treatment":[t1,t2,t3,t4,t5]},"delta":<float>}`;
}

function buildFormB(lesson, treatmentTranscript) {
  return `LESSON SUMMARY: ${lesson.summary}
LESSON PROBLEM: ${lesson.problem}
LESSON SOLUTION: ${lesson.solution}

TREATMENT TRANSCRIPT:
${treatmentTranscript}

TASK 1 — OUTCOME:
Did the treatment agent actively demonstrate the behavior prescribed in the solution?
- PASS: Actively performed the prescribed behavior, not just acknowledged it.
- FAIL: Mentioned or acknowledged the directive but did not act on it.
- SKIP: Ambiguous or insufficient information.

TASK 2 — DIMENSION SCORES (0–10 each):
Rate the TREATMENT transcript only on these 5 dimensions:
1. Correctness — did the agent produce a correct result?
2. Scope adherence — did the agent stay within the task scope?
3. Clarity — were the agent's actions and explanations clear?
4. Testability — did the agent produce verifiable, testable output?
5. Absence of failure mode — did the agent avoid the specific failure described in LESSON PROBLEM?

OUTPUT (JSON only, no other text):
{"outcome":"...","reasoning":"<one paragraph>","dimension_scores":{"control":null,"treatment":[t1,t2,t3,t4,t5]},"delta":null}`;
}
