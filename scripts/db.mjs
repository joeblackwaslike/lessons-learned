#!/usr/bin/env node

/**
 * db — SQLite data access layer for the lessons-learned store.
 *
 * Uses node:sqlite (built-in, Node >= 22.5). All operations are synchronous.
 * Array/object columns are stored as JSON text and deserialized on read.
 *
 * Test isolation: set LESSONS_DB_PATH to a temp file path.
 */

import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..');
const DATA_DIR = process.env.LESSONS_DATA_DIR ?? join(PLUGIN_ROOT, 'data');

export const DB_PATH = process.env.LESSONS_DB_PATH ?? join(DATA_DIR, 'lessons.db');

// JSON columns that need parse/stringify on every row.
const JSON_COLUMNS = ['toolNames', 'commandPatterns', 'pathPatterns', 'tags', 'sourceSessionIds'];

// ─── Schema ──────────────────────────────────────────────────────────

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS lessons (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'candidate'
                   CHECK(status IN ('candidate','reviewed','active','disabled','archived')),
  type             TEXT NOT NULL DEFAULT 'hint'
                   CHECK(type IN ('directive','guard','hint','protocol')),
  summary          TEXT NOT NULL,
  mistake          TEXT NOT NULL,
  remediation      TEXT NOT NULL,
  toolNames        TEXT NOT NULL DEFAULT '[]',
  commandPatterns  TEXT NOT NULL DEFAULT '[]',
  pathPatterns     TEXT NOT NULL DEFAULT '[]',
  priority         INTEGER NOT NULL DEFAULT 5,
  confidence       REAL NOT NULL DEFAULT 0.8,
  tags             TEXT NOT NULL DEFAULT '[]',
  source           TEXT NOT NULL DEFAULT 'heuristic'
                   CHECK(source IN ('structured','heuristic','manual')),
  sourceSessionIds TEXT NOT NULL DEFAULT '[]',
  occurrenceCount  INTEGER NOT NULL DEFAULT 0,
  sessionCount     INTEGER NOT NULL DEFAULT 0,
  projectCount     INTEGER NOT NULL DEFAULT 0,
  contentHash      TEXT NOT NULL,
  createdAt        TEXT NOT NULL,
  updatedAt        TEXT NOT NULL,
  reviewedAt       TEXT,
  archivedAt       TEXT,
  archiveReason    TEXT
);

