#!/usr/bin/env node
/**
 * judge.mjs — Tier 3 LLM judge for lesson injection evals.
 *
 * Uses the Anthropic SDK directly (reads ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL
 * from env) so it works with the meridian proxy without needing the claude CLI.
 *
 * Form A (hint/guard): receives both control and treatment transcripts.
 * Form B (protocol/directive): receives treatment transcript only.
 */

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM =
  'You are an AI evaluator assessing whether a lesson injection changed agent behavior. ' +
  'Respond with valid JSON only — no markdown, no code blocks, no extra text.';

/**
 * @param {{ lesson: object, controlTranscript: string|null, treatmentTranscript: string, form: 'A'|'B' }} params
 * @returns {Promise<{ outcome: string, reasoning: string, dimension_scores: object, delta: number|null }>}
 */
// Hard floor between judge calls — prevents rate-limit quota burns when
// multiple scenarios complete back-to-back. 3 s is enough for meridian/Claude Max.
const JUDGE_DELAY_MS = 3_000;

export async function judge({ lesson, controlTranscript, treatmentTranscript, form }) {
  const client = new Anthropic();

  const userContent =
    form === 'A'
      ? buildFormA(lesson, controlTranscript, treatmentTranscript)
      : buildFormB(lesson, treatmentTranscript);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  });

  await new Promise(r => setTimeout(r, JUDGE_DELAY_MS));

  const raw = message.content.find(c => c.type === 'text')?.text?.trim() ?? '';
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Judge returned non-JSON: ${raw.slice(0, 300)}`);
  }
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
