import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLessonTags, scanLineForLessons } from '../../../scripts/scanner/structured.mjs';

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
      'Some prose in between.',
      '#lesson\nproblem: error two\nsolution: fix two\n#/lesson',
    ].join('\n');
    const result = parseLessonTags(text);
    assert.equal(result.length, 2);
    assert.equal(result[0].problem, 'error one');
    assert.equal(result[1].problem, 'error two');
  });

  it('parses tags as trimmed array', () => {
    const text = '#lesson\nproblem: m\nsolution: f\ntags:  a , b , c \n#/lesson';
    const [result] = parseLessonTags(text);
    assert.deepEqual(result.tags, ['a', 'b', 'c']);
  });

  it('returns empty tags array when tags field is absent', () => {
    const text = '#lesson\nproblem: m\nsolution: f\n#/lesson';
    const [result] = parseLessonTags(text);
    assert.deepEqual(result.tags, []);
  });

  it('handles blocks wrapped in code fences', () => {
    const text = '```\n#lesson\nproblem: fenced\nsolution: still works\n#/lesson\n```';
    const result = parseLessonTags(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].problem, 'fenced');
  });

  it('includes raw match in result', () => {
    const text = '#lesson\nproblem: m\nsolution: f\n#/lesson';
    const [result] = parseLessonTags(text);
    assert.ok(typeof result.raw === 'string');
    assert.ok(result.raw.includes('#lesson'));
  });

  it('nulls optional fields when missing', () => {
    const text = '#lesson\nproblem: m\nsolution: f\n#/lesson';
    const [result] = parseLessonTags(text);
    assert.equal(result.tool, null);
    assert.equal(result.trigger, null);
  });
});

// ─── scanLineForLessons ────────────────────────────────────────────────────

describe('scanLineForLessons', () => {
  it('returns empty array for a line without #lesson', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hi' }] },
    });
    assert.deepEqual(scanLineForLessons(line), []);
  });

  it('returns empty array for invalid JSON', () => {
    assert.deepEqual(scanLineForLessons('{not json #lesson'), []);
  });

  it('returns empty array for non-assistant message type', () => {
    const text = '#lesson\nproblem: m\nsolution: f\n#/lesson';
    const line = JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text }] } });
    assert.deepEqual(scanLineForLessons(line), []);
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
    const results = scanLineForLessons(line);
    assert.equal(results.length, 1);
    assert.equal(results[0].problem, 'TTY hang');
    assert.equal(results[0].sessionId, 'sess-abc');
    assert.equal(results[0].messageId, 'msg-001');
    assert.equal(results[0].timestamp, '2026-04-01T00:00:00Z');
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
    const results = scanLineForLessons(line);
    assert.equal(results.length, 1);
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
    const results = scanLineForLessons(line);
    assert.equal(results.length, 2);
  });
});
