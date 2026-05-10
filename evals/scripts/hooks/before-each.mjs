/**
 * Promptfoo beforeEach extension hook.
 *
 * For treatment arms (intervention.type === 'lesson'), loads the lesson data
 * from the compiled manifest and injects it as vars.lessonSnapshot (JSON string).
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

let cachedManifest = null;

function loadManifest() {
  if (cachedManifest) return cachedManifest;
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    cachedManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    return cachedManifest;
  } catch {
    return null;
  }
}

export async function beforeEach(context) {
  const intervention = context.test.vars?.intervention;
  if (!intervention || intervention.type !== 'lesson' || !intervention.ids?.length) return;

  const manifest = loadManifest();
  if (!manifest) return;

  const targetSlug = intervention.ids[0];
  const lessons = manifest.lessons ?? {};

  const lesson = Object.values(lessons).find(l => l.slug === targetSlug || l.id === targetSlug);
  if (!lesson) return;

  return {
    test: { vars: { lessonSnapshot: JSON.stringify(lesson) } },
  };
}