CREATE INDEX IF NOT EXISTS idx_lessons_status          ON lessons(status);
CREATE INDEX IF NOT EXISTS idx_lessons_priority        ON lessons(priority DESC);
CREATE INDEX IF NOT EXISTS idx_lessons_status_priority ON lessons(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_lessons_hash            ON lessons(contentHash);
`;

// ─── Lifecycle ───────────────────────────────────────────────────────

/**
 * Open (or create) the DB and initialize the schema.
 * @param {string} [path]
 * @returns {DatabaseSync}
 */
export function openDb(path = DB_PATH) {
  const db = new DatabaseSync(path);
  initSchema(db);
  applyMigrations(db);
  return db;
}

/**
 * Close the database, flushing any pending WAL writes.
 * @param {DatabaseSync} db
 */
export function closeDb(db) {
  db.close();
}

/**
 * Create tables and indexes. Safe to call multiple times (CREATE IF NOT EXISTS).
 * @param {DatabaseSync} db
 */
export function initSchema(db) {
  db.exec(SCHEMA_SQL);
}

function applyMigrations(db) {
  const cols = db
    .prepare('PRAGMA table_info(lessons)')
    .all()
    .map(r => r.name);

  // Migration: add type taxonomy + remove redundant columns
  if (!cols.includes('type')) {
    db.exec(`ALTER TABLE lessons ADD COLUMN type TEXT NOT NULL DEFAULT 'hint'`);

    // Backfill type from old block/injectOn fields (still present at this point)
    db.exec(`UPDATE lessons SET type='guard' WHERE block=1`);
    db.exec(`UPDATE lessons SET type='protocol' WHERE injectOn='["SessionStart"]' AND block=0`);

    // Fold the rerun guidance into the pytest guard lesson's remediation
    db.exec(
      `UPDATE lessons SET remediation = remediation || char(10) || 'Rerun as: pytest -p no:faulthandler --no-header'` +
        ` WHERE slug LIKE 'pytest-tty-hanging%'`
    );

    // Recreate table to drop columns + update CHECK constraints (SQLite requirement)
    db.exec('BEGIN');
    db.exec(`
      CREATE TABLE lessons_new (
        id               TEXT PRIMARY KEY,
        slug             TEXT NOT NULL UNIQUE,
        status           TEXT NOT NULL DEFAULT 'candidate'
                         CHECK(status IN ('candidate','reviewed','active','disabled','archived')),
        type             TEXT NOT NULL DEFAULT 'hint'
                         CHECK(type IN ('directive','guard','hint','protocol')),
        summary          TEXT NOT NULL,
        mistake          TEXT NOT NULL,
        remediation      TEXT NOT NULL,
        toolNames        TEXT NOT NULL DEFAULT '[]',
        commandPatterns  TEXT NOT NULL DEFAULT '[]',
        pathPatterns     TEXT NOT NULL DEFAULT '[]',
        priority         INTEGER NOT NULL DEFAULT 5,
        confidence       REAL NOT NULL DEFAULT 0.8,
        tags             TEXT NOT NULL DEFAULT '[]',
        source           TEXT NOT NULL DEFAULT 'heuristic'
                         CHECK(source IN ('structured','heuristic','manual')),
        sourceSessionIds TEXT NOT NULL DEFAULT '[]',
        occurrenceCount  INTEGER NOT NULL DEFAULT 0,
        sessionCount     INTEGER NOT NULL DEFAULT 0,
        projectCount     INTEGER NOT NULL DEFAULT 0,
        contentHash      TEXT NOT NULL,
        createdAt        TEXT NOT NULL,
        updatedAt        TEXT NOT NULL,
        reviewedAt       TEXT,
        archivedAt       TEXT,
        archiveReason    TEXT
      )
    `);
    db.exec(`
      INSERT INTO lessons_new
        SELECT id, slug, status, type, summary, mistake, remediation,
               toolNames, commandPatterns, pathPatterns,
               priority, confidence, tags, source, sourceSessionIds,
               occurrenceCount, sessionCount, projectCount,
               contentHash, createdAt, updatedAt, reviewedAt, archivedAt, archiveReason
        FROM lessons
    `);
    db.exec('DROP TABLE lessons');
    db.exec('ALTER TABLE lessons_new RENAME TO lessons');
    db.exec('COMMIT');

    db.exec('CREATE INDEX IF NOT EXISTS idx_lessons_status          ON lessons(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_lessons_priority        ON lessons(priority DESC)');
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_lessons_status_priority ON lessons(status, priority DESC)'
    );
    db.exec('CREATE INDEX IF NOT EXISTS idx_lessons_hash            ON lessons(contentHash)');
  }
}

// ─── Serialization ───────────────────────────────────────────────────

/**
 * Deserialize a raw DB row (null-prototype object, JSON text columns) to a plain object.
 * @param {object} row
 * @returns {object}
 */
export function deserializeRow(row) {
  const plain = Object.assign({}, row);
  for (const col of JSON_COLUMNS) {
    if (typeof plain[col] === 'string') {
      try {
        plain[col] = JSON.parse(plain[col]);
      } catch {
        plain[col] = [];
      }
    } else if (plain[col] == null) {
      plain[col] = [];
    }
  }
  return plain;
}

function serializeRecord(record) {
  const out = { ...record };
  for (const col of JSON_COLUMNS) {
    if (Array.isArray(out[col])) {
      out[col] = JSON.stringify(out[col]);
    }
  }
  return out;
}

// ─── Dedup helpers ───────────────────────────────────────────────────

/**
 * Look up a record by exact contentHash. Returns the raw row or null.
 * @param {DatabaseSync} db
 * @param {string} hash
 * @returns {object|null}
 */
export function findByContentHash(db, hash) {
  const row = db.prepare('SELECT id, slug, status FROM lessons WHERE contentHash = ?').get(hash);
  return row ? Object.assign({}, row) : null;
}

/**
 * Get minimal { id, slug, mistake } for all active+reviewed records (for Jaccard dedup).
 * @param {DatabaseSync} db
 * @returns {{ id: string, slug: string, mistake: string }[]}
 */
export function getExistingMistakeTexts(db) {
  return /** @type {{ id: string, slug: string, mistake: string }[]} */ (
    db
      .prepare("SELECT id, slug, mistake FROM lessons WHERE status IN ('active','reviewed')")
      .all()
      .map(r => Object.assign({}, r))
  );
}

function tokenize(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
}

function jaccardSimilarity(a, b) {
  const A = tokenize(a);
  const B = tokenize(b);
  const intersection = [...A].filter(w => B.has(w)).length;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : intersection / union;
}

// ─── Writes ──────────────────────────────────────────────────────────

/**
 * Insert a new candidate record with dedup checks.
 *
 * Dedup order:
 *   1. Exact contentHash match → { ok: false, reason: 'duplicate_hash', existing }
 *   2. Jaccard >= 0.5 vs any active/reviewed lesson → { ok: false, reason: 'fuzzy_duplicate', existing }
 *
 * @param {DatabaseSync} db
 * @param {object} record - All fields except id/createdAt/updatedAt (auto-set if absent)
 * @returns {{ ok: boolean, id?: string, reason?: string, existing?: object }}
 */
export function insertCandidate(db, record) {
  const existing = findByContentHash(db, record.contentHash);
  if (existing) {
    return { ok: false, reason: 'duplicate_hash', existing };
  }

  const mistakeTexts = getExistingMistakeTexts(db);
  for (const row of mistakeTexts) {
    if (jaccardSimilarity(record.mistake, row.mistake) >= 0.5) {
      return { ok: false, reason: 'fuzzy_duplicate', existing: { id: row.id, slug: row.slug } };
    }
  }

  const now = new Date().toISOString();
  const id = record.id ?? generateUlid();
  const row = serializeRecord({
    id,
    slug: record.slug,
    status: record.status ?? 'candidate',
    type: record.type ?? 'hint',
    summary: record.summary,
    mistake: record.mistake,
    remediation: record.remediation,
    toolNames: record.toolNames ?? [],
    commandPatterns: record.commandPatterns ?? [],
    pathPatterns: record.pathPatterns ?? [],
    priority: record.priority ?? 5,
    confidence: record.confidence ?? 0.8,
    tags: record.tags ?? [],
    source: record.source ?? 'heuristic',
    sourceSessionIds: record.sourceSessionIds ?? [],
    occurrenceCount: record.occurrenceCount ?? 1,
    sessionCount: record.sessionCount ?? 1,
    projectCount: record.projectCount ?? 1,
    contentHash: record.contentHash,
    createdAt: record.createdAt ?? now,
    updatedAt: record.updatedAt ?? now,
    reviewedAt: record.reviewedAt ?? null,
    archivedAt: record.archivedAt ?? null,
    archiveReason: record.archiveReason ?? null,
  });

  db.prepare(
    `
    INSERT INTO lessons (
      id, slug, status, type, summary, mistake, remediation,
      toolNames, commandPatterns, pathPatterns,
      priority, confidence, tags, source,
      sourceSessionIds, occurrenceCount, sessionCount, projectCount,
      contentHash, createdAt, updatedAt, reviewedAt, archivedAt, archiveReason
    ) VALUES (
      :id, :slug, :status, :type, :summary, :mistake, :remediation,
      :toolNames, :commandPatterns, :pathPatterns,
      :priority, :confidence, :tags, :source,
      :sourceSessionIds, :occurrenceCount, :sessionCount, :projectCount,
      :contentHash, :createdAt, :updatedAt, :reviewedAt, :archivedAt, :archiveReason
    )
  `
  ).run(row);

  return { ok: true, id };
}

/**
 * Batch-insert candidates. Runs inside a transaction; skips individual duplicates.
 *
 * @param {DatabaseSync} db
 * @param {object[]} records
 * @returns {{ inserted: number, skipped: number, skippedReasons: string[] }}
 */
export function insertCandidateBatch(db, records) {
  let inserted = 0;
  let skipped = 0;
  const skippedReasons = [];

  db.exec('BEGIN');
  try {
    for (const record of records) {
      const result = insertCandidate(db, record);
      if (result.ok) {
        inserted++;
      } else {
        skipped++;
        skippedReasons.push(`${record.slug ?? record.contentHash?.slice(0, 12)}: ${result.reason}`);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { inserted, skipped, skippedReasons };
}

/**
 * Promote records to status='active'. Applies optional per-id field patches first.
 *
 * Patchable fields: summary, mistake, remediation, type, injection,
 * commandPatterns, pathPatterns, priority, confidence, tags
 *
 * @param {DatabaseSync} db
 * @param {string[]} ids
 * @param {Record<string, object>} [patches]
 * @returns {{ id: string, slug: string }[]}
 */
export function promoteToActive(db, ids, patches = {}) {
  if (ids.length === 0) return [];

  const now = new Date().toISOString();

  db.exec('BEGIN');
  try {
    for (const id of ids) {
      const patch = patches[id];
      if (patch) {
        const PATCHABLE = [
          'summary',
          'mistake',
          'remediation',
          'type',
          'injection',
          'commandPatterns',
          'pathPatterns',
          'priority',
          'confidence',
          'tags',
        ];
        const fields = Object.keys(patch).filter(k => PATCHABLE.includes(k));
        if (fields.length > 0) {
          const setClauses = fields.map(f => `${f} = :${f}`).join(', ');
          const values = { id };
          for (const f of fields) {
            const val = patch[f];
            values[f] = Array.isArray(val) ? JSON.stringify(val) : val;
          }
          db.prepare(`UPDATE lessons SET ${setClauses}, updatedAt = :now WHERE id = :id`).run({
            ...values,
            now,
          });
        }
      }
    }

    const placeholders = ids.map(() => '?').join(',');
    db.prepare(
      `UPDATE lessons SET status='active', reviewedAt=?, updatedAt=? WHERE id IN (${placeholders})`
    ).run(now, now, ...ids);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const placeholders = ids.map(() => '?').join(',');
  return /** @type {{ id: string, slug: string }[]} */ (
    db
      .prepare(`SELECT id, slug FROM lessons WHERE id IN (${placeholders})`)
      .all(...ids)
      .map(r => Object.assign({}, r))
  );
}

/**
 * Update fields on an existing record without changing its status.
 *
 * Patchable fields: summary, mistake, remediation, injection, injectOn,
 * commandPatterns, pathPatterns, priority, confidence, tags, block, blockReason
 *
 * @param {DatabaseSync} db
 * @param {string} id
 * @param {object} patch
 * @returns {{ id: string, slug: string } | null}  null if ID not found
 */
export function updateRecord(db, id, patch) {
  const PATCHABLE = [
    'summary',
    'mistake',
    'remediation',
    'type',
    'commandPatterns',
    'pathPatterns',
    'priority',
    'confidence',
    'tags',
  ];
  const fields = Object.keys(patch).filter(k => PATCHABLE.includes(k));
  if (fields.length === 0) return null;

  const now = new Date().toISOString();
  const setClauses = fields.map(f => `${f} = :${f}`).join(', ');
  const values = { id, now };
  for (const f of fields) {
    const val = patch[f];
    values[f] = Array.isArray(val) ? JSON.stringify(val) : val;
  }

  db.prepare(`UPDATE lessons SET ${setClauses}, updatedAt = :now WHERE id = :id`).run(values);

  const row = db.prepare('SELECT id, slug FROM lessons WHERE id = ?').get(id);
  return row ? /** @type {{ id: string, slug: string }} */ (Object.assign({}, row)) : null;
}

/**
 * Restore archived records back to status='active'.
 *
 * @param {DatabaseSync} db
 * @param {string[]} ids
 * @returns {{ id: string, slug: string }[]}
 */
export function restoreToActive(db, ids) {
  if (ids.length === 0) return [];

  const now = new Date().toISOString();
  const placeholders = ids.map(() => '?').join(',');

  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE lessons SET status='active', archivedAt=NULL, archiveReason=NULL, updatedAt=? WHERE id IN (${placeholders})`
    ).run(now, ...ids);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return /** @type {{ id: string, slug: string }[]} */ (
    db
      .prepare(`SELECT id, slug FROM lessons WHERE id IN (${placeholders})`)
      .all(...ids)
      .map(r => Object.assign({}, r))
  );
}

