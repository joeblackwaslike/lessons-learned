import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../scripts/db.mjs';
import { SCHEMA_SQL } from '../helpers/tmpstore.mjs';

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function legacyDb(prepare) {
  const dir = mkdtempSync(join(tmpdir(), 'll-migrate-'));
  dirs.push(dir);
  const path = join(dir, 'lessons.db');
  const db = new DatabaseSync(path);
  db.exec(SCHEMA_SQL);
  prepare(db);
  db.close();
  return path;
}

function insertLesson(db, extra = {}) {
  const row = {
    id: '1',
    slug: 'one',
    summary: 's',
    problem: 'p',
    solution: 'so',
    contentHash: 'h',
    createdAt: 'now',
    updatedAt: 'now',
    ...extra,
  };
  const names = Object.keys(row);
  db.prepare(
    `INSERT INTO lessons (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`
  ).run(...Object.values(row));
}

const columnsOf = db =>
  db
    .prepare('PRAGMA table_info(lessons)')
    .all()
    .map(c => c.name);

describe('lessons DB migration to contentPatterns and modelScope', () => {
  it('moves modelPatterns data into contentPatterns and adds an empty modelScope', () => {
    const path = legacyDb(db => {
      db.exec(`ALTER TABLE lessons ADD COLUMN modelPatterns TEXT NOT NULL DEFAULT '[]'`);
      insertLesson(db, { modelPatterns: '["gpt"]' });
    });
    const db = openDb(path);
    const row = db.prepare('SELECT * FROM lessons').get();
    assert.equal(row.contentPatterns, '["gpt"]');
    assert.equal(row.modelScope, '[]');
    assert.ok(!columnsOf(db).includes('modelPatterns'));
    db.close();
  });

  it('adds contentPatterns to a DB that never had modelPatterns', () => {
    const path = legacyDb(db => insertLesson(db));
    const db = openDb(path);
    const cols = columnsOf(db);
    assert.ok(cols.includes('contentPatterns') && cols.includes('modelScope'));
    assert.ok(!cols.includes('modelPatterns'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lessons').get().n, 1);
    db.close();
  });

  it('keeps evalSkipReason through the outputPatterns table rebuild', () => {
    const path = legacyDb(db => {
      db.exec(`ALTER TABLE lessons ADD COLUMN evalSkipReason TEXT`);
      insertLesson(db, { evalSkipReason: 'untestable' });
    });
    const db = openDb(path);
    assert.equal(
      db.prepare('SELECT evalSkipReason FROM lessons').get().evalSkipReason,
      'untestable'
    );
    db.close();
  });

  it('is idempotent: reopening a migrated DB leaves the same columns and no modelPatterns', () => {
    const path = legacyDb(db => {
      db.exec(`ALTER TABLE lessons ADD COLUMN modelPatterns TEXT NOT NULL DEFAULT '[]'`);
      insertLesson(db, { modelPatterns: '["gpt"]' });
    });
    const first = openDb(path);
    const columns = columnsOf(first);
    first.close();
    const second = openDb(path);
    assert.deepEqual(columnsOf(second), columns);
    assert.equal(
      second.prepare('SELECT contentPatterns FROM lessons').get().contentPatterns,
      '["gpt"]'
    );
    second.close();
  });
});
