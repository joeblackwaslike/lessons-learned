import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupByTag } from '../../../hooks/lib/session-start.mjs';

function makeLesson(overrides = {}) {
  return { message: 'some message', tags: [], ...overrides };
}

describe('groupByTag', () => {
  it('returns empty array for empty input', () => {
    assert.deepEqual(groupByTag([]), []);
  });

  it('groups lessons by first tag', () => {
    const lessons = [
      makeLesson({ tags: ['tool:git'] }),
      makeLesson({ tags: ['tool:npm'] }),
      makeLesson({ tags: ['tool:git'] }),
    ];
    const groups = groupByTag(lessons);
    assert.equal(groups.length, 2);
    const tagMap = Object.fromEntries(groups);
    assert.equal(tagMap['tool:git'].length, 2);
    assert.equal(tagMap['tool:npm'].length, 1);
  });

  it('uses (untagged) key for lessons with no tags', () => {
    const lessons = [makeLesson({ tags: [] }), makeLesson({ tags: undefined })];
    const groups = groupByTag(lessons);
    assert.equal(groups.length, 1);
    assert.equal(groups[0][0], '(untagged)');
    assert.equal(groups[0][1].length, 2);
  });

  it('sorts groups alphabetically', () => {
    const lessons = [
      makeLesson({ tags: ['topic:z'] }),
      makeLesson({ tags: ['topic:a'] }),
      makeLesson({ tags: ['topic:m'] }),
    ];
    const groups = groupByTag(lessons);
    assert.deepEqual(
      groups.map(([tag]) => tag),
      ['topic:a', 'topic:m', 'topic:z']
    );
  });

  it('places (untagged) group last', () => {
    const lessons = [
      makeLesson({ tags: [] }),
      makeLesson({ tags: ['topic:z'] }),
      makeLesson({ tags: ['topic:a'] }),
    ];
    const groups = groupByTag(lessons);
    const tags = groups.map(([tag]) => tag);
    assert.equal(tags[tags.length - 1], '(untagged)');
    assert.ok(tags.indexOf('topic:a') < tags.indexOf('(untagged)'));
  });

  it('single group produces no need for headers (length === 1)', () => {
    const lessons = [makeLesson({ tags: ['tool:git'] }), makeLesson({ tags: ['tool:git'] })];
    const groups = groupByTag(lessons);
    assert.equal(groups.length, 1);
  });

  it('preserves lesson order within a group', () => {
    const l1 = makeLesson({ tags: ['tool:git'], message: 'first' });
    const l2 = makeLesson({ tags: ['tool:git'], message: 'second' });
    const l3 = makeLesson({ tags: ['tool:git'], message: 'third' });
    const [[, group]] = groupByTag([l1, l2, l3]);
    assert.equal(group[0].message, 'first');
    assert.equal(group[1].message, 'second');
    assert.equal(group[2].message, 'third');
  });
});
