#!/usr/bin/env node
/**
 * gen-regression-traps.mjs — generate one adversarial "trap" task per obsoleted
 * lesson, used by the obsoleted-lessons regression suite (regression-probe.mjs).
 *
 * For each entry in data/obsoleted-lessons.json, asks the model to write a
 * realistic developer task that NATURALLY leads a careless agent into the
 * lesson's failure mode — without naming the lesson, the failure, or the fix.
 * A careful model avoids the trap (lesson obsolete); a careless one falls in
 * (lesson still needed). Traps are written to data/obsoleted-traps.json keyed
 * by lesson slug. Idempotent: existing traps are kept unless --force.
 *
 * Reads ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL (meridian) like judge.mjs.
 *   ANTHROPIC_API_KEY=meridian ANTHROPIC_BASE_URL=http://127.0.0.1:3456 \
 *     node evals/scripts/gen-regression-traps.mjs [--force] [--only <slug,...>]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', '..', 'data');
const LEDGER = join(DATA, 'obsoleted-lessons.json');
const TRAPS = join(DATA, 'obsoleted-traps.json');
const MODEL = process.env.EVAL_TRAP_MODEL ?? 'claude-sonnet-4-6';

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const onlyIdx = argv.indexOf('--only');
const only = onlyIdx >= 0 ? new Set(argv[onlyIdx + 1].split(',')) : null;

const SYSTEM =
  'You design adversarial evaluation tasks. You write a single realistic developer ' +
  'request that would naturally lead a careless coding agent into a specific mistake, ' +
  'WITHOUT ever naming the mistake, the failure, or the correct fix. Respond with JSON only.';

function buildPrompt(lesson) {
  return `A lesson warns about this failure mode:
PROBLEM: ${lesson.problem}
CORRECT FIX: ${lesson.solution}

Write ONE realistic, self-contained developer task (2-5 sentences) that:
- asks the agent to do concrete work where the straightforward/naive approach commits exactly this failure,
- sets up the conditions that trigger it (e.g. the input value, the flag, the file with a space),
- does NOT mention the failure, the risk, the fix, or this lesson in any way,
- reads like a normal request a developer would type.

OUTPUT (JSON only): {"trap":"<the task prompt>","triggers":"<one line: what naive output would fail>"}`;
}

const client = new Anthropic();

async function genTrap(lesson) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: SYSTEM,
    messages: [{ role: 'user', content: buildPrompt(lesson) }],
  });
  const raw = msg.content.find(c => c.type === 'text')?.text?.trim() ?? '';
  await new Promise(r => setTimeout(r, 2000));
  return JSON.parse(raw);
}

const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
const traps = existsSync(TRAPS) ? JSON.parse(readFileSync(TRAPS, 'utf8')) : { traps: {} };

let done = 0;
for (const lesson of ledger.entries) {
  if (only && !only.has(lesson.slug)) continue;
  if (traps.traps[lesson.slug] && !force) continue;
  try {
    const t = await genTrap(lesson);
    traps.traps[lesson.slug] = {
      trap: t.trap,
      triggers: t.triggers,
      scenario: lesson.evalScenario,
      generatedBy: MODEL,
    };
    done++;
    console.log(`[${done}] ${lesson.slug}\n    ${t.trap}`);
    writeFileSync(TRAPS, JSON.stringify(traps, null, 2) + '\n');
  } catch (e) {
    console.error(`SKIP ${lesson.slug}: ${e.message.slice(0, 80)}`);
  }
}
console.log(`\nGenerated ${done} trap(s) → ${TRAPS}`);
