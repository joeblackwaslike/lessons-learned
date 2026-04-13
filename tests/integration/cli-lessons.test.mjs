/**
 * Integration tests: lessons.mjs CLI subcommands as subprocesses.
 *
 * Uses LESSONS_DATA_DIR to point at a temp copy of the fixture lessons store,
 * so tests never touch the real data directory.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../helpers/subprocess.mjs';
import { createTmpStore } from '../helpers/tmpstore.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LESSONS_CLI = join(__dirname, '..', '..', 'scripts', 'lessons.mjs');

// A well-formed lesson distinct from the fixture seed (git stash)
const VALID_LESSON_2 = {
  summary: 'Use npm ci instead of npm install in CI pipelines for reproducibility',
  problem: 'Using npm install in CI can silently upgrade packages, breaking reproducibility',
  solution: 'Replace npm install with npm ci in all CI/CD pipelines for locked installs',
  triggers: {
    toolNames: ['Bash'],
    commandPatterns: ['\\bnpm install\\b'],
  },
  priority: 6,
  tags: ['tool:npm', 'topic:ci'],
};

let store;

beforeEach(() => {
  store = createTmpStore();
});
afterEach(() => {
  store.cleanup();
});

function env() {
  return { LESSONS_DATA_DIR: store.dir };
}

// ─── lessons add ──────────────────────────────────────────────────────────

describe('lessons add', () => {
  it('adds a valid lesson via --json flag', async () => {
    const { exitCode, stderr } = await run(LESSONS_CLI, {
      args: ['add', '--json', JSON.stringify(VALID_LESSON_2)],
      env: env(),
    });
    assert.equal(exitCode, 0, `unexpected failure: ${stderr}`);
  });

  it('persists the lesson to lessons.json', async () => {
    await run(LESSONS_CLI, {
      args: ['add', '--json', JSON.stringify(VALID_LESSON_2)],
      env: env(),
    });
    const { stdout } = await run(LESSONS_CLI, {
      args: ['list', '--json'],
      env: env(),
    });
    const lessons = JSON.parse(stdout);
    const added = lessons.find(l => l.summary === VALID_LESSON_2.summary);
    assert.ok(added, 'lesson should appear in list after add');
  });

  it('rebuilds lesson-manifest.json after add', async () => {
    await run(LESSONS_CLI, {
      args: ['add', '--json', JSON.stringify(VALID_LESSON_2)],
      env: env(),
    });
    const { readFileSync } = await import('node:fs');
    const manifest = JSON.parse(readFileSync(store.manifestPath, 'utf8'));
    assert.equal(manifest.type, 'lessons-learned-manifest');
    // The fixture lesson (git stash -u) should be in the manifest
    const slugs = Object.values(manifest.lessons ?? {}).map(l => l.slug);
    assert.ok(
      slugs.some(s => s.includes('git')),
      `manifest slugs: ${slugs.join(', ')}`
    );
  });

  it('rejects a lesson with short summary (< 20 chars)', async () => {
    const bad = { ...VALID_LESSON_2, summary: 'Too short' };
    const { exitCode, stderr } = await run(LESSONS_CLI, {
      args: ['add', '--json', JSON.stringify(bad)],
      env: env(),
    });
    assert.notEqual(exitCode, 0, 'expected failure for short summary');
    assert.ok(stderr.includes('Failed') || stderr.includes('validation'));
  });

  it('rejects a lesson with short problem (< 20 chars)', async () => {
    const bad = { ...VALID_LESSON_2, problem: 'npm install bad' };
    const { exitCode } = await run(LESSONS_CLI, {
      args: ['add', '--json', JSON.stringify(bad)],
      env: env(),
    });
    assert.notEqual(exitCode, 0);
  });

  it('rejects a lesson with unfilled template placeholders', async () => {
    const bad = {
      ...VALID_LESSON_2,
      problem: 'Running <what_went_wrong> causes problems in production',
    };
    const { exitCode } = await run(LESSONS_CLI, {
      args: ['add', '--json', JSON.stringify(bad)],
      env: env(),
    });
    assert.notEqual(exitCode, 0);
  });

  it('rejects a duplicate lesson by content hash', async () => {
    // First add succeeds
    await run(LESSONS_CLI, {
      args: ['add', '--json', JSON.stringify(VALID_LESSON_2)],
      env: env(),
    });
    // Second add of identical content should fail
    const { exitCode } = await run(LESSONS_CLI, {
      args: ['add', '--json', JSON.stringify(VALID_LESSON_2)],
      env: env(),
    });
    assert.notEqual(exitCode, 0, 'duplicate should be rejected');
  });
});

// ─── lessons build ────────────────────────────────────────────────────────

describe('lessons build', () => {
  it('exits 0 and writes a valid manifest', async () => {
    const { exitCode } = await run(LESSONS_CLI, {
      args: ['build'],
      env: env(),
    });
    assert.equal(exitCode, 0);
    const { readFileSync } = await import('node:fs');
    const manifest = JSON.parse(readFileSync(store.manifestPath, 'utf8'));
    assert.equal(manifest.type, 'lessons-learned-manifest');
    assert.equal(manifest.version, 1);
    assert.ok(typeof manifest.lessons === 'object');
  });

  it('includes commandRegexSources for lessons with commandPatterns', async () => {
    const { exitCode } = await run(LESSONS_CLI, {
      args: ['build'],
      env: env(),
    });
    assert.equal(exitCode, 0);
    const { readFileSync } = await import('node:fs');
    const manifest = JSON.parse(readFileSync(store.manifestPath, 'utf8'));
    const lessons = Object.values(manifest.lessons ?? {});
    const withCmd = lessons.filter(l => l.commandRegexSources?.length > 0);
    assert.ok(withCmd.length > 0, 'at least one lesson should have commandRegexSources');
  });

  it('manifest lessons have required shape fields', async () => {
    await run(LESSONS_CLI, { args: ['build'], env: env() });
    const { readFileSync } = await import('node:fs');
    const manifest = JSON.parse(readFileSync(store.manifestPath, 'utf8'));
    for (const [, lesson] of Object.entries(manifest.lessons ?? {})) {
      assert.ok('slug' in lesson, 'slug missing');
      assert.ok('message' in lesson, 'message missing');
      assert.ok('type' in lesson, 'type missing');
      assert.ok('priority' in lesson, 'priority missing');
      assert.ok(Array.isArray(lesson.toolNames), 'toolNames should be array');
    }
  });
});

// ─── lessons list ─────────────────────────────────────────────────────────

describe('lessons list', () => {
  it('exits 0', async () => {
    const { exitCode } = await run(LESSONS_CLI, {
      args: ['list'],
      env: env(),
    });
    assert.equal(exitCode, 0);
  });

  it('--json outputs a valid JSON array', async () => {
    const { stdout, exitCode } = await run(LESSONS_CLI, {
      args: ['list', '--json'],
      env: env(),
    });
    assert.equal(exitCode, 0);
    const lessons = JSON.parse(stdout);
    assert.ok(Array.isArray(lessons), 'expected JSON array');
  });

  it('count matches lessons in store', async () => {
    const { stdout } = await run(LESSONS_CLI, {
      args: ['list', '--json'],
      env: env(),
    });
    const lessons = JSON.parse(stdout);
    // Fixture has 1 lesson (git stash), so list should have 1
    assert.equal(lessons.length, 1);
  });
});
