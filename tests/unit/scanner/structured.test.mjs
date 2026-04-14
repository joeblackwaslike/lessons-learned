import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLessonTags, parseCancelTags, scanLineForLessons } from '../../../scripts/scanner/structured.mjs';

// ─── parseLessonTags ───────────────────────────────────────────────────────

describe('parseLessonTags', () => {
  it('returns empty array for empty string', () => {
    assert.deepEqual(parseLessonTags(''), []);
  });

  it('returns empty array for null/undefined', () => {
    assert.deepEqual(parseLessonTags(null), []);
    assert.deepEqual(parseLessonTags(undefined), []);
  });

  it('returns empty array when no #lesson tags present', () => {
    assert.deepEqual(parseLessonTags('just some regular text'), []);
  });

  it('parses a minimal #lesson block (problem + solution only)', () => {
    const text = `#lesson\nproblem: something broke\nsolution: do it differently\n#/lesson`;
    const result = parseLessonTags(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].problem, 'something broke');
    assert.equal(result[0].solution, 'do it differently');
  });

  it('parses a full #lesson block with all fields', () => {
    const text = [
      '#lesson',
      'tool: Bash',
      'trigger: pytest tests/',
      'problem: pytest hangs due to TTY detection',
      'solution: use python -m pytest --no-header',
      'tags: lang:python, tool:pytest, severity:hang',
      '#/lesson',
    ].join('\n');

    const [result] = parseLessonTags(text);
    assert.equal(result.tool, 'Bash');
    assert.equal(result.trigger, 'pytest tests/');
    assert.equal(result.problem, 'pytest hangs due to TTY detection');
    assert.equal(result.solution, 'use python -m pytest --no-header');
    assert.deepEqual(result.tags, ['lang:python', 'tool:pytest', 'severity:hang']);
  });

  it('skips blocks missing both problem and solution', () => {
    const text = '#lesson\ntool: Bash\ntrigger: ls\n#/lesson';
    assert.deepEqual(parseLessonTags(text), []);
  });

  it('skips a block missing solution (problem alone is not enough)', () => {
    const text = '#lesson\nproblem: Something went wrong\n#/lesson';
    assert.deepEqual(parseLessonTags(text), []);
  });

  it('parses multiple #lesson blocks in one text', () => {
    const text = [
      '#lesson\nproblem: error one\nsolution: fix one\n#/lesson',
      '#lesson\nproblem: error two\nsolution: fix two\n#/lesson',
    ].join('\n');
    const results = parseLessonTags(text);
    assert.equal(results.length, 2);
    assert.equal(results[0].problem, 'error one');
    assert.equal(results[1].problem, 'error two');
  });

  it('defaults optional fields to null or []', () => {
    const text = '#lesson\nproblem: something\nsolution: fix it\n#/lesson';
    const [result] = parseLessonTags(text);
    assert.equal(result.tool, null);
    assert.equal(result.trigger, null);
    assert.deepEqual(result.tags, []);
    assert.equal(result.scope, null);
  });

  it('parses scope field', () => {
    const text = '#lesson\nproblem: p\nsolution: s\nscope: project\n#/lesson';
    const [result] = parseLessonTags(text);
    assert.equal(result.scope, 'project');
  });

  it('parses an empty trigger field as null', () => {
    const text = '#lesson\nproblem: something broke\nsolution: fix it\ntrigger: \n#/lesson';
    const result = parseLessonTags(text);
    assert.equal(result[0].trigger, null);
  });
});

// ─── parseCancelTags ──────────────────────────────────────────────────────

