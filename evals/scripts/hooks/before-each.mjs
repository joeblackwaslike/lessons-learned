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

/** Resolve {{file://path}} template references in vars before Promptfoo sees them. */
function resolveFileRefs(vars) {
  const resolved = {};
  for (const [key, val] of Object.entries(vars)) {
    if (typeof val === 'string') {
      const m = /^\{\{file:\/\/(.+?)\}\}$/.exec(val);
      if (m) {
        try {
          resolved[key] = readFileSync(resolve(EVALS_ROOT, m[1]), 'utf8');
          continue;
        } catch {
          // fall through — keep raw value if file unreadable
        }
      }
    }
    resolved[key] = val;
  }
  return resolved;
}

export async function beforeEach(context) {
  const intervention = context.test.vars?.intervention;
  const isLesson = intervention?.type === 'lesson' && intervention.ids?.length > 0;

  if (!isLesson) {
    // Control arm: resolve file refs so the provider receives actual file content.
    const resolvedVars = resolveFileRefs(context.test.vars);
    const hasFileRef = Object.values(context.test.vars).some(
      v => typeof v === 'string' && v.startsWith('{{file://')
    );
    return hasFileRef ? { test: { vars: resolvedVars } } : undefined;
  }

  if (!manifest) return;

  const targetSlug = intervention.ids[0];
  const lessons = manifest.lessons ?? {};
  const lesson = Object.values(lessons).find(l => l.slug === targetSlug || l.id === targetSlug);
  if (!lesson) return;

  return {
    test: {
      vars: { ...resolveFileRefs(context.test.vars), lessonSnapshot: JSON.stringify(lesson) },
    },
  };
}
