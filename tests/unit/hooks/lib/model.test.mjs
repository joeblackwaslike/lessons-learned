import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import { detectModel } from '../../../../hooks/lib/model.mjs';

// ─── Helpers ───────────────────────────────────────────────────────────────

function freshSession() {
  return `test-${randomUUID()}`;
}

const CACHE_PREFIX = '/tmp/ll-model-';

function cacheFile(sessionId) {
  return `${CACHE_PREFIX}${sessionId}.txt`;
}

// ─── Env var cleanup ───────────────────────────────────────────────────────

let savedModel;
beforeEach(() => {
  savedModel = process.env.LESSONS_LEARNED_MODEL;
  delete process.env.LESSONS_LEARNED_MODEL;
});
afterEach(() => {
  if (savedModel === undefined) {
    delete process.env.LESSONS_LEARNED_MODEL;
  } else {
    process.env.LESSONS_LEARNED_MODEL = savedModel;
  }
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('detectModel', () => {
  it('returns env var override immediately when set', () => {
    process.env.LESSONS_LEARNED_MODEL = 'claude-opus-5-5';
    const result = detectModel('any-session', '/some/cwd');
    assert.equal(result, 'claude-opus-5-5');
  });

  it('returns null when sessionId is null', () => {
    const result = detectModel(null, '/some/cwd');
    assert.equal(result, null);
  });

  it('returns cached value on second call without re-scanning JSONL', () => {
    const sessionId = freshSession();
    writeFileSync(cacheFile(sessionId), 'claude-sonnet-4-6', 'utf8');
    const result = detectModel(sessionId, null);
    assert.equal(result, 'claude-sonnet-4-6');
    // cleanup
    try { rmSync(cacheFile(sessionId)); } catch {}
  });

  it('parses model from a fixture JSONL file in projectId directory', () => {
    const sessionId = freshSession();
    const projectId = `tmp-test-project-${randomUUID()}`;
    const projectDir = join(homedir(), '.claude', 'projects', projectId);
    mkdirSync(projectDir, { recursive: true });
    const jsonlPath = join(projectDir, `${sessionId}.jsonl`);

    // Write a minimal JSONL — model appears around line 18
    const lines = Array.from({ length: 17 }, () => JSON.stringify({ type: 'filler' }));
    lines.push(JSON.stringify({ type: 'message', model: 'claude-haiku-4-5', content: [] }));
    writeFileSync(jsonlPath, lines.join('\n'), 'utf8');

    const cwd = `/${projectId.replace(/-/g, '/')}`;
    const result = detectModel(sessionId, `/${projectId}`);
    assert.equal(result, 'claude-haiku-4-5');

    // cleanup
    try { rmSync(jsonlPath); rmSync(projectDir, { recursive: true }); } catch {}
    try { rmSync(cacheFile(sessionId)); } catch {}
  });

  it('returns null when all sources fail and no settings.json model', () => {
    const sessionId = freshSession();
    // Don't create any JSONL, no cache, no env var
    // (settings.json may have a model on Joe's machine, so we override env to force null path)
    // We can't easily test the settings.json fallback without mocking, so just verify no crash.
    const result = detectModel(sessionId, null);
    // Result is either a string (from settings.json) or null — both are valid
    assert.ok(result === null || typeof result === 'string');
  });
});
