/**
 * Integration tests: `lessons doctor` subcommand.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { run } from '../helpers/subprocess.mjs';
import { createTmpStore } from '../helpers/tmpstore.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LESSONS_CLI = join(__dirname, '..', '..', 'scripts', 'lessons.mjs');

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

function insertLesson(dbPath, overrides = {}) {
  const defaults = {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    slug: `test-lesson-${Math.random().toString(36).slice(2)}`,
    status: 'active',
    type: 'hint',
    summary: 'A valid summary under 80 chars',
    problem:
      'Running git stash without the -u flag silently leaves untracked files behind, risking data loss when the stash is applied elsewhere.',
    solution:
      'Use git stash -u or git stash --include-untracked to include untracked files in every stash operation.',
    injection: null,
    injectOn: JSON.stringify(['PreToolUse']),
    toolNames: JSON.stringify(['Bash']),
    commandPatterns: JSON.stringify(['\\bgit stash\\b']),
    pathPatterns: JSON.stringify([]),
    block: 0,
    priority: 5,
    confidence: 0.8,
    tags: JSON.stringify([]),
    source: 'manual',
    sourceSessionIds: JSON.stringify([]),
    occurrenceCount: 0,
    sessionCount: 0,
    projectCount: 0,
    contentHash: `sha256:test${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const row = { ...defaults, ...overrides };
  const db = new DatabaseSync(dbPath);
  db.prepare(
    `
    INSERT INTO lessons (
      id, slug, status, type, summary, problem, solution, injection,
      injectOn, toolNames, commandPatterns, pathPatterns, block,
      priority, confidence, tags, source, sourceSessionIds,
      occurrenceCount, sessionCount, projectCount, contentHash,
      createdAt, updatedAt
    ) VALUES (
      :id, :slug, :status, :type, :summary, :problem, :solution, :injection,
      :injectOn, :toolNames, :commandPatterns, :pathPatterns, :block,
      :priority, :confidence, :tags, :source, :sourceSessionIds,
      :occurrenceCount, :sessionCount, :projectCount, :contentHash,
      :createdAt, :updatedAt
    )
  `
  ).run(row);
  db.close();
}

describe('lessons doctor', () => {
  it('exits 0 and prints success when all lessons are clean', async () => {
    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 0, 'should succeed with no issues');
    assert.match(stdout, /All \d+ lessons passed/);
  });

  it('flags hint lesson with empty toolNames', async () => {
    insertLesson(store.dbPath, {
      type: 'hint',
      toolNames: JSON.stringify([]),
      commandPatterns: JSON.stringify(['\\bgit stash\\b']),
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /missing toolNames — lesson can never fire/);
  });

  it('flags guard lesson with empty toolNames', async () => {
    insertLesson(store.dbPath, {
      type: 'guard',
      toolNames: JSON.stringify([]),
      commandPatterns: JSON.stringify(['rm -rf']),
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /missing toolNames — lesson can never fire/);
  });

  it('does not flag directive/protocol for missing toolNames', async () => {
    insertLesson(store.dbPath, {
      type: 'directive',
      toolNames: JSON.stringify([]),
      commandPatterns: JSON.stringify([]),
      pathPatterns: JSON.stringify([]),
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 0, `directive with no toolNames should pass: ${stdout}`);
  });

  it('flags summary longer than 80 chars', async () => {
    insertLesson(store.dbPath, {
      summary: 'A'.repeat(81),
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /summary too long \(81 chars, max 80\)/);
  });

  it('does not flag summary of exactly 80 chars', async () => {
    insertLesson(store.dbPath, {
      summary: 'A'.repeat(80),
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 0, `80-char summary should pass: ${stdout}`);
  });

  it('flags summary ending with ...', async () => {
    insertLesson(store.dbPath, {
      summary: 'This summary looks truncated...',
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /summary appears truncated/);
  });

  it('flags template placeholder in summary', async () => {
    insertLesson(store.dbPath, {
      summary: 'Lesson about <tool_name> doing something wrong',
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /summary contains unfilled template placeholder/);
  });

  it('flags template placeholder in problem field', async () => {
    insertLesson(store.dbPath, {
      problem: '<what_went_wrong> causes issues in certain scenarios when used incorrectly',
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /problem contains unfilled template placeholder/);
  });

  it('flags hint with no commandPatterns or pathPatterns', async () => {
    insertLesson(store.dbPath, {
      type: 'hint',
      toolNames: JSON.stringify(['Bash']),
      commandPatterns: JSON.stringify([]),
      pathPatterns: JSON.stringify([]),
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /no commandPatterns or pathPatterns/);
  });

  it('does not flag hint that has only pathPatterns', async () => {
    insertLesson(store.dbPath, {
      type: 'hint',
      toolNames: JSON.stringify(['Read']),
      commandPatterns: JSON.stringify([]),
      pathPatterns: JSON.stringify(['**/*.env']),
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 0, `hint with pathPatterns should pass: ${stdout}`);
  });

  it('--json outputs { lessons, store } shape and exits 1', async () => {
    insertLesson(store.dbPath, {
      slug: 'bad-toolnames-slug',
      type: 'hint',
      toolNames: JSON.stringify([]),
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor', '--json'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    const out = JSON.parse(stdout);
    assert.ok(Array.isArray(out.lessons), 'output.lessons should be an array');
    assert.ok(Array.isArray(out.store), 'output.store should be an array');
    const bad = out.lessons.find(r => r.slug === 'bad-toolnames-slug');
    assert.ok(bad, 'bad lesson should appear in output.lessons');
    assert.ok(bad.issues.some(i => i.includes('toolNames')));
  });

  it('--json exits 0 with empty arrays when no issues', async () => {
    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor', '--json'],
      env: env(),
    });
    assert.equal(exitCode, 0);
    const out = JSON.parse(stdout);
    assert.deepEqual(out.lessons, []);
    assert.deepEqual(out.store, []);
  });

  it('flags directive with non-empty toolNames', async () => {
    insertLesson(store.dbPath, {
      type: 'directive',
      toolNames: JSON.stringify(['Bash']),
      commandPatterns: JSON.stringify([]),
      pathPatterns: JSON.stringify([]),
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /directive\/protocol has toolNames/);
  });

  it('does not flag directive with empty toolNames', async () => {
    insertLesson(store.dbPath, {
      type: 'directive',
      toolNames: JSON.stringify([]),
      commandPatterns: JSON.stringify([]),
      pathPatterns: JSON.stringify([]),
    });

    const { exitCode } = await run(LESSONS_CLI, { args: ['doctor'], env: env() });
    assert.equal(exitCode, 0);
  });

  it('flags solution shorter than 60 chars', async () => {
    insertLesson(store.dbPath, {
      solution: 'Use -u flag.',
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /solution too short/);
  });

  it('flags solution that restates the problem', async () => {
    const shared =
      'Running git stash silently omits untracked files leaving them behind risking data loss';
    insertLesson(store.dbPath, { problem: shared, solution: shared });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /solution restates problem/);
  });

  it('flags overspecified commandPattern', async () => {
    insertLesson(store.dbPath, {
      commandPatterns: JSON.stringify([
        'git stash push --include-untracked --keep-index --message "my specific stash"',
      ]),
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /may be overspecified/);
  });

  it('flags solution with version reference', async () => {
    insertLesson(store.dbPath, {
      solution:
        'Install via pip install pydantic==v1.10 and use the v1 API which differs from v2 behavior significantly',
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /solution references a version string/);
  });

  it('flags context bleed in problem field', async () => {
    insertLesson(store.dbPath, {
      problem:
        'In this repo I ran the migration and found that it silently dropped foreign key constraints during the upgrade process',
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /context-bleed|session-specific language/);
  });

  it('emits store-level priority-homogeneity warning when all lessons same priority', async () => {
    // Need >= 5 lessons for the check to activate; seed 4 more all at priority 5 (default)
    // so 4/5 = 80% at priority 5, meeting the threshold.
    for (let i = 0; i < 4; i++) insertLesson(store.dbPath, { priority: 5 });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /priority homogeneity/);
  });

  it('reports multiple issues on the same lesson', async () => {
    insertLesson(store.dbPath, {
      type: 'hint',
      toolNames: JSON.stringify([]),
      commandPatterns: JSON.stringify([]),
      pathPatterns: JSON.stringify([]),
      summary: 'A'.repeat(85),
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /missing toolNames/);
    assert.match(stdout, /summary too long/);
    assert.match(stdout, /no commandPatterns or pathPatterns/);
  });
});
