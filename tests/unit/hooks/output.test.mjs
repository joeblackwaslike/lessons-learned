import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatHookOutput, formatEmptyOutput } from '../../../hooks/lib/output.mjs';

describe('formatEmptyOutput', () => {
  it('returns the string "{}"', () => {
    assert.equal(formatEmptyOutput(), '{}');
  });

  it('is valid JSON', () => {
    assert.doesNotThrow(() => JSON.parse(formatEmptyOutput()));
  });
});

describe('formatHookOutput', () => {
  it('includes additionalContext in hookSpecificOutput', () => {
    const out = JSON.parse(formatHookOutput('Lesson text', '', { injected: [], dropped: [] }));
    assert.equal(out.hookSpecificOutput.additionalContext.startsWith('Lesson text'), true);
  });

  it('appends lessonInjection metadata comment', () => {
    const out = JSON.parse(formatHookOutput('Text', '', { injected: ['s1'], dropped: [] }));
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('<!-- lessonInjection:'));
    const match = ctx.match(/<!-- lessonInjection: (.+) -->/);
    assert.ok(match, 'metadata comment not found');
    const meta = JSON.parse(match[1]);
    assert.equal(meta.version, 1);
    assert.deepEqual(meta.injected, ['s1']);
  });

  it('sets LESSONS_SEEN env var when lessonsSeen is non-empty', () => {
    const out = JSON.parse(
      formatHookOutput('Text', 'slug-a,slug-b', { injected: [], dropped: [] })
    );
    assert.equal(out.env.LESSONS_SEEN, 'slug-a,slug-b');
  });

  it('omits env key when lessonsSeen is empty string', () => {
    const out = JSON.parse(formatHookOutput('Text', '', { injected: [], dropped: [] }));
    assert.equal(out.env, undefined);
  });

  it('omits hookSpecificOutput when additionalContext is empty', () => {
    const out = JSON.parse(formatHookOutput('', 'slug', { injected: [], dropped: [] }));
    assert.equal(out.hookSpecificOutput, undefined);
  });

  it('returns valid JSON', () => {
    assert.doesNotThrow(() =>
      JSON.parse(
        formatHookOutput('Some text', 'slug1', { injected: ['slug1'], dropped: ['slug2'] })
      )
    );
  });
});