/**
 * Archive records with reasons.
 *
 * @param {DatabaseSync} db
 * @param {Array<{ id: string, reason: string }>} items
 * @returns {{ id: string, slug: string }[]}
 */
export function archiveRecords(db, items) {
  if (items.length === 0) return [];

  const now = new Date().toISOString();

  db.exec('BEGIN');
  try {
    for (const { id, reason } of items) {
      db.prepare(
        `UPDATE lessons SET status='archived', archivedAt=?, archiveReason=?, updatedAt=? WHERE id=?`
      ).run(now, reason, now, id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const ids = items.map(i => i.id);
  const placeholders = ids.map(() => '?').join(',');
  return /** @type {{ id: string, slug: string }[]} */ (
    db
      .prepare(`SELECT id, slug FROM lessons WHERE id IN (${placeholders})`)
      .all(...ids)
      .map(r => Object.assign({}, r))
  );
}

// ─── Reads ───────────────────────────────────────────────────────────

/**
 * Fetch all active records ordered by priority DESC. Used by buildManifest().
 * @param {DatabaseSync} db
 * @returns {object[]}
 */
export function getActiveRecords(db) {
  return db
    .prepare("SELECT * FROM lessons WHERE status='active' ORDER BY priority DESC")
    .all()
    .map(deserializeRow);
}

export function getManifestRecords(db) {
  return db
    .prepare("SELECT * FROM lessons WHERE status IN ('active','disabled') ORDER BY priority DESC")
    .all()
    .map(deserializeRow);
}

/**
 * Fetch all candidate records ranked by (sessionCount * projectCount * confidence) DESC.
 * Used by scan aggregate.
 * @param {DatabaseSync} db
 * @returns {object[]}
 */
export function getCandidateRecords(db) {
  return db
    .prepare(
      `
      SELECT * FROM lessons
      WHERE status='candidate'
      ORDER BY (sessionCount * projectCount * confidence) DESC, priority DESC
    `
    )
    .all()
    .map(deserializeRow);
}

/**
 * Fetch records by IDs. Used by promote to validate inputs.
 * @param {DatabaseSync} db
 * @param {string[]} ids
 * @returns {object[]}
 */
export function getRecordsByIds(db, ids) {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM lessons WHERE id IN (${placeholders})`)
    .all(...ids)
    .map(deserializeRow);
}

// ─── ULID (self-contained, no dep on lessons.mjs) ────────────────────

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateUlid() {
  let now = Date.now();
  let timeStr = '';
  for (let i = 10; i > 0; i--) {
    const mod = now % ENCODING.length;
    timeStr = ENCODING[mod] + timeStr;
    now = (now - mod) / ENCODING.length;
  }
  const bytes = randomBytes(16);
  let randStr = '';
  for (let i = 0; i < 16; i++) randStr += ENCODING[bytes[i] % ENCODING.length];
  return timeStr + randStr;
}

/**
 * Compute a content hash for a candidate record.
 * Mirrors the current computeContentHash() logic in lessons.mjs.
 * @param {{ mistake: string, remediation: string, commandPatterns?: string[] }} record
 * @returns {string}
 */
export function computeContentHash(record) {
  const patterns = record.commandPatterns ?? [];
  const data = `${record.mistake}|${record.remediation}|${JSON.stringify(patterns)}`;
  return 'sha256:' + createHash('sha256').update(data).digest('hex');
}
