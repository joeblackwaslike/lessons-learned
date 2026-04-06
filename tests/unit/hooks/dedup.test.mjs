import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadSeenSet, claimLesson, persistSeenState } from '../../../hooks/lib/dedup.mjs';

// Each test gets an isolated session ID so temp files never collide
function freshSession() {
  return `test-session-${randomUUID()}`;
}

// Save/restore LESSONS_SEEN across tests
let savedSeen;
beforeEach(() => {
  savedSeen = process.env.LESSONS_SEEN;
  delete process.env.LESSONS_SEEN;
});
afterEach(() => {
  if (savedSeen === undefined) {
    delete process.env.LESSONS_SEEN;
  } else {
    process.env.LESSONS_SEEN = savedSeen;
  }
});

describe('loadSeenSet', () => {
  it('returns an empty set for a fresh session', () => {
    const seen = loadSeenSet(freshSession());
    assert.equal(seen.size, 0);
  });

  it('reads slugs from LESSONS_SEEN env var', () => {
    process.env.LESSONS_SEEN = 'slug-a,slug-b';
    const seen = loadSeenSet(freshSession());
    assert.ok(seen.has('slug-a'));
    assert.ok(seen.has('slug-b'));
  });

  it('ignores whitespace entries in LESSONS_SEEN', () => {
    process.env.LESSONS_SEEN = 'slug-a, ,slug-b';
    const seen = loadSeenSet(freshSession());
    assert.equal(seen.size, 2);
  });

  it('merges env var + session file after persist', () => {
    const sid = freshSession();
    process.env.LESSONS_SEEN = 'from-env';
    persistSeenState(sid, new Set(['from-file']));
    const seen = loadSeenSet(sid);
    assert.ok(seen.has('from-env'));
    assert.ok(seen.has('from-file'));
  });

  it('includes claimed slugs from the claim directory', () => {
    const sid = freshSession();
    claimLesson(sid, 'claimed-slug');
    const seen = loadSeenSet(sid);
    assert.ok(seen.has('claimed-slug'));
  });
});

describe('claimLesson', () => {
  it('returns true on first claim', () => {
    const sid = freshSession();
    assert.equal(claimLesson(sid, 'slug-x'), true);
  });

  it('returns false on second claim of same slug', () => {
    const sid = freshSession();
    claimLesson(sid, 'slug-y');
    assert.equal(claimLesson(sid, 'slug-y'), false);
  });

  it('allows claiming different slugs independently', () => {
    const sid = freshSession();
    assert.equal(claimLesson(sid, 'slug-a'), true);
    assert.equal(claimLesson(sid, 'slug-b'), true);
  });

  it('different sessions do not share claims', () => {
    const sid1 = freshSession();
    const sid2 = freshSession();
    claimLesson(sid1, 'shared-slug');
    assert.equal(claimLesson(sid2, 'shared-slug'), true);
  });
});

describe('persistSeenState', () => {
  it('returns a comma-separated slug string', () => {
    const sid = freshSession();
    const result = persistSeenState(sid, new Set(['a', 'b', 'c']));
    const parts = result.split(',').sort();
    assert.deepEqual(parts, ['a', 'b', 'c']);
  });

  it('persists state so subsequent loadSeenSet includes it', () => {
    const sid = freshSession();
    persistSeenState(sid, new Set(['lesson-1', 'lesson-2']));
    const seen = loadSeenSet(sid);
    assert.ok(seen.has('lesson-1'));
    assert.ok(seen.has('lesson-2'));
  });

  it('returns empty string for empty set', () => {
    const sid = freshSession();
    assert.equal(persistSeenState(sid, new Set()), '');
  });
});
