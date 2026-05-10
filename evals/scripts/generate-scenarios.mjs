#!/usr/bin/env node
/**
 * generate-scenarios.mjs — scaffold TC-* scenario folders for lessons that lack one.
 *
 * Usage:
 *   node scripts/generate-scenarios.mjs [options]
 *
 * Options:
 *   --ids <slug,...>    Only generate for specific lesson slugs
 *   --hint "<text>"     Append a focus hint to the generation prompt
 *   --force             Overwrite existing generated scenarios
 *   --dry-run           Show what would be generated, without creating files
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVALS_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(EVALS_ROOT, '..');
const MANIFEST_PATH = join(REPO_ROOT, 'data', 'lesson-manifest.json');
const SCENARIOS_DIR = join(EVALS_ROOT, 'scenarios');
const CONFIG_PATH = join(EVALS_ROOT, 'promptfooconfig.yaml');

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const filterIds = args['--ids'] ? args['--ids'].split(',').map(s => s.trim()) : null;
const hint = args['--hint'] ?? null;
const force = '--force' in args;
const dryRun = '--dry-run' in args;

// ── Load manifest ─────────────────────────────────────────────────────────────

if (!existsSync(MANIFEST_PATH)) {
  console.error(`lesson-manifest.json not found at ${MANIFEST_PATH}`);
  console.error('Run: node scripts/lessons.mjs build');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const allLessons = Object.values(manifest.lessons ?? {});
const activeLessons = allLessons.filter(l => !l.disabled);

// ── Find lessons without scenarios ────────────────────────────────────────────

const existingLessonIds = new Set();
for (const entry of readdirSync(SCENARIOS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const scenarioJsonPath = join(SCENARIOS_DIR, entry.name, 'scenario.json');
  if (!existsSync(scenarioJsonPath)) continue;
  try {
    const scenario = JSON.parse(readFileSync(scenarioJsonPath, 'utf8'));
    if (scenario.lessonId) existingLessonIds.add(scenario.lessonId);
  } catch {
    /* skip malformed */
  }
}

let lessonsToGenerate = activeLessons.filter(l => !existingLessonIds.has(l.slug));
if (filterIds) {
  lessonsToGenerate = lessonsToGenerate.filter(l => filterIds.includes(l.slug));
  const alreadyExists = activeLessons.filter(
    l => filterIds.includes(l.slug) && existingLessonIds.has(l.slug) && !force
  );
  for (const l of alreadyExists) {
    console.log(`⏭  Skipping ${l.slug} — scenario already exists (use --force to overwrite)`);
  }
}

if (force && filterIds) {
  lessonsToGenerate = activeLessons.filter(l => filterIds.includes(l.slug));
}

if (lessonsToGenerate.length === 0) {
  console.log('✓ All lessons have scenarios. Nothing to generate.');
  process.exit(0);
}

console.log(`Generating ${lessonsToGenerate.length} scenario(s)${dryRun ? ' [dry-run]' : ''}...\n`);

// ── Generate scenarios ────────────────────────────────────────────────────────

const client = new Anthropic();
const generatedScenarios = [];

for (const lesson of lessonsToGenerate) {
  const scenarioId = buildScenarioId(lesson, SCENARIOS_DIR);
  const scenarioDir = join(SCENARIOS_DIR, scenarioId);

  console.log(`  ${lesson.type.toUpperCase()} ${lesson.slug}`);
  console.log(`  → ${scenarioId}`);

  if (dryRun) {
    console.log('  [dry-run: skipping file creation]\n');
    continue;
  }

  const triggerPrompt = await generateTriggerPrompt(client, lesson, hint);
  scaffoldScenario(scenarioDir, scenarioId, lesson, triggerPrompt);
  generatedScenarios.push({ scenarioId, lesson });
  console.log('  ✓ scaffolded\n');
}

if (!dryRun && generatedScenarios.length > 0) {
  appendToConfig(generatedScenarios);
  console.log(
    `\n✓ Updated promptfooconfig.yaml with ${generatedScenarios.length} new scenario pair(s).`
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function generateTriggerPrompt(client, lesson, hint) {
  const hintLine = hint ? `\n\nAdditional focus: ${hint}` : '';
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    temperature: 0.3,
    messages: [
      {
        role: 'user',
        content: `LESSON SUMMARY: ${lesson.summary}
LESSON PROBLEM: ${lesson.problem}
LESSON SOLUTION: ${lesson.solution}

Write a single user request (1–3 sentences) that would naturally lead an AI coding assistant to make the specific mistake described in PROBLEM. Be realistic and specific enough to trigger the mistake — do not hint at the solution or mention the lesson.${hintLine}

Output the prompt text only, no preamble.`,
      },
    ],
  });
  return msg.content.find(c => c.type === 'text')?.text?.trim() ?? '';
}

