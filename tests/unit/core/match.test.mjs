import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchLessons, findBlocker } from '../../../core/match.mjs';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeLesson(overrides = {}) {
  return {
    slug: 'test-lesson',
    type: 'hint',
    priority: 5,
    message: '## Test lesson',
    summary: 'A test lesson',
    problem: '',
    solution: '',
    toolNames: ['Bash'],
    commandRegexSources: [{ source: 'pytest', flags: '' }],
    ...overrides,
  };
}

function makeLessons(entries) {
  return Object.fromEntries(entries.map(([id, overrides]) => [id, makeLesson(overrides)]));
}

// ─── matchLessons ──────────────────────────────────────────────────────────

describe('matchLessons', () => {
  it('returns empty array when no lessons match', () => {
    const lessons = makeLessons([['L1', {}]]);
    const result = matchLessons(lessons, 'Bash', 'ls -la', '');
    assert.deepEqual(result, []);
  });

  it('matches a lesson by command regex', () => {
    const lessons = makeLessons([['L1', { slug: 'pytest-lesson' }]]);
    const result = matchLessons(lessons, 'Bash', 'pytest tests/', '');
    assert.equal(result.length, 1);
    assert.equal(result[0].slug, 'pytest-lesson');
  });

  it('does not match when tool name differs', () => {
    const lessons = makeLessons([['L1', { toolNames: ['Read'] }]]);
    const result = matchLessons(lessons, 'Bash', 'pytest tests/', '');
    assert.deepEqual(result, []);
  });

  it('matches a lesson by file path regex', () => {
    const lessons = makeLessons([
      [
        'L1',
        {
          toolNames: ['Read'],
          commandRegexSources: [],
          pathRegexSources: [{ source: '\\.env$', flags: '' }],
        },
      ],
    ]);
    const result = matchLessons(lessons, 'Read', '', '/project/.env');
    assert.equal(result.length, 1);
  });

  it('returns matches sorted by priority descending', () => {
    const lessons = makeLessons([
      ['L1', { slug: 'low', priority: 3 }],
      ['L2', { slug: 'high', priority: 9 }],
      ['L3', { slug: 'mid', priority: 6 }],
    ]);
    const result = matchLessons(lessons, 'Bash', 'pytest tests/', '');
    assert.deepEqual(
      result.map(r => r.slug),
      ['high', 'mid', 'low']
    );
  });

  it('skips lessons with invalid regex without throwing', () => {
    const lessons = makeLessons([
      ['L1', { commandRegexSources: [{ source: '[invalid', flags: '' }] }],
    ]);
    assert.doesNotThrow(() => matchLessons(lessons, 'Bash', 'pytest tests/', ''));
    const result = matchLessons(lessons, 'Bash', 'pytest tests/', '');
    assert.deepEqual(result, []);
  });

  it('uses case-insensitive flag when present', () => {
    const lessons = makeLessons([
      ['L1', { commandRegexSources: [{ source: 'PYTEST', flags: 'i' }] }],
    ]);
    const result = matchLessons(lessons, 'Bash', 'pytest tests/', '');
    assert.equal(result.length, 1);
  });

  it('populates all Match fields from lesson data', () => {
    const lessons = makeLessons([
      [
        'L1',
        {
          slug: 'my-slug',
          type: 'guard',
          priority: 8,
          message: '## My injection',
          summary: 'My summary',
        },
      ],
    ]);
    const [match] = matchLessons(lessons, 'Bash', 'pytest', '');
    assert.equal(match.id, 'L1');
    assert.equal(match.slug, 'my-slug');
    assert.equal(match.type, 'guard');
    assert.equal(match.priority, 8);
    assert.equal(match.message, '## My injection');
    assert.equal(match.summary, 'My summary');
  });

  it('uses defaults for missing lesson fields', () => {
    const lessons = { L1: { toolNames: ['Bash'], commandRegexSources: [{ source: 'x' }] } };
    const [match] = matchLessons(lessons, 'Bash', 'x', '');
    assert.equal(match.slug, 'L1');
    assert.equal(match.type, 'hint');
    assert.equal(match.priority, 5);
    assert.equal(match.message, '');
  });

  it('returns empty array for empty lessons object', () => {
    assert.deepEqual(matchLessons({}, 'Bash', 'anything', ''), []);
  });

  it('matches multiple lessons for the same command', () => {
    const lessons = makeLessons([
      ['L1', { slug: 's1', commandRegexSources: [{ source: 'pytest', flags: '' }] }],
      ['L2', { slug: 's2', commandRegexSources: [{ source: 'test', flags: '' }] }],
    ]);
    const result = matchLessons(lessons, 'Bash', 'pytest tests/', '');
    assert.equal(result.length, 2);
  });

  it('does not match file-path lessons against command-only tool invocations', () => {
    const lessons = makeLessons([
      [
        'L1',
        {
          toolNames: ['Bash'],
          commandRegexSources: [],
          pathRegexSources: [{ source: '\\.env$', flags: '' }],
        },
      ],
    ]);
    const result = matchLessons(lessons, 'Bash', '.env', '');
    assert.deepEqual(result, []);
  });

  it('matches both command and path regexes within the same lesson', () => {
    const lessons = makeLessons([
      [
        'L1',
        {
          toolNames: ['Bash'],
          commandRegexSources: [{ source: 'grep', flags: '' }],
          pathRegexSources: [{ source: '\\.env$', flags: '' }],
        },
      ],
    ]);
    const byCommand = matchLessons(lessons, 'Bash', 'grep foo', '');
    assert.equal(byCommand.length, 1);
  });
});

// ─── findBlocker ───────────────────────────────────────────────────────────

describe('findBlocker', () => {
  it('returns null when no matches have type:guard', () => {
    const matches = [makeLesson({ type: 'hint' })];
    assert.equal(findBlocker(matches, 'pytest'), null);
  });

  it('returns reason object for a guard lesson', () => {
    const matches = [makeLesson({ type: 'guard', message: 'Do not run this' })];
    const result = findBlocker(matches, 'pytest');
    assert.deepEqual(result, { reason: 'Do not run this' });
  });

  it('substitutes {command} placeholder in message', () => {
    const matches = [makeLesson({ type: 'guard', message: 'Blocked: {command}' })];
    const result = findBlocker(matches, 'rm -rf /');
    assert.equal(result.reason, 'Blocked: rm -rf /');
  });

  it('truncates command to 120 chars in reason substitution', () => {
    const longCmd = 'a'.repeat(200);
    const matches = [makeLesson({ type: 'guard', message: 'Blocked: {command}' })];
    const result = findBlocker(matches, longCmd);
    assert.equal(result.reason, `Blocked: ${'a'.repeat(120)}`);
  });

  it('returns first guard lesson when multiple match', () => {
    const matches = [
      makeLesson({ slug: 'first', type: 'guard', message: 'First block' }),
      makeLesson({ slug: 'second', type: 'guard', message: 'Second block' }),
    ];
    const result = findBlocker(matches, 'cmd');
    assert.equal(result.reason, 'First block');
  });
});