describe('parseCancelTags', () => {
  it('returns empty array for text with no cancel tags', () => {
    assert.deepEqual(parseCancelTags('some text'), []);
  });

  it('returns empty array for null/undefined', () => {
    assert.deepEqual(parseCancelTags(null), []);
    assert.deepEqual(parseCancelTags(undefined), []);
  });

  it('parses a #lesson:cancel block and returns the problem prefix', () => {
    const text = '#lesson:cancel\nproblem: pytest hangs due to TTY\n#/lesson:cancel';
    const result = parseCancelTags(text);
    assert.equal(result.length, 1);
    assert.equal(result[0], 'pytest hangs due to tty');
  });

  it('lowercases the problem prefix for case-insensitive matching', () => {
    const text = '#lesson:cancel\nproblem: Pytest Hangs TTY\n#/lesson:cancel';
    const [result] = parseCancelTags(text);
    assert.equal(result, 'pytest hangs tty');
  });

  it('parses multiple cancel blocks', () => {
    const text = [
      '#lesson:cancel\nproblem: first problem\n#/lesson:cancel',
      '#lesson:cancel\nproblem: second problem\n#/lesson:cancel',
    ].join('\n');
    const results = parseCancelTags(text);
    assert.equal(results.length, 2);
    assert.equal(results[0], 'first problem');
    assert.equal(results[1], 'second problem');
  });

  it('ignores cancel blocks without a problem field', () => {
    const text = '#lesson:cancel\nnote: no problem field here\n#/lesson:cancel';
    assert.deepEqual(parseCancelTags(text), []);
  });
});

// ─── scanLineForLessons ────────────────────────────────────────────────────

describe('scanLineForLessons', () => {
  it('returns empty lessons and cancels for a line without #lesson', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hi' }] },
    });
    const { lessons, cancels } = scanLineForLessons(line);
    assert.deepEqual(lessons, []);
    assert.deepEqual(cancels, []);
  });

  it('returns empty lessons and cancels for invalid JSON', () => {
    const { lessons, cancels } = scanLineForLessons('{not json #lesson');
    assert.deepEqual(lessons, []);
    assert.deepEqual(cancels, []);
  });

  it('returns empty lessons for non-assistant message type', () => {
    const text = '#lesson\nproblem: m\nsolution: f\n#/lesson';
    const line = JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text }] } });
    const { lessons } = scanLineForLessons(line);
    assert.deepEqual(lessons, []);
  });

  it('extracts a lesson from a valid assistant JSONL line', () => {
    const text =
      '#lesson\ntool: Bash\ntrigger: pytest\nproblem: TTY hang\nsolution: use -m pytest\n#/lesson';
    const line = JSON.stringify({
      type: 'assistant',
      sessionId: 'sess-abc',
      timestamp: '2026-04-01T00:00:00Z',
      message: {
        id: 'msg-001',
        content: [{ type: 'text', text }],
      },
    });
    const { lessons } = scanLineForLessons(line);
    assert.equal(lessons.length, 1);
    assert.equal(lessons[0].problem, 'TTY hang');
    assert.equal(lessons[0].sessionId, 'sess-abc');
    assert.equal(lessons[0].messageId, 'msg-001');
    assert.equal(lessons[0].timestamp, '2026-04-01T00:00:00Z');
  });

  it('skips non-text content blocks', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Bash' },
          { type: 'text', text: '#lesson\nproblem: m\nsolution: f\n#/lesson' },
        ],
      },
    });
    const { lessons } = scanLineForLessons(line);
    assert.equal(lessons.length, 1);
  });

  it('extracts multiple lessons from multiple text blocks', () => {
    const lesson = '#lesson\nproblem: m\nsolution: f\n#/lesson';
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: lesson },
          { type: 'text', text: lesson },
        ],
      },
    });
    const { lessons } = scanLineForLessons(line);
    assert.equal(lessons.length, 2);
  });

  it('extracts cancel tags from the same line', () => {
    const text = '#lesson:cancel\nproblem: tty hang problem\n#/lesson:cancel';
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text }] },
    });
    const { lessons, cancels } = scanLineForLessons(line);
    assert.equal(lessons.length, 0);
    assert.equal(cancels.length, 1);
    assert.equal(cancels[0], 'tty hang problem');
  });

  it('returns both lessons and cancels when both appear in the same line', () => {
    const text = [
      '#lesson\nproblem: something else\nsolution: fix it\n#/lesson',
      '#lesson:cancel\nproblem: tty hang\n#/lesson:cancel',
    ].join('\n');
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text }] },
    });
    const { lessons, cancels } = scanLineForLessons(line);
    assert.equal(lessons.length, 1);
    assert.equal(cancels.length, 1);
  });
});