function buildScenarioId(lesson, scenarioDir) {
  const typePrefix = { hint: 'H', guard: 'G', protocol: 'P', directive: 'D' }[lesson.type] ?? 'X';
  const existing = readdirSync(scenarioDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith(`TC-${typePrefix}`))
    .map(e => parseInt(e.name.match(/TC-[A-Z](\d+)/)?.[1] ?? '0', 10))
    .filter(n => !isNaN(n));
  const nextNum = existing.length > 0 ? Math.max(...existing) + 1 : 1;

  // Slug: strip entropy suffix (last 5 chars: -xxxx) and truncate
  const baseSlug = lesson.slug
    .replace(/-[a-f0-9]{4}$/, '')
    .slice(0, 30)
    .replace(/-+$/, '');
  return `TC-${typePrefix}${nextNum}-${baseSlug}`;
}

function scaffoldScenario(scenarioDir, scenarioId, lesson, triggerPrompt) {
  mkdirSync(join(scenarioDir, 'seed-workspace'), { recursive: true });
  mkdirSync(join(scenarioDir, 'hidden-checks'), { recursive: true });

  const category = ['protocol', 'directive'].includes(lesson.type) ? 'session-start' : 'pretooluse';

  const scenarioJson = {
    id: scenarioId,
    title: lesson.summary,
    category,
    lessonType: lesson.type,
    interventionType: 'lesson',
    lessonId: lesson.slug,
    difficulty: 'auto',
    promptFile: 'PROMPT.md',
    workspaceSeedDir: 'seed-workspace',
    verifyScript: 'hidden-checks/verify.mjs',
    recommendedInterventions: [lesson.slug],
    automaticFailGates: [],
    generated: true,
  };

  writeFileSync(join(scenarioDir, 'scenario.json'), JSON.stringify(scenarioJson, null, 2) + '\n');
  writeFileSync(join(scenarioDir, 'PROMPT.md'), triggerPrompt + '\n');
  writeFileSync(
    join(scenarioDir, 'hidden-checks', 'verify.mjs'),
    [
      '#!/usr/bin/env node',
      '// Auto-generated verify: checks that agent produced non-empty output.',
      "import { readFileSync, existsSync } from 'node:fs';",
      "import { join } from 'node:path';",
      'const workspaceDir = process.argv[2];',
      "const outputFile = join(workspaceDir, '.eval', 'agent-output.txt');",
      'if (!existsSync(outputFile)) process.exit(1);',
      "const output = readFileSync(outputFile, 'utf8').trim();",
      'process.exit(output.length > 10 ? 0 : 1);',
      '',
    ].join('\n')
  );
  writeFileSync(join(scenarioDir, 'seed-workspace', '.gitkeep'), '');
}

function appendToConfig(generatedScenarios) {
  const raw = readFileSync(CONFIG_PATH, 'utf8');
  const config = yaml.load(raw);

  for (const { scenarioId, lesson } of generatedScenarios) {
    const promptRef = `{{file://scenarios/${scenarioId}/PROMPT.md}}`;
    config.tests.push({
      description: `${scenarioId} [control]`,
      vars: { scenarioId, prompt: promptRef, intervention: { type: 'none', ids: [] } },
    });
    config.tests.push({
      description: `${scenarioId} [treatment]`,
      vars: {
        scenarioId,
        prompt: promptRef,
        intervention: { type: 'lesson', ids: [lesson.slug] },
      },
      assert: [
        { type: 'javascript', value: 'file://scripts/assert-hidden-check.mjs' },
        { type: 'javascript', value: 'file://scripts/assert-judge.mjs' },
      ],
    });
  }

  writeFileSync(CONFIG_PATH, yaml.dump(config, { lineWidth: 120, quotingType: '"' }));
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        result[argv[i]] = argv[i + 1];
        i++;
      } else {
        result[argv[i]] = true;
      }
    }
  }
  return result;
}
