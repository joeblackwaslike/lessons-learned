#!/usr/bin/env node
/**
 * repair-judge-errors.mjs
 *
 * Re-runs the Tier 3 judge for any treatment arm cache files where
 * judgeResult.error === true. Patches the cache file in place.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=meridian ANTHROPIC_BASE_URL=http://127.0.0.1:3456 \
 *     node evals/scripts/repair-judge-errors.mjs
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge } from './judge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '..', 'results', 'cache');
const MANIFEST_PATH = join(__dirname, '..', '..', 'data', 'lesson-manifest.json');

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const lessonMap = Object.fromEntries(Object.values(manifest.lessons).map(l => [l.slug, l]));

const armFiles = readdirSync(CACHE_DIR).filter(
  f => f.endsWith('.json') && !f.startsWith('control-') && f !== 'latest-run.json'
);

const toRepair = [];
for (const f of armFiles) {
  const filePath = join(CACHE_DIR, f);
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    continue;
  }
  const meta = data.metadata;
  if (!meta?.judgeResult?.error) continue;
  if (meta.intervention?.type !== 'lesson') continue;
  toRepair.push({ filePath, data });
}

console.log(`Found ${toRepair.length} treatment caches with judge errors to repair.\n`);

let repaired = 0;
let failed = 0;

for (const { filePath, data } of toRepair) {
  const meta = data.metadata;
  const sc = meta.scenarioId;
  const lessonIds = meta.intervention?.ids ?? [];
  const lessonId = lessonIds[0];
  const lesson = lessonMap[lessonId];

  if (!lesson) {
    console.error(`  SKIP ${sc}: lesson "${lessonId}" not found in manifest`);
    failed++;
    continue;
  }

  // Determine form: A if control transcript exists, B otherwise
  const controlHash = meta.controlHash;
  const controlFile = controlHash ? join(CACHE_DIR, `control-${controlHash}.json`) : null;
  const controlExists = controlFile && existsSync(controlFile);

  let controlTranscript = null;
  if (controlExists) {
    try {
      const ctrl = JSON.parse(readFileSync(controlFile, 'utf8'));
      controlTranscript = ctrl.output ?? null;
    } catch (_) {
      controlTranscript = null;
    }
  }

  const form = controlTranscript ? 'A' : 'B';
  const treatmentTranscript = data.output ?? '';

  if (!treatmentTranscript) {
    console.error(`  SKIP ${sc}: no treatment transcript`);
    failed++;
    continue;
  }

  process.stdout.write(`  ${sc} [form ${form}] ... `);
  try {
    const judgeResult = await judge({ lesson, controlTranscript, treatmentTranscript, form });
    data.metadata.judgeResult = judgeResult;
    writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`${judgeResult.outcome} (delta=${judgeResult.delta ?? 'null'})`);
    repaired++;
  } catch (err) {
    console.log(`ERROR: ${err.message.slice(0, 80)}`);
    failed++;
  }
}

console.log(`\nDone. Repaired: ${repaired}  Failed: ${failed}`);
