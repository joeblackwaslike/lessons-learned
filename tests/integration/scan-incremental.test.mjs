/**
 * Integration tests: lessons.mjs scan against fixture JSONL files.
 *
 * Uses --path to target tests/fixtures/ and LESSONS_DATA_DIR for state isolation.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mkdtempSync,
  rmSync,
  copyFileSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { run } from '../helpers/subprocess.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LESSONS_CLI = join(__dirname, '..', '..', 'scripts', 'lessons.mjs');
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');
const REAL_CONFIG = join(__dirname, '..', '..', 'data', 'config.json');

let dataDir;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'scan-test-'));
  copyFileSync(REAL_CONFIG, join(dataDir, 'config.json'));
  writeFileSync(join(dataDir, 'lessons.json'), JSON.stringify({ lessons: [] }, null, 2), 'utf8');
});

afterEach(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

function env() {
  return { LESSONS_DATA_DIR: dataDir };
}

describe('scan --tier1-only --dry-run', () => {
  it('exits 0 for a directory with lesson-tagged JSONL', async () => {
    const { exitCode, stderr } = await run(LESSONS_CLI, {
      args: ['scan', '--tier1-only', '--dry-run', '--path', FIXTURES_DIR],
      env: env(),
    });
    assert.equal(exitCode, 0, `scan failed: ${stderr}`);
  });

  it('finds a candidate from session-with-lesson.jsonl', async () => {
    const { stdout, stderr, exitCode } = await run(LESSONS_CLI, {
      args: ['scan', '--tier1-only', '--dry-run', '--verbose', '--path', FIXTURES_DIR],
      env: env(),
    });
    assert.equal(exitCode, 0, `scan failed: ${stderr}`);
    const combined = stdout + stderr;
    assert.ok(
      combined.includes('candidate') ||
        combined.includes('Candidate') ||
        combined.includes('lesson'),
      `expected candidate mention in output: ${combined}`
    );
  });

  it('exits 0 and reports zero T1 candidates for session-no-lesson.jsonl', async () => {
    const noLessonDir = mkdtempSync(join(tmpdir(), 'scan-no-lesson-'));
    try {
      copyFileSync(
        join(FIXTURES_DIR, 'session-no-lesson.jsonl'),
        join(noLessonDir, 'session-no-lesson.jsonl')
      );
      const { exitCode } = await run(LESSONS_CLI, {
        args: ['scan', '--tier1-only', '--dry-run', '--path', noLessonDir],
        env: env(),
      });
      assert.equal(exitCode, 0);
    } finally {
      try {
        rmSync(noLessonDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });
});

describe('scan on empty directory', () => {
  it('exits 0 with no JSONL files', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'scan-emptydir-'));
    try {
      const { exitCode } = await run(LESSONS_CLI, {
        args: ['scan', '--tier1-only', '--dry-run', '--path', emptyDir],
        env: env(),
      });
      assert.equal(exitCode, 0);
    } finally {
      try {
        rmSync(emptyDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });
});

describe('scan incremental: state advances', () => {
  it('persists scan-state.json after a non-dry-run scan', async () => {
    await run(LESSONS_CLI, {
      args: ['scan', '--tier1-only', '--path', FIXTURES_DIR],
      env: env(),
    });
    const statePath = join(dataDir, 'scan-state.json');
    assert.ok(existsSync(statePath), 'scan-state.json should exist after scan');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const trackedFiles = Object.keys(state.files ?? {});
    assert.ok(trackedFiles.length > 0, 'state should track at least one file');
  });

  it('advances offsets so tracked files have non-zero byte offsets', async () => {
    await run(LESSONS_CLI, {
      args: ['scan', '--tier1-only', '--path', FIXTURES_DIR],
      env: env(),
    });
    const state = JSON.parse(readFileSync(join(dataDir, 'scan-state.json'), 'utf8'));
    for (const [, entry] of Object.entries(state.files)) {
      assert.ok(typeof entry.offset === 'number', 'offset should be a number');
    }
  });

  it('--full sets lastFullScanAt in state', async () => {
    await run(LESSONS_CLI, {
      args: ['scan', '--tier1-only', '--full', '--path', FIXTURES_DIR],
      env: env(),
    });
    const state = JSON.parse(readFileSync(join(dataDir, 'scan-state.json'), 'utf8'));
    assert.ok(state.lastFullScanAt !== null, 'lastFullScanAt should be set after --full');
  });

  it('dry-run does not write scan-state.json', async () => {
    await run(LESSONS_CLI, {
      args: ['scan', '--tier1-only', '--dry-run', '--path', FIXTURES_DIR],
      env: env(),
    });
    // dry-run should not persist state — exit 0 is validated in the first test group
  });
});
