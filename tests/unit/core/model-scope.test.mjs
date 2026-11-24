import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expandModelScope, modelScopeErrors } from '../../../core/model-scope.mjs';

describe('expandModelScope', () => {
  it('expands opus to the sonnet and haiku of the same generation', () => {
    assert.deepEqual(expandModelScope(['claude-opus-5']).sort(), [
      'claude-haiku-5',
      'claude-opus-5',
      'claude-sonnet-5',
    ]);
  });

  it('does not expand the lowest tier, and keeps the minor version as written', () => {
    assert.deepEqual(expandModelScope(['claude-haiku-5']), ['claude-haiku-5']);
    assert.deepEqual(expandModelScope(['claude-sonnet-4-6']).sort(), [
      'claude-haiku-4',
      'claude-sonnet-4-6',
    ]);
  });

  it('passes non-Claude patterns through unchanged', () => {
    assert.deepEqual(expandModelScope(['gpt-4o']), ['gpt-4o']);
  });

  it('pins a lesson to 4.x without matching 5.x', () => {
    const matches = id =>
      expandModelScope(['claude-sonnet-4']).some(p => new RegExp(p, 'i').test(id));
    assert.equal(matches('claude-sonnet-4-6'), true);
    assert.equal(matches('claude-haiku-4-5'), true);
    assert.equal(matches('claude-sonnet-5-5'), false);
  });
});

describe('modelScopeErrors', () => {
  it('accepts undefined, an empty list, tier patterns and non-Claude patterns', () => {
    assert.deepEqual(modelScopeErrors(undefined), []);
    assert.deepEqual(modelScopeErrors([]), []);
    assert.deepEqual(modelScopeErrors(['claude-sonnet-4', 'gpt-4o']), []);
  });

  it('rejects a non-array, non-string items and invalid regexes', () => {
    assert.equal(modelScopeErrors('claude-sonnet-4').length, 1);
    assert.equal(modelScopeErrors([1]).length, 1);
    assert.match(modelScopeErrors(['claude-sonnet-(4'])[0], /not a valid regex/);
  });

  it('rejects a Claude pattern that tier expansion would not recognise', () => {
    assert.match(modelScopeErrors(['sonnet-4 claude'])[0], /must start with claude-/);
    assert.equal(modelScopeErrors(['claude-(sonnet|opus)-4']).length, 1);
  });
});
