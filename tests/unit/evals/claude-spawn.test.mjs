import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rejectApiErrorOutput } from '../../../evals/lib/claude-spawn.mjs';

describe('rejectApiErrorOutput', () => {
  it('throws when the CLI printed an API error to stdout', () => {
    assert.throws(
      () => rejectApiErrorOutput('API Error: Usage credits required for 1M context · turn on'),
      /API Error/
    );
  });

  it('passes ordinary model output through unchanged', () => {
    assert.equal(
      rejectApiErrorOutput('Use `git worktree list --porcelain`.'),
      'Use `git worktree list --porcelain`.'
    );
  });

  it('does not reject output that merely mentions an API error mid-text', () => {
    const text = 'The agent saw an "API Error: 529" and retried.';
    assert.equal(rejectApiErrorOutput(text), text);
  });
});
