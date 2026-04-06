#!/usr/bin/env node

/**
 * migrate-db — One-time migration from JSON files to SQLite.
 *
 * Reads:
 *   data/lessons.json            → status='active' rows (or 'reviewed' if needsReview)
 *   data/cross-project-candidates.json → status='candidate' rows
 *
 * After a successful migration:
 *   data/lessons.db              ← new source of truth
 *   data/lessons.json.bak        ← original renamed
 *   data/cross-project-candidates.json.bak ← original renamed
 *
 * Usage:
 *   node scripts/migrate-db.mjs [--dry-run] [--force]
 *
 *   --dry-run   Print what would be inserted without writing the DB or renaming files
 *   --force     Overwrite an existing lessons.db (dangerous — use only if re-migrating)
 */

import { readFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateUlid, computeContentHash } from './db.mjs';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..');
const DATA_DIR = process.env.LESSONS_DATA_DIR ?? join(PLUGIN_ROOT, 'data');

const LESSONS_PATH = join(DATA_DIR, 'lessons.json');
const CANDIDATES_PATH = join(DATA_DIR, 'cross-project-candidates.json');
const DB_PATH = process.env.LESSONS_DB_PATH ?? join(DATA_DIR, 'lessons.db');

// ─── Field mapping helpers ────────────────────────────────────────────

function deriveInjectOn(lesson) {
  const sessionStart = lesson.triggers?.sessionStart === true;
  const hasToolNames = (lesson.triggers?.toolNames ?? []).length > 0;
  if (sessionStart && !hasToolNames) return ['SessionStart'];
  if (sessionStart && hasToolNames) return ['PreToolUse', 'SessionStart'];
  return ['PreToolUse'];
}

function mapActiveLesson(lesson) {
  return {
    id: lesson.id,
    slug: lesson.slug,
    status: lesson.needsReview ? 'reviewed' : 'active',
    summary: lesson.summary,
    mistake: lesson.mistake,
    remediation: lesson.remediation,
    injection: lesson.injection ?? null,
    injectOn: deriveInjectOn(lesson),
    toolNames: lesson.triggers?.toolNames ?? [],
    commandPatterns: lesson.triggers?.commandPatterns ?? [],
    pathPatterns: lesson.triggers?.pathPatterns ?? [],
    block: lesson.block ?? false,
    blockReason: lesson.blockReason ?? null,
    priority: lesson.priority ?? 5,
    confidence: lesson.confidence ?? 0.8,
    tags: lesson.tags ?? [],
    source: 'manual',
    sourceSessionIds: lesson.sourceSessionIds ?? [],
    occurrenceCount: lesson.occurrenceCount ?? 0,
    sessionCount: 0,
    projectCount: 0,
    contentHash: lesson.contentHash,
    createdAt: lesson.createdAt,
    updatedAt: lesson.updatedAt,
    reviewedAt: null,
    archivedAt: null,
    archiveReason: null,
  };
}

function deriveCandidateSlug(candidate) {
  const text = (candidate.mistake ?? '').split('\n')[0].slice(0, 40);
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/-$/, '');
  const suffix = generateUlid().slice(-4).toLowerCase();
  return `${base || 'candidate'}-${suffix}`;
}

function deriveCandidateCommandPatterns(trigger) {
  if (!trigger) return [];
  const firstWord = trigger.trim().match(/^[a-zA-Z0-9_-]+/)?.[0] ?? '';
  if (!firstWord) return [];
  return [`\\b${firstWord}\\b`];
}

function mapCandidate(candidate) {
  const commandPatterns = deriveCandidateCommandPatterns(candidate.trigger);
  const contentHash = computeContentHash({
    mistake: candidate.mistake,
    remediation: candidate.remediation,
    commandPatterns,
  });
  const now = new Date().toISOString();
  return {
    id: generateUlid(),
    slug: deriveCandidateSlug(candidate),
    status: 'candidate',
    summary: (candidate.mistake ?? '').split('\n')[0].slice(0, 80) || 'Candidate',
    mistake: candidate.mistake,
    remediation: candidate.remediation,
    injection: null,
    injectOn: ['PreToolUse'],
    toolNames: candidate.tool ? [candidate.tool] : [],
    commandPatterns,
    pathPatterns: [],
    block: false,
    blockReason: null,
    priority: candidate.priority ?? 5,
    confidence: candidate.confidence ?? 0.4,
    tags: candidate.tags ?? [],
    source: 'heuristic',
    sourceSessionIds: (candidate.sourceSessionIds ?? []).slice(0, 5),
    occurrenceCount: candidate.occurrenceCount ?? 1,
    sessionCount: candidate.sessionCount ?? 1,
    projectCount: candidate.projectCount ?? 1,
    contentHash,
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
    archivedAt: null,
    archiveReason: null,
  };
}

// ─── Direct INSERT (bypass dedup — migration is authoritative) ───────

const INSERT_SQL = `
  INSERT INTO lessons (
    id, slug, status, summary, mistake, remediation, injection,
    injectOn, toolNames, commandPatterns, pathPatterns,
    block, blockReason, priority, confidence, tags, source,
    sourceSessionIds, occurrenceCount, sessionCount, projectCount,
    contentHash, createdAt, updatedAt, reviewedAt, archivedAt, archiveReason
  ) VALUES (
    :id, :slug, :status, :summary, :mistake, :remediation, :injection,
    :injectOn, :toolNames, :commandPatterns, :pathPatterns,
    :block, :blockReason, :priority, :confidence, :tags, :source,
    :sourceSessionIds, :occurrenceCount, :sessionCount, :projectCount,
    :contentHash, :createdAt, :updatedAt, :reviewedAt, :archivedAt, :archiveReason
  )
`;

