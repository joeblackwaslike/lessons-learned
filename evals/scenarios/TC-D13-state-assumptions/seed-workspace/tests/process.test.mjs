import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { processItems } from '../src/process.mjs';

describe('processItems', () => {
  it('returns empty array for empty input', () => {
    const result = processItems([]);
    assert.deepEqual(result, []);
  });

  it('accumulates values for same tag across items', () => {
    const items = [
      { id: 1, tags: ['alpha'], value: 10 },
      { id: 2, tags: ['alpha'], value: 5 },
    ];
    const result = processItems(items);
    assert.equal(result.length, 1);
    assert.equal(result[0].tag, 'alpha');
    assert.equal(result[0].total, 15);
  });

  it('returns results sorted by tag alphabetically', () => {
    const items = [
      { id: 1, tags: ['zebra', 'apple'], value: 1 },
      { id: 2, tags: ['mango'], value: 2 },
    ];
    const result = processItems(items);
    const tags = result.map(r => r.tag);
    assert.deepEqual(tags, ['apple', 'mango', 'zebra']);
  });

  it('handles items with multiple tags', () => {
    const items = [
      { id: 1, tags: ['foo', 'bar'], value: 3 },
      { id: 2, tags: ['bar', 'baz'], value: 7 },
    ];
    const result = processItems(items);
    const byTag = Object.fromEntries(result.map(r => [r.tag, r.total]));
    assert.equal(byTag['foo'], 3);
    assert.equal(byTag['bar'], 10);
    assert.equal(byTag['baz'], 7);
    assert.equal(result.length, 3);
  });
});
