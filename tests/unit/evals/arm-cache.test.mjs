import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeCacheKey,
  cliVersion,
  hashDir,
  isCacheableArmResult,
  tryArmCache,
} from '../../../evals/lib/arm-cache.mjs';
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

  it('a different prompt changes the key with everything else unchanged', () => {
    const dir = scenario();
    const trial = { trialId: null, cliVersion: '1' };
    const a = computeCacheKey(dir, none, 'sonnet', null, '', trial, 'do task A');
    const b = computeCacheKey(dir, none, 'sonnet', null, '', trial, 'do task B');
    assert.notEqual(a, b);
  });

  it('hashDir ignores node_modules and .git', () => {
    const dir = scenario();
    const before = hashDir(dir);
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'x.js'), 'x');
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    assert.equal(hashDir(dir), before);
  });

  it('hashDir tells apart trees whose path, mode, and content bytes concatenate the same', () => {
    const tree = files => {
      const dir = mkdtempSync(join(tmpdir(), 'arm-cache-frame-'));
      for (const [name, content] of Object.entries(files)) {
        writeFileSync(join(dir, name), content);
        chmodSync(join(dir, name), 0o644);
      }
      return dir;
    };
    // "a" + "100644" + "b100644c" vs "a" + "100644" + "" + "b" + "100644" + "c"
    assert.notEqual(hashDir(tree({ a: 'b100644c' })), hashDir(tree({ a: '', b: 'c' })));
  });

  it('hashDir changes when a seed symlink is retargeted', () => {
    const dir = scenario();
    symlinkSync('/tmp/target-a', join(dir, 'link'));
    const before = hashDir(dir);
    rmSync(join(dir, 'link'));
    symlinkSync('/tmp/target-b', join(dir, 'link'));
    assert.notEqual(hashDir(dir), before);
  });
});

describe('isCacheableArmResult', () => {
  it('is false for a trial error', () => {
    assert.equal(isCacheableArmResult({ error: 'boom', metadata: {} }), false);
  });

  it('is false for a SKIP judge result (treatment ran before its control)', () => {
    assert.equal(isCacheableArmResult({ metadata: { judgeResult: { outcome: 'SKIP' } } }), false);
  });

  it('is false for a judge exception, whatever outcome it carries', () => {
    assert.equal(
      isCacheableArmResult({ metadata: { judgeResult: { outcome: 'FAIL', error: true } } }),
      false
    );
  });

  it('is false for a lesson treatment that has no judge result', () => {
    const intervention = { type: 'lesson', ids: ['some-lesson'] };
    assert.equal(isCacheableArmResult({ metadata: { intervention } }), false);
  });

  it('is true for a clean result with no judge', () => {
    assert.equal(isCacheableArmResult({ metadata: {} }), true);
  });

  it('is true for a successfully judged treatment', () => {
    assert.equal(
      isCacheableArmResult({ metadata: { judgeResult: { outcome: 'LESSON_HELPS' } } }),
      true
    );
  });
});

describe('tryArmCache', () => {
  it('reconstructs a deleted control transcript from metadata.transcript, including the tool-call log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arm-cache-restore-'));
    const cacheFile = join(dir, 'arm.json');
    const controlTranscriptFile = join(dir, 'control.json');
    writeFileSync(
      cacheFile,
      JSON.stringify({
        output: 'plain output only',
        metadata: { transcript: 'plain output only\n\n## TOOL CALL LOG\n  [Bash] echo hi' },
      })
    );

    const result = tryArmCache(cacheFile, true, controlTranscriptFile);

    assert.equal(result.metadata.cacheHit, true);
    const restored = JSON.parse(readFileSync(controlTranscriptFile, 'utf8')).output;
    assert.match(restored, /TOOL CALL LOG/);
  });

  it('falls back to plain output when a cache entry predates metadata.transcript', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arm-cache-restore-'));
    const cacheFile = join(dir, 'arm.json');
    const controlTranscriptFile = join(dir, 'control.json');
    writeFileSync(cacheFile, JSON.stringify({ output: 'legacy output', metadata: {} }));

    tryArmCache(cacheFile, true, controlTranscriptFile);

    const restored = JSON.parse(readFileSync(controlTranscriptFile, 'utf8')).output;
    assert.equal(restored, 'legacy output');
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
