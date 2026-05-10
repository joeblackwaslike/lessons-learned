/**
 * Promptfoo beforeAll + beforeEach extension hooks.
 *
 * beforeAll  — loads the lesson manifest once at suite start.
 * beforeEach — for treatment arms, injects lessonSnapshot from the cached manifest.
 *
 * The lesson snapshot is used by:
 *   - claude-agent.mjs: cache key computation + judge call
 *   - Promptfoo DB: stored as a test var for historical interpretability
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(__dirname, '..', '..', '..', 'data', 'lesson-manifest.json');

let manifest = null;

export async function beforeAll() {
  if (!existsSync(MANIFEST_PATH)) return;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    // manifest unavailable — beforeEach will skip lesson injection
  }
}

export async function beforeEach(context) {
  const intervention = context.test.vars?.intervention;
  if (intervention?.type !== 'lesson' || !intervention.ids?.length) return;
  if (!manifest) return;

  const targetSlug = intervention.ids[0];
  const lessons = manifest.lessons ?? {};
  const lesson = Object.values(lessons).find(l => l.slug === targetSlug || l.id === targetSlug);
  if (!lesson) return;

  return {
    test: { vars: { lessonSnapshot: JSON.stringify(lesson) } },
  };
}