function serializeForInsert(record) {
  const out = { ...record };
  for (const col of [
    'injectOn',
    'toolNames',
    'commandPatterns',
    'pathPatterns',
    'tags',
    'sourceSessionIds',
  ]) {
    if (Array.isArray(out[col])) out[col] = JSON.stringify(out[col]);
  }
  out.block = out.block ? 1 : 0;
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  // Guards
  if (existsSync(DB_PATH) && !force) {
    console.error(`ERROR: ${DB_PATH} already exists.`);
    console.error('To re-migrate, remove the DB first or use --force.');
    process.exit(1);
  }

  // Load source files
  if (!existsSync(LESSONS_PATH)) {
    console.error(`ERROR: ${LESSONS_PATH} not found.`);
    process.exit(1);
  }

  const { lessons } = JSON.parse(readFileSync(LESSONS_PATH, 'utf8'));
  console.log(`Loaded ${lessons.length} lessons from lessons.json`);

  let candidates = [];
  if (existsSync(CANDIDATES_PATH)) {
    const parsed = JSON.parse(readFileSync(CANDIDATES_PATH, 'utf8'));
    candidates = parsed.candidates ?? [];
    console.log(`Loaded ${candidates.length} candidates from cross-project-candidates.json`);
  } else {
    console.log('cross-project-candidates.json not found — skipping candidates');
  }

  // Map records
  const lessonRows = lessons.map(mapActiveLesson);
  const existingHashes = new Set(lessonRows.map(r => r.contentHash));
  const candidateRows = candidates.map(mapCandidate).filter(r => {
    if (existingHashes.has(r.contentHash)) {
      console.log(`  Skipping candidate (hash collision with existing lesson): ${r.slug}`);
      return false;
    }
    return true;
  });

  console.log(`\nReady to migrate:`);
  console.log(`  ${lessonRows.filter(r => r.status === 'active').length} active lessons`);
  console.log(
    `  ${lessonRows.filter(r => r.status === 'reviewed').length} reviewed (needsReview) lessons`
  );
  console.log(
    `  ${candidateRows.length} candidates (${candidates.length - candidateRows.length} skipped as hash-collision)`
  );

  if (dryRun) {
    console.log('\n[DRY RUN] No files written.');
    return;
  }

  // Write DB
  const db = new DatabaseSync(DB_PATH);
  db.exec(`PRAGMA journal_mode=WAL;`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'candidate'
             CHECK(status IN ('candidate','reviewed','active','archived')),
      summary TEXT NOT NULL, mistake TEXT NOT NULL, remediation TEXT NOT NULL,
      injection TEXT, injectOn TEXT NOT NULL DEFAULT '[]',
      toolNames TEXT NOT NULL DEFAULT '[]', commandPatterns TEXT NOT NULL DEFAULT '[]',
      pathPatterns TEXT NOT NULL DEFAULT '[]', block INTEGER NOT NULL DEFAULT 0,
      blockReason TEXT, priority INTEGER NOT NULL DEFAULT 5, confidence REAL NOT NULL DEFAULT 0.8,
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'heuristic'
             CHECK(source IN ('structured','heuristic','manual')),
      sourceSessionIds TEXT NOT NULL DEFAULT '[]',
      occurrenceCount INTEGER NOT NULL DEFAULT 0, sessionCount INTEGER NOT NULL DEFAULT 0,
      projectCount INTEGER NOT NULL DEFAULT 0, contentHash TEXT NOT NULL,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      reviewedAt TEXT, archivedAt TEXT, archiveReason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_lessons_status ON lessons(status);
    CREATE INDEX IF NOT EXISTS idx_lessons_priority ON lessons(priority DESC);
    CREATE INDEX IF NOT EXISTS idx_lessons_status_priority ON lessons(status, priority DESC);
    CREATE INDEX IF NOT EXISTS idx_lessons_hash ON lessons(contentHash);
  `);

  const stmt = db.prepare(INSERT_SQL);
  db.exec('BEGIN');
  try {
    for (const row of lessonRows) {
      stmt.run(serializeForInsert(row));
    }
    for (const row of candidateRows) {
      stmt.run(serializeForInsert(row));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    console.error('Migration failed — rolled back:', err.message);
    process.exit(1);
  }
  db.close();

  // Rename originals to .bak
  renameSync(LESSONS_PATH, LESSONS_PATH + '.bak');
  console.log(`  Renamed: lessons.json → lessons.json.bak`);

  if (existsSync(CANDIDATES_PATH)) {
    renameSync(CANDIDATES_PATH, CANDIDATES_PATH + '.bak');
    console.log(`  Renamed: cross-project-candidates.json → cross-project-candidates.json.bak`);
  }

  console.log(`\nMigration complete.`);
  console.log(`  DB: ${DB_PATH}`);
  console.log(`  lessons.db is now the source of truth.`);
  console.log(`  Run 'node scripts/lessons.mjs build' to rebuild the manifest from the DB.`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
