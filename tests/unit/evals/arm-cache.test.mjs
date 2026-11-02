import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeCacheKey, cliVersion, hashDir } from '../../../evals/lib/arm-cache.mjs';
import { makeFakeClaude } from '../../helpers/fake-claude.mjs';

function scenario() {
  const dir = mkdtempSync(join(tmpdir(), 'arm-cache-scn-'));
  writeFileSync(join(dir, 'scenario.json'), '{}');
  return dir;
}

const none = { type: 'none', ids: [] };

describe('computeCacheKey', () => {
  it('cliVersion changes the key', () => {
    const dir = scenario();
    const a = computeCacheKey(dir, none, 'sonnet', null, '', {
      trialId: null,
      cliVersion: '1.0.0',
    });
    const b = computeCacheKey(dir, none, 'sonnet', null, '', {
      trialId: null,
      cliVersion: '1.0.1',
    });
    assert.notEqual(a, b);
  });

  it('trialId changes the key', () => {
    const dir = scenario();
    const a = computeCacheKey(dir, none, 'sonnet', null, '', { trialId: 't1', cliVersion: '1' });
    const b = computeCacheKey(dir, none, 'sonnet', null, '', { trialId: 't2', cliVersion: '1' });
    const c = computeCacheKey(dir, none, 'sonnet', null, '', { trialId: null, cliVersion: '1' });
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });

  it('editing a file in the overlay dir changes the key', () => {
    const dir = scenario();
    const overlay = mkdtempSync(join(tmpdir(), 'arm-cache-ovl-'));
    mkdirSync(join(overlay, 'docs'));
    writeFileSync(join(overlay, 'docs', 'rule.md'), 'v1');
    const intervention = { type: 'overlay', dir: overlay };
    const trial = { trialId: null, cliVersion: '1' };
    const before = computeCacheKey(dir, intervention, 'sonnet', null, '', trial);
    writeFileSync(join(overlay, 'docs', 'rule.md'), 'v2');
    const after = computeCacheKey(dir, intervention, 'sonnet', null, '', trial);
    assert.notEqual(before, after);
  });

  it('the overlay dir path alone does not change the key', () => {
    const dir = scenario();
    const trial = { trialId: null, cliVersion: '1' };
    const keys = ['a', 'b'].map(() => {
      const overlay = mkdtempSync(join(tmpdir(), 'arm-cache-ovl-'));
      writeFileSync(join(overlay, 'CLAUDE.md'), 'same');
      return computeCacheKey(dir, { type: 'overlay', dir: overlay }, 'sonnet', null, '', trial);
    });
    assert.equal(keys[0], keys[1]);
  });

  it('hashDir ignores node_modules and .git', () => {
    const dir = scenario();
    const before = hashDir(dir);
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'x.js'), 'x');
    assert.equal(hashDir(dir), before);
  });
});

describe('cliVersion', () => {
  it('reads <bin> --version once and memoizes it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arm-cache-bin-'));
    const log = join(dir, 'runs.log');
    const bin = makeFakeClaude(dir, { FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_VERSION: '3.2.1' });
    assert.equal(cliVersion(bin), '3.2.1 (Fake)');
    writeFileSync(bin, readFileSync(bin, 'utf8').replace('3.2.1', '4.0.0'));
    assert.equal(cliVersion(bin), '3.2.1 (Fake)');
    assert.equal(existsSync(log), false, '--version must not count as a run');
  });
});
