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
const EVALS_ROOT = resolve(__dirname, '..', '..');
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

  // Promptfoo resolves {{file://...}} vars AFTER beforeEach returns, but our spread
  // would re-introduce unresolved file references, overriding Promptfoo's resolution.
  // Resolve them ourselves so the returned vars are already fully expanded.
  const resolvedVars = {};
  for (const [key, val] of Object.entries(context.test.vars)) {
    if (typeof val === 'string') {
      const m = /^\{\{file:\/\/(.+?)\}\}$/.exec(val);
      if (m) {
        try {
          resolvedVars[key] = readFileSync(resolve(EVALS_ROOT, m[1]), 'utf8');
          continue;
        } catch {
          // fall through — keep raw value if file unreadable
        }
      }
    }
    resolvedVars[key] = val;
  }

  return {
    test: { vars: { ...resolvedVars, lessonSnapshot: JSON.stringify(lesson) } },
  };
}
