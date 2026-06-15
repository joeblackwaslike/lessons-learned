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
    duplicatedBy: null,
    requires: null,
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
      createdAt, updatedAt, duplicatedBy, requires
    ) VALUES (
      :id, :slug, :status, :type, :summary, :problem, :solution, :injection,
      :injectOn, :toolNames, :commandPatterns, :pathPatterns, :block,
      :priority, :confidence, :tags, :source, :sourceSessionIds,
      :occurrenceCount, :sessionCount, :projectCount, :contentHash,
      :createdAt, :updatedAt, :duplicatedBy, :requires
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

  it('flags underspecified bare-word commandPattern', async () => {
    insertLesson(store.dbPath, {
      commandPatterns: JSON.stringify(['tsc']),
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /unanchored bare word/);
  });

  it('does not flag an anchored or multi-token commandPattern', async () => {
    insertLesson(store.dbPath, {
      commandPatterns: JSON.stringify(['\\btsc\\b', 'npx tsc', 'npm.*build']),
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 0, `anchored/multi-token patterns should pass: ${stdout}`);
  });

  function readCommandPatterns(dbPath, id) {
    const db = new DatabaseSync(dbPath);
    const row = db.prepare('SELECT commandPatterns FROM lessons WHERE id = ?').get(id);
    db.close();
    return JSON.parse(String(row.commandPatterns));
  }

  it('anchors bare-word commandPatterns when promoting a candidate', async () => {
    // Raw insert bypasses buildTriggers, exactly like a deep-scan candidate.
    const id = 'promote-bare-tsc';
    insertLesson(store.dbPath, {
      id,
      status: 'candidate',
      commandPatterns: JSON.stringify(['tsc']),
    });

    const { exitCode } = await run(LESSONS_CLI, {
      args: ['promote', '--ids', id],
      env: env(),
    });
    assert.equal(exitCode, 0);
    assert.deepEqual(
      readCommandPatterns(store.dbPath, id),
      ['\\btsc\\b'],
      'promotion should anchor the stored pattern'
    );
  });

  it('anchors bare-word commandPatterns when editing a lesson', async () => {
    const id = 'edit-bare-tsc';
    insertLesson(store.dbPath, { id });

    const { exitCode } = await run(LESSONS_CLI, {
      args: ['edit', '--id', id, '--patch', JSON.stringify({ commandPatterns: ['tsc'] })],
      env: env(),
    });
    assert.equal(exitCode, 0);
    assert.deepEqual(readCommandPatterns(store.dbPath, id), ['\\btsc\\b']);
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
    assert.match(
      stdout,
      /solution references a version string|problem references a version string/
    );
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

  it('flags requires with invalid type', async () => {
    insertLesson(store.dbPath, {
      requires: JSON.stringify({ type: 'unknown', name: 'foo' }),
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /requires\.type "unknown" is invalid/);
  });

  it('flags requires with missing name for plugin type', async () => {
    insertLesson(store.dbPath, {
      requires: JSON.stringify({ type: 'plugin' }),
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /requires\.name is required for plugin\/skill\/mcp-server types/);
  });

  it('excludes lesson from manifest when requires artifact is not installed', async () => {
    insertLesson(store.dbPath, {
      requires: JSON.stringify({ type: 'plugin', name: 'definitely-not-installed-xyzzy' }),
    });

    const { exitCode } = await run(LESSONS_CLI, {
      args: ['build'],
      env: env(),
    });
    assert.equal(exitCode, 0);

    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const manifest = JSON.parse(readFileSync(join(store.dir, 'lesson-manifest.json'), 'utf8'));
    const lessons = Object.values(manifest.lessons);
    const found = lessons.some(l => l.slug?.startsWith('test-lesson-'));
    assert.equal(found, false, 'lesson with unmet requires should be excluded from manifest');
  });

  it('emits uncovered-tools warning when 10+ lessons all target same tool', async () => {
    for (let i = 0; i < 10; i++)
      insertLesson(store.dbPath, { toolNames: JSON.stringify(['Bash']) });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /uncovered tools/);
    assert.match(stdout, /WebFetch/);
  });

  it('suppresses uncovered-tools warning when corpus has fewer than 10 lessons', async () => {
    // fixture seeds 1 Bash lesson, so 8 more = 9 total, which is below the 10-lesson threshold
    for (let i = 0; i < 8; i++) insertLesson(store.dbPath, { toolNames: JSON.stringify(['Bash']) });

    const { stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.doesNotMatch(stdout, /uncovered tools/);
  });

  it('emits tool-concentration warning when one tool exceeds 80% of hint/guard lessons', async () => {
    // 7 Bash + 1 Read = 87.5% Bash, well above the 80% threshold
    for (let i = 0; i < 7; i++) insertLesson(store.dbPath, { toolNames: JSON.stringify(['Bash']) });
    insertLesson(store.dbPath, { toolNames: JSON.stringify(['Read']) });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /tool concentration/);
    assert.match(stdout, /"Bash"/);
  });

  it('emits blanket-bash warning when more than 3 hint/guard lessons target Bash with no commandPatterns', async () => {
    for (let i = 0; i < 4; i++)
      insertLesson(store.dbPath, {
        toolNames: JSON.stringify(['Bash']),
        commandPatterns: JSON.stringify([]),
      });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /hint\/guard lessons target Bash with no commandPatterns/);
  });

  it('suppresses blanket-bash warning when 3 or fewer such lessons exist', async () => {
    for (let i = 0; i < 3; i++)
      insertLesson(store.dbPath, {
        toolNames: JSON.stringify(['Bash']),
        commandPatterns: JSON.stringify([]),
      });

    const { stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.doesNotMatch(stdout, /hint\/guard lessons target Bash with no commandPatterns/);
  });

  it('emits untagged-majority warning when more than 30% of lessons have no tags', async () => {
    // 5 lessons all with empty tags = 100% untagged, well above 30% threshold
    for (let i = 0; i < 5; i++) insertLesson(store.dbPath, { tags: JSON.stringify([]) });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /have no tags/);
  });

  it('flags version string in problem field', async () => {
    insertLesson(store.dbPath, {
      problem:
        'Since upgrading to @angular/core v17.2 the change detection strategy no longer fires automatically on async updates.',
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /problem references a version string/);
  });

  it('flags temporal language in solution field', async () => {
    insertLesson(store.dbPath, {
      solution:
        'The --no-verify flag was deprecated in git 2.40; use --no-run-if-empty in the reflog config instead.',
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /time-anchored language/);
    assert.match(stdout, /deprecated/);
  });

  it('flags temporal language in problem field', async () => {
    insertLesson(store.dbPath, {
      problem:
        'The requests.get API was formerly a drop-in replacement for urllib but the httpx API diverged significantly.',
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /time-anchored language/);
    assert.match(stdout, /formerly/);
  });

  it('does not flag normal guidance as temporal language', async () => {
    insertLesson(store.dbPath, {
      solution:
        'Use git stash -u to include untracked files in every stash operation to avoid silent data loss.',
    });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 0, `clean lesson should pass: ${stdout}`);
  });

  it('flags stale lesson when updatedAt is older than 180 days', async () => {
    const oldDate = new Date(Date.now() - 181 * 86400000).toISOString();
    insertLesson(store.dbPath, { updatedAt: oldDate });

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.equal(exitCode, 1);
    assert.match(stdout, /lesson not updated in \d+ days/);
  });

  it('does not flag lesson updated within 180 days', async () => {
    const recentDate = new Date(Date.now() - 90 * 86400000).toISOString();
    insertLesson(store.dbPath, { updatedAt: recentDate });

    const { stdout } = await run(LESSONS_CLI, {
      args: ['doctor'],
      env: env(),
    });
    assert.doesNotMatch(stdout, /lesson not updated in/);
  });
});
