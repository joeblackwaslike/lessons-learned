#!/usr/bin/env node
/**
 * materialize-workspace.mjs
 *
 * Copies a scenario's seed-workspace into a temp directory and injects the
 * lesson variant specified by the intervention config.
 *
 * Usage:
 *   node scripts/materialize-workspace.mjs \
 *     --scenario <path/to/TC-XX-name> \
 *     --workspace <path/to/temp-dir> \
 *     --intervention '{"type":"lesson","ids":["slug-abc123"]}'
 *
 * Side effects:
 *   - Copies seed-workspace/** into <workspace>/
 *   - Writes .eval/lesson-manifest.json with the intervention's lessons only
 *     (empty manifest for type=none; full filtered manifest for type=lesson|lesson-group)
 *
 * Exits 0 on success, non-zero on error.
 */

import { cpSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVALS_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(EVALS_ROOT, '..');
const MANIFEST_SOURCE = join(REPO_ROOT, 'data', 'lesson-manifest.json');

// --- Arg parsing ----------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));

const scenarioDir = resolve(args['--scenario'] ?? '');
const workspaceDir = resolve(args['--workspace'] ?? '');
const intervention = parseIntervention(args['--intervention'] ?? '{"type":"none","ids":[]}');

if (!scenarioDir || !workspaceDir) {
  console.error(
    'Usage: materialize-workspace.mjs --scenario <dir> --workspace <dir> [--intervention <json>]'
  );
  process.exit(1);
}

// --- Seed workspace copy --------------------------------------------------------

const seedDir = join(scenarioDir, 'seed-workspace');
if (existsSync(seedDir)) {
  cpSync(seedDir, workspaceDir, { recursive: true });
}

// --- Lesson manifest injection --------------------------------------------------

const evalMetaDir = join(workspaceDir, '.eval');
mkdirSync(evalMetaDir, { recursive: true });

const manifest = buildInterventionManifest(intervention);
writeFileSync(join(evalMetaDir, 'lesson-manifest.json'), JSON.stringify(manifest, null, 2));

// Write intervention metadata for artifact collector
writeFileSync(
  join(evalMetaDir, 'intervention.json'),
  JSON.stringify({ ...intervention, scenarioId: scenarioDir.split('/').pop() }, null, 2)
);

// --- Helpers --------------------------------------------------------------------

function buildInterventionManifest(intervention) {
  if (intervention.type === 'none') {
    // Control arm: empty manifest — no lessons injected
    return { lessons: [], version: 1, generatedAt: new Date().toISOString() };
  }

  if (!existsSync(MANIFEST_SOURCE)) {
    console.warn(`lesson-manifest.json not found at ${MANIFEST_SOURCE} — using empty manifest`);
    return { lessons: [], version: 1, generatedAt: new Date().toISOString() };
  }

  let fullManifest;
  try {
    fullManifest = JSON.parse(readFileSync(MANIFEST_SOURCE, 'utf8'));
  } catch (err) {
    console.error(`Failed to parse lesson-manifest.json: ${err.message}`);
    process.exit(1);
  }

  const allLessons = fullManifest.lessons ?? [];
  const ids = new Set(intervention.ids ?? []);

  if (ids.size === 0) {
    console.warn('intervention.ids is empty — no lessons will be injected');
    return { lessons: [], version: 1, generatedAt: new Date().toISOString() };
  }

  // Filter to only the lessons specified in the intervention
  const filtered = allLessons.filter(l => ids.has(l.id) || ids.has(l.slug));

  if (filtered.length === 0) {
    console.warn(`No lessons matched intervention ids: ${[...ids].join(', ')}`);
  }

  return {
    lessons: filtered,
    version: fullManifest.version ?? 1,
    generatedAt: new Date().toISOString(),
    evalIntervention: intervention,
  };
}

function parseIntervention(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    console.error(`Invalid --intervention JSON: ${raw}`);
    process.exit(1);
  }
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      result[argv[i]] = argv[i + 1];
      i++;
    }
  }
  return result;
}
