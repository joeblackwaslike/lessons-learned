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
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

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
  problem          TEXT NOT NULL,
  solution         TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS lesson_vec_map (
  lesson_id TEXT NOT NULL PRIMARY KEY,
  vec_rowid INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS review_sessions (
  id        TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  promoted  TEXT NOT NULL DEFAULT '[]',
  archived  TEXT NOT NULL DEFAULT '[]',
  patches   TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS pending_semantic_windows (
  id              TEXT PRIMARY KEY,
  windowText      TEXT NOT NULL,
  nearestDistance REAL NOT NULL,
  nearestLessonId TEXT,
  seedType        TEXT NOT NULL DEFAULT 'lesson',
  projectId       TEXT,
  filePath        TEXT,
  windowIndex     INTEGER,
  createdAt       TEXT NOT NULL,
  processedAt     TEXT
);

CREATE INDEX IF NOT EXISTS idx_psw_processedAt ON pending_semantic_windows(processedAt);

`;

// ─── Lifecycle ───────────────────────────────────────────────────────

/**
 * Open (or create) the DB and initialize the schema.
 * @param {string} [path]
 * @param {{ allowExtension?: boolean }} [options]
 * @returns {DatabaseSync}
 */
export function openDb(path = DB_PATH, { allowExtension = false } = {}) {
  const db = allowExtension
    ? new DatabaseSync(path, { allowExtension: true })
    : new DatabaseSync(path);
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
        problem          TEXT NOT NULL,
        solution         TEXT NOT NULL,
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

  // Migration: rename mistake→problem, remediation→solution
  // Re-read cols to account for prior migrations that may have recreated the table.
  const currentCols = db
    .prepare('PRAGMA table_info(lessons)')
    .all()
    .map(r => r.name);
  if (currentCols.includes('mistake')) {
    db.exec('ALTER TABLE lessons RENAME COLUMN mistake TO problem');
    db.exec('ALTER TABLE lessons RENAME COLUMN remediation TO solution');
  }

  // Migration: add commandMatchTarget column (defaults to NULL = use type-based default at build time)
  if (!currentCols.includes('commandMatchTarget')) {
    db.exec(`ALTER TABLE lessons ADD COLUMN commandMatchTarget TEXT`);
  }

  // Migration: add scope column (NULL = global; project ID string = scoped to that project)
  if (!currentCols.includes('scope')) {
    db.exec(`ALTER TABLE lessons ADD COLUMN scope TEXT`);
  }

  // Migration: add embedding BLOB column (stored as Float32 buffer; NULL = not yet embedded)
  const latestCols = db
    .prepare('PRAGMA table_info(lessons)')
    .all()
    .map(r => r.name);
  if (!latestCols.includes('embedding')) {
    db.exec(`ALTER TABLE lessons ADD COLUMN embedding BLOB`);
  }

  // Migration: add seedType column to pending_semantic_windows (distinguishes lesson vs insight matches)
  const pswCols = db
    .prepare('PRAGMA table_info(pending_semantic_windows)')
    .all()
    .map(r => r.name);
  if (!pswCols.includes('seedType')) {
    db.exec(
      `ALTER TABLE pending_semantic_windows ADD COLUMN seedType TEXT NOT NULL DEFAULT 'lesson'`
    );
  }

  // Migration: drop insight_seed_map table (replaced by structural pattern matching in patternScanFile)
  db.exec('DROP TABLE IF EXISTS insight_seed_map');

  // Migration: import legacy review session JSON files into the review_sessions table
  const reviewSessionsDir = join(DATA_DIR, 'review-sessions');
  try {
    const files = readdirSync(reviewSessionsDir).filter(f => f.endsWith('.json'));
    const insert = db.prepare(
      `INSERT OR IGNORE INTO review_sessions (id, createdAt, promoted, archived, patches)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const file of files) {
      try {
        const session = JSON.parse(readFileSync(join(reviewSessionsDir, file), 'utf8'));
        insert.run(
          session.id,
          session.createdAt,
          JSON.stringify(session.promoted ?? []),
          JSON.stringify(session.archived ?? []),
          JSON.stringify(session.patches ?? {})
        );
      } catch {
        // skip malformed files
      }
    }
  } catch {
    // review-sessions dir doesn't exist yet — nothing to import
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
 * Get minimal { id, slug, problem } for all active+reviewed records (for Jaccard dedup).
 * @param {DatabaseSync} db
 * @returns {{ id: string, slug: string, problem: string }[]}
 */
export function getExistingProblemTexts(db) {
  return /** @type {{ id: string, slug: string, problem: string }[]} */ (
    db
      .prepare("SELECT id, slug, problem FROM lessons WHERE status IN ('active','reviewed')")
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

  const problemTexts = getExistingProblemTexts(db);
  for (const row of problemTexts) {
    if (jaccardSimilarity(record.problem, row.problem) >= 0.5) {
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
    problem: record.problem,
    solution: record.solution,
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
      id, slug, status, type, summary, problem, solution,
      toolNames, commandPatterns, pathPatterns,
      priority, confidence, tags, source,
      sourceSessionIds, occurrenceCount, sessionCount, projectCount,
      contentHash, createdAt, updatedAt, reviewedAt, archivedAt, archiveReason
    ) VALUES (
      :id, :slug, :status, :type, :summary, :problem, :solution,
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
 * Patchable fields: summary, problem, solution, type,
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
          'problem',
          'solution',
          'type',
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
 * Patchable fields: summary, problem, solution, type,
 * commandPatterns, pathPatterns, priority, confidence, tags
 *
 * @param {DatabaseSync} db
 * @param {string} id
 * @param {object} patch
 * @returns {{ id: string, slug: string } | null}  null if ID not found
 */
export function updateRecord(db, id, patch) {
  const PATCHABLE = [
    'summary',
    'problem',
    'solution',
    'type',
    'scope',
    'toolNames',
    'commandPatterns',
    'commandMatchTarget',
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
 * Fetch candidate records with confidence below threshold.
 * @param {DatabaseSync} db
 * @param {number} maxConfidence
 * @returns {object[]}
 */
export function getCandidatesBelowConfidence(db, maxConfidence) {
  return db
    .prepare(
      `SELECT id, slug, confidence FROM lessons
       WHERE status='candidate' AND confidence < ?
       ORDER BY confidence DESC`
    )
    .all(maxConfidence)
    .map(r => Object.assign({}, r));
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
 * @param {{ problem: string, solution: string, commandPatterns?: string[] }} record
 * @returns {string}
 */
export function computeContentHash(record) {
  const patterns = record.commandPatterns ?? [];
  const data = `${record.problem}|${record.solution}|${JSON.stringify(patterns)}`;
  return 'sha256:' + createHash('sha256').update(data).digest('hex');
}

// ─── Review Sessions ─────────────────────────────────────────────────

/**
 * Persist a review session record to the DB.
 * @param {DatabaseSync} db
 * @param {{ id: string, createdAt: string, promoted: string[], archived: {id: string, reason: string}[], patches?: object }} session
 */
export function insertReviewSession(db, session) {
  db.prepare(
    `INSERT OR IGNORE INTO review_sessions (id, createdAt, promoted, archived, patches)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    session.id,
    session.createdAt,
    JSON.stringify(session.promoted ?? []),
    JSON.stringify(session.archived ?? []),
    JSON.stringify(session.patches ?? {})
  );
}

/**
 * Fetch all review sessions, newest first.
 * @param {DatabaseSync} db
 * @returns {object[]}
 */
export function getReviewSessions(db) {
  return db
    .prepare('SELECT * FROM review_sessions ORDER BY createdAt DESC')
    .all()
    .map(r => ({
      ...r,
      promoted: JSON.parse(/** @type {string} */ (r.promoted)),
      archived: JSON.parse(/** @type {string} */ (r.archived)),
      patches: JSON.parse(/** @type {string} */ (r.patches)),
    }));
}

/**
 * Fetch a single review session by ID.
 * @param {DatabaseSync} db
 * @param {string} id
 * @returns {object | null}
 */
export function getReviewSession(db, id) {
  const r = db.prepare('SELECT * FROM review_sessions WHERE id = ?').get(id);
  if (!r) return null;
  return {
    ...r,
    promoted: JSON.parse(/** @type {string} */ (r.promoted)),
    archived: JSON.parse(/** @type {string} */ (r.archived)),
    patches: JSON.parse(/** @type {string} */ (r.patches)),
  };
}

// ─── Vector / Embedding (sqlite-vec) ─────────────────────────────────

/**
 * Load the sqlite-vec extension and ensure the vec_lessons virtual table exists.
 *
 * Must be called on a db opened with `allowExtension: true`.
 * Safe to call multiple times (CREATE VIRTUAL TABLE IF NOT EXISTS).
 *
 * @param {DatabaseSync} db
 */
export function loadVecExtension(db) {
  const { getLoadablePath } = _require('sqlite-vec');
  db.loadExtension(getLoadablePath());
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_lessons USING vec0(embedding float[768])`);
}

/**
 * Store a lesson's embedding in the vec_lessons virtual table and in lessons.embedding.
 *
 * The lesson_vec_map table bridges the TEXT lesson_id to the INTEGER rowid
 * that vec0 requires.
 *
 * @param {DatabaseSync} db
 * @param {string} lessonId
 * @param {number[]} floatArray - L2-normalized 768-dim vector
 */
export function upsertEmbedding(db, lessonId, floatArray) {
  const blob = Buffer.from(Float32Array.from(floatArray).buffer);
  const embJson = JSON.stringify(floatArray);

  db.prepare(`UPDATE lessons SET embedding = ? WHERE id = ?`).run(blob, lessonId);

  const existing = db
    .prepare(`SELECT vec_rowid FROM lesson_vec_map WHERE lesson_id = ?`)
    .get(lessonId);
  if (existing) {
    // vec0 requires BigInt for explicit rowid — plain Number is rejected
    db.prepare(`DELETE FROM vec_lessons WHERE rowid = ?`).run(
      BigInt(/** @type {number} */ (existing.vec_rowid))
    );
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO vec_lessons(embedding) VALUES (?)`)
      .run(embJson);
    db.prepare(`UPDATE lesson_vec_map SET vec_rowid = ? WHERE lesson_id = ?`).run(
      Number(lastInsertRowid),
      lessonId
    );
  } else {
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO vec_lessons(embedding) VALUES (?)`)
      .run(embJson);
    db.prepare(`INSERT INTO lesson_vec_map(lesson_id, vec_rowid) VALUES (?, ?)`).run(
      lessonId,
      Number(lastInsertRowid)
    );
  }
}

/**
 * ANN search: return the nearest active lessons to the given query embedding.
 *
 * @param {DatabaseSync} db
 * @param {number[]} floatArray - L2-normalized 768-dim query vector
 * @param {number} [limit]
 * @returns {{ lessonId: string, distance: number }[]}
 */
export function searchNearestLessons(db, floatArray, limit = 5) {
  const rows = db
    .prepare(
      `SELECT rowid, distance FROM vec_lessons WHERE embedding MATCH ? ORDER BY distance LIMIT ?`
    )
    .all(JSON.stringify(floatArray), limit);

  if (rows.length === 0) return [];

  const placeholders = rows.map(() => '?').join(',');
  const rowids = rows.map(r => Number(r.rowid));
  const mappings = db
    .prepare(`SELECT lesson_id, vec_rowid FROM lesson_vec_map WHERE vec_rowid IN (${placeholders})`)
    .all(...rowids);

  const rowidToId = new Map(mappings.map(m => [Number(m.vec_rowid), m.lesson_id]));
  return /** @type {{ lessonId: string, distance: number }[]} */ (
    rows
      .map(r => ({ lessonId: rowidToId.get(Number(r.rowid)) ?? null, distance: r.distance }))
      .filter(r => r.lessonId !== null)
  );
}

/**
 * Get active lessons that have not yet been embedded.
 *
 * @param {DatabaseSync} db
 * @returns {{ id: string, problem: string, solution: string }[]}
 */
export function getActiveRecordsNeedingEmbedding(db) {
  return /** @type {{ id: string, problem: string, solution: string }[]} */ (
    db
      .prepare(
        `SELECT id, problem, solution FROM lessons WHERE status='active' AND embedding IS NULL`
      )
      .all()
      .map(r => Object.assign({}, r))
  );
}

// ─── Pending semantic windows ─────────────────────────────────────────

/**
 * @typedef {{ id: string, windowText: string, nearestDistance: number, nearestLessonId: string|null, projectId: string|null, filePath: string|null, windowIndex: number|null, createdAt: string, processedAt: string|null }} PendingWindow
 */

/**
 * Insert a pending semantic window for interactive review.
 *
 * @param {DatabaseSync} db
 * @param {{ id: string, windowText: string, nearestDistance: number, nearestLessonId?: string|null, seedType?: string, projectId?: string|null, filePath?: string|null, windowIndex?: number|null }} record
 */
export function insertPendingWindow(db, record) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO pending_semantic_windows
       (id, windowText, nearestDistance, nearestLessonId, seedType, projectId, filePath, windowIndex, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.windowText,
    record.nearestDistance,
    record.nearestLessonId ?? null,
    record.seedType ?? 'lesson',
    record.projectId ?? null,
    record.filePath ?? null,
    record.windowIndex ?? null,
    now
  );
}

/**
 * Return all unprocessed pending windows, oldest first.
 *
 * @param {DatabaseSync} db
 * @returns {object[]}
 */
export function getPendingWindows(db) {
  return db
    .prepare(
      `SELECT * FROM pending_semantic_windows WHERE processedAt IS NULL ORDER BY createdAt ASC`
    )
    .all()
    .map(r => Object.assign({}, r));
}

/**
 * Mark one or more pending windows as processed.
 *
 * @param {DatabaseSync} db
 * @param {string[]} ids
 */
export function archivePendingWindows(db, ids) {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE pending_semantic_windows SET processedAt=? WHERE id IN (${placeholders})`).run(
    now,
    ...ids
  );
}
