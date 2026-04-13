/**
 * Create an isolated temporary lessons store for CLI integration tests.
 *
 * Creates a temp directory with:
 *   - lessons.db  seeded from tests/fixtures/lessons-store.json
 *   - config.json copied from data/config.json
 *
 * CLI tests set LESSONS_DATA_DIR to this directory so they never touch
 * the real data files. The DB path resolves to <dir>/lessons.db automatically
 * since db.mjs derives DB_PATH from LESSONS_DATA_DIR.
 */

import { mkdtempSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');
const REAL_CONFIG = join(__dirname, '..', '..', 'data', 'config.json');

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'candidate'
         CHECK(status IN ('candidate','reviewed','active','archived')),
  type TEXT NOT NULL DEFAULT 'hint',
  summary TEXT NOT NULL, problem TEXT NOT NULL, solution TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_lessons_hash ON lessons(contentHash);
`;

function deriveInjectOn(lesson) {
  const sessionStart = lesson.triggers?.sessionStart === true;
  const hasToolNames = (lesson.triggers?.toolNames ?? []).length > 0;
  if (sessionStart && !hasToolNames) return ['SessionStart'];
  if (sessionStart && hasToolNames) return ['PreToolUse', 'SessionStart'];
  return ['PreToolUse'];
}

function seedFixtureDb(dbPath) {
  const { lessons } = JSON.parse(readFileSync(join(FIXTURES_DIR, 'lessons-store.json'), 'utf8'));
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO lessons (
      id, slug, status, summary, problem, solution, injection,
      injectOn, toolNames, commandPatterns, pathPatterns, block,
      priority, confidence, tags, source, sourceSessionIds,
      occurrenceCount, sessionCount, projectCount, contentHash,
      createdAt, updatedAt
    ) VALUES (
      :id, :slug, :status, :summary, :problem, :solution, :injection,
      :injectOn, :toolNames, :commandPatterns, :pathPatterns, :block,
      :priority, :confidence, :tags, :source, :sourceSessionIds,
      :occurrenceCount, :sessionCount, :projectCount, :contentHash,
      :createdAt, :updatedAt
    )
  `);
  for (const l of lessons) {
    stmt.run({
      id: l.id,
      slug: l.slug,
      status: l.needsReview ? 'reviewed' : 'active',
      summary: l.summary,
      problem: l.problem,
      solution: l.solution,
      injection: l.injection ?? null,
      injectOn: JSON.stringify(deriveInjectOn(l)),
      toolNames: JSON.stringify(l.triggers?.toolNames ?? []),
      commandPatterns: JSON.stringify(l.triggers?.commandPatterns ?? []),
      pathPatterns: JSON.stringify(l.triggers?.pathPatterns ?? []),
      block: l.block ? 1 : 0,
      priority: l.priority ?? 5,
      confidence: l.confidence ?? 0.8,
      tags: JSON.stringify(l.tags ?? []),
      source: 'manual',
      sourceSessionIds: JSON.stringify(l.sourceSessionIds ?? []),
      occurrenceCount: l.occurrenceCount ?? 0,
      sessionCount: 0,
      projectCount: 0,
      contentHash: l.contentHash,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    });
  }
  db.close();
}

/**
 * @returns {{ dir: string, dbPath: string, lessonsPath: string, manifestPath: string, configPath: string, cleanup: () => void }}
 */
export function createTmpStore() {
  const dir = mkdtempSync(join(tmpdir(), 'lessons-test-'));

  const dbPath = join(dir, 'lessons.db');
  const manifestPath = join(dir, 'lesson-manifest.json');
  const configPath = join(dir, 'config.json');

  seedFixtureDb(dbPath);
  copyFileSync(REAL_CONFIG, configPath);

  return {
    dir,
    dbPath,
    // lessonsPath kept for any tests that reference it directly (will be absent in the dir)
    lessonsPath: join(dir, 'lessons.json'),
    manifestPath,
    configPath,
    cleanup() {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}
