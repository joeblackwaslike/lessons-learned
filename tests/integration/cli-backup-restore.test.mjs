/**
 * Integration tests: `lessons backup` / `lessons restore --db` subcommands.
 *
 * data/lessons.db is intentionally untracked in git — these subcommands are its only
 * recovery path. Uses LESSONS_DATA_DIR + LESSONS_BACKUP_DIR to isolate both the store
 * and the backup destination from the real machine state.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readdirSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { run } from '../helpers/subprocess.mjs';
import { createTmpStore } from '../helpers/tmpstore.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LESSONS_CLI = join(__dirname, '..', '..', 'scripts', 'lessons.mjs');

let store;
let backupDir;

beforeEach(() => {
  store = createTmpStore();
  backupDir = mkdtempSync(join(tmpdir(), 'lessons-backups-'));
});
afterEach(() => {
  store.cleanup();
  rmSync(backupDir, { recursive: true, force: true });
});

function env(overrides = {}) {
  return { LESSONS_DATA_DIR: store.dir, LESSONS_BACKUP_DIR: backupDir, ...overrides };
}

function backupFiles() {
  return readdirSync(backupDir).filter(f => /^lessons-.*\.db$/.test(f));
}

// ─── lessons backup ─────────────────────────────────────────────────────────

describe('lessons backup', () => {
  it('creates a snapshot file in LESSONS_BACKUP_DIR', async () => {
    const { exitCode, stdout } = await run(LESSONS_CLI, { args: ['backup'], env: env() });
    assert.equal(exitCode, 0);
    assert.match(stdout, /Backed up/);
    assert.equal(backupFiles().length, 1);
  });

  it('produces a valid, independently-openable SQLite file', async () => {
    await run(LESSONS_CLI, { args: ['backup'], env: env() });
    const { DatabaseSync } = await import('node:sqlite');
    const snapshotPath = join(backupDir, backupFiles()[0]);
    const db = new DatabaseSync(snapshotPath);
    const row = db.prepare('SELECT count(*) AS c FROM lessons').get();
    db.close();
    assert.ok(Number(row.c) > 0, 'snapshot should contain the seeded fixture lessons');
  });

  it('prunes old backups beyond LESSONS_BACKUP_KEEP', async () => {
    for (let i = 0; i < 3; i++) {
      await run(LESSONS_CLI, { args: ['backup'], env: env({ LESSONS_BACKUP_KEEP: '2' }) });
      // ensure distinct timestamps in filenames
      await new Promise(r => setTimeout(r, 1100));
    }
    assert.equal(backupFiles().length, 2);
  });

  it('errors when no DB exists yet', async () => {
    unlinkSync(store.dbPath);
    const { exitCode, stderr } = await run(LESSONS_CLI, { args: ['backup'], env: env() });
    assert.notEqual(exitCode, 0);
    assert.match(stderr, /no DB found/);
  });

  it('--list reports existing backups without creating a new one', async () => {
    await run(LESSONS_CLI, { args: ['backup'], env: env() });
    const before = backupFiles().length;
    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['backup', '--list'],
      env: env(),
    });
    assert.equal(exitCode, 0);
    assert.match(stdout, /lessons-.*\.db/);
    assert.equal(backupFiles().length, before, '--list must not create a snapshot');
  });

  it('--list reports none when the backup dir is empty', async () => {
    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['backup', '--list'],
      env: env(),
    });
    assert.equal(exitCode, 0);
    assert.match(stdout, /No backups found/);
  });
});

// ─── lessons restore --db ───────────────────────────────────────────────────

describe('lessons restore --db', () => {
  it('refuses to overwrite a healthy DB without --force', async () => {
    await run(LESSONS_CLI, { args: ['backup'], env: env() });
    const { exitCode, stderr } = await run(LESSONS_CLI, {
      args: ['restore', '--db'],
      env: env(),
    });
    assert.notEqual(exitCode, 0);
    assert.match(stderr, /looks healthy/);
    assert.match(stderr, /--force/);
  });

  it('restores from the newest backup when the DB is missing', async () => {
    await run(LESSONS_CLI, { args: ['backup'], env: env() });
    unlinkSync(store.dbPath);
    assert.ok(!existsSync(store.dbPath));

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['restore', '--db'],
      env: env(),
    });
    assert.equal(exitCode, 0, stdout);
    assert.ok(existsSync(store.dbPath));
  });

  it('overwrites a healthy DB when --force is passed', async () => {
    await run(LESSONS_CLI, { args: ['backup'], env: env() });
    const { exitCode } = await run(LESSONS_CLI, {
      args: ['restore', '--db', '--force'],
      env: env(),
    });
    assert.equal(exitCode, 0);
  });

  it('restores from an explicit --file path', async () => {
    await run(LESSONS_CLI, { args: ['backup'], env: env() });
    const explicitPath = join(backupDir, backupFiles()[0]);
    unlinkSync(store.dbPath);

    const { exitCode, stdout } = await run(LESSONS_CLI, {
      args: ['restore', '--db', '--file', explicitPath],
      env: env(),
    });
    assert.equal(exitCode, 0, stdout);
    assert.ok(existsSync(store.dbPath));
  });

  it('errors on an explicit --file path that does not exist', async () => {
    const { exitCode, stderr } = await run(LESSONS_CLI, {
      args: ['restore', '--db', '--file', join(backupDir, 'nope.db')],
      env: env(),
    });
    assert.notEqual(exitCode, 0);
    assert.match(stderr, /not found/);
  });

  it('errors when no backups exist and the DB is missing', async () => {
    unlinkSync(store.dbPath);
    const { exitCode, stderr } = await run(LESSONS_CLI, {
      args: ['restore', '--db'],
      env: env(),
    });
    assert.notEqual(exitCode, 0);
    assert.match(stderr, /no backups found/);
  });

  it('rebuilds the manifest after a successful restore', async () => {
    await run(LESSONS_CLI, { args: ['backup'], env: env() });
    unlinkSync(store.dbPath);
    await run(LESSONS_CLI, { args: ['restore', '--db'], env: env() });
    assert.ok(existsSync(store.manifestPath));
  });
});

// ─── lessons restore --ids (regression: --db must not break lesson restore) ─

describe('lessons restore --ids (unchanged)', () => {
  it('still rejects a non-archived id', async () => {
    const { exitCode, stderr } = await run(LESSONS_CLI, {
      args: ['restore', '--ids', 'nonexistent-id'],
      env: env(),
    });
    assert.notEqual(exitCode, 0);
    assert.match(stderr, /unknown IDs/);
  });
});
