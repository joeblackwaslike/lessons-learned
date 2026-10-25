import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, initSchema, insertCandidate, updateRecord } from '../../scripts/db.mjs';

function seededDb() {
  const db = openDb(':memory:');
  initSchema(db);
  insertCandidate(db, {
    id: 'L1',
    slug: 'slug-1',
    summary: 'A candidate lesson summary for testing purposes here',
    problem: 'The problem that happened in the candidate session context',
    solution: 'The solution that resolved the candidate problem correctly',
    contentHash: 'h1',
  });
  return db;
}

describe('evalSkipReason requires a receipt', () => {
  it('rejects a reason that cites no scenario, results path, or date', () => {
    const db = seededDb();
    assert.throws(
      () =>
        updateRecord(db, 'L1', {
          evalSkipReason: 'hint type is correct; works in production but not in eval',
        }),
      /receipt/i
    );
  });

  it('accepts a reason that cites a scenario id', () => {
    const db = seededDb();
    assert.ok(
      updateRecord(db, 'L1', { evalSkipReason: 'tool unavailable in --print (TC-P5 transcript)' })
    );
  });

  it('accepts a reason that cites a date', () => {
    const db = seededDb();
    assert.ok(updateRecord(db, 'L1', { evalSkipReason: 'infra-specific, assessed 2026-10-25' }));
  });

  it('allows clearing the reason with null', () => {
    const db = seededDb();
    assert.ok(updateRecord(db, 'L1', { evalSkipReason: null }));
  });
});
