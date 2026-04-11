import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectCandidates } from '../../../core/select.mjs';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeMatch(overrides = {}) {
  return {
    slug: 'test-slug',
    type: 'hint',
    priority: 5,
    message: 'A short lesson text.',
    summary: 'A brief summary.',
    ...overrides,
  };
}

const alwaysClaim = () => true;
const neverClaim = () => false;

// ─── selectCandidates ──────────────────────────────────────────────────────

describe('selectCandidates', () => {
  it('returns empty injected when matches is empty', () => {
    const result = selectCandidates([], new Set(), { claimFn: alwaysClaim });
    assert.deepEqual(result.injected, []);
    assert.deepEqual(result.dropped, []);
  });

  it('injects a single matching lesson', () => {
    const matches = [makeMatch({ slug: 's1', message: 'Lesson text' })];
    const { injected } = selectCandidates(matches, new Set(), { claimFn: alwaysClaim });
    assert.equal(injected.length, 1);
    assert.equal(injected[0].slug, 's1');
    assert.equal(injected[0].text, 'Lesson text');
  });

  it('skips already-seen lessons', () => {
    const matches = [makeMatch({ slug: 's1' })];
    const { injected } = selectCandidates(matches, new Set(['s1']), { claimFn: alwaysClaim });
    assert.deepEqual(injected, []);
  });

  it('drops lesson when claimFn returns false', () => {
    const matches = [makeMatch({ slug: 's1' })];
    const { injected, dropped } = selectCandidates(matches, new Set(), { claimFn: neverClaim });
    assert.deepEqual(injected, []);
    assert.deepEqual(dropped, ['s1']);
  });

  it('respects maxLessons cap', () => {
    const matches = [
      makeMatch({ slug: 's1', message: 'L1' }),
      makeMatch({ slug: 's2', message: 'L2' }),
      makeMatch({ slug: 's3', message: 'L3' }),
      makeMatch({ slug: 's4', message: 'L4' }),
    ];
    const { injected } = selectCandidates(matches, new Set(), {
      maxLessons: 2,
      claimFn: alwaysClaim,
    });
    assert.equal(injected.length, 2);
    assert.deepEqual(
      injected.map(l => l.slug),
      ['s1', 's2']
    );
  });

  it('always injects the first lesson regardless of budget', () => {
    const bigText = 'x'.repeat(10_000);
    const matches = [makeMatch({ slug: 's1', message: bigText })];
    const { injected } = selectCandidates(matches, new Set(), {
      budgetBytes: 1,
      claimFn: alwaysClaim,
    });
    assert.equal(injected.length, 1);
    assert.equal(injected[0].text, bigText);
  });

  it('drops second lesson when it exceeds remaining budget and summary also too large', () => {
    const bigText = 'x'.repeat(5_000);
    const bigSummary = 'y'.repeat(5_000);
    const matches = [
      makeMatch({ slug: 's1', message: 'Short L1' }),
      makeMatch({ slug: 's2', message: bigText, summary: bigSummary }),
    ];
    const { injected, dropped } = selectCandidates(matches, new Set(), {
      budgetBytes: 100,
      claimFn: alwaysClaim,
    });
    assert.equal(injected.length, 1);
    assert.equal(injected[0].slug, 's1');
    assert.deepEqual(dropped, ['s2']);
  });

  it('falls back to summary when full injection exceeds remaining budget', () => {
    const matches = [
      makeMatch({ slug: 's1', message: 'Short lesson one' }),
      makeMatch({ slug: 's2', message: 'x'.repeat(500), summary: 'Brief summary' }),
    ];
    const { injected } = selectCandidates(matches, new Set(), {
      budgetBytes: 200,
      claimFn: alwaysClaim,
    });
    assert.equal(injected.length, 2);
    assert.equal(injected[1].text, '**Lesson**: Brief summary');
  });

  it('adds injected slugs to the returned seen set', () => {
    const matches = [makeMatch({ slug: 's1' })];
    const { seen } = selectCandidates(matches, new Set(), { claimFn: alwaysClaim });
    assert.ok(seen.has('s1'));
  });

  it('preserves pre-existing entries in the seen set', () => {
    const existing = new Set(['old-slug']);
    const matches = [makeMatch({ slug: 's1' })];
    const { seen } = selectCandidates(matches, existing, { claimFn: alwaysClaim });
    assert.ok(seen.has('old-slug'));
    assert.ok(seen.has('s1'));
  });

  it('does not mutate the input seenSet', () => {
    const seenSet = new Set(['old']);
    const matches = [makeMatch({ slug: 's1' })];
    selectCandidates(matches, seenSet, { claimFn: alwaysClaim });
    assert.ok(!seenSet.has('s1'));
  });

  it('processes matches in priority order (caller responsibility)', () => {
    const matches = [
      makeMatch({ slug: 'high', message: 'H' }),
      makeMatch({ slug: 'low', message: 'L' }),
    ];
    const { injected } = selectCandidates(matches, new Set(), {
      maxLessons: 1,
      claimFn: alwaysClaim,
    });
    assert.equal(injected[0].slug, 'high');
  });
});
