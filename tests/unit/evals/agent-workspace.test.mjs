import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectArtifacts,
  ensureRealDir,
  restoreHookLogs,
  writeRegularFile,
} from '../../../evals/lib/agent-workspace.mjs';

describe('collectArtifacts', () => {
  it('throws naming the collector script and exit status instead of returning {}', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'collect-ws-'));
    const scenario = mkdtempSync(join(tmpdir(), 'collect-scn-'));
    mkdirSync(join(workspace, '.eval'), { recursive: true });
    // Malformed intervention.json makes the real collector script throw uncaught,
    // exiting non-zero instead of emitting JSON on stdout.
    writeFileSync(join(workspace, '.eval', 'intervention.json'), '{not valid json');

    assert.throws(
      () => collectArtifacts(workspace, scenario),
      /collect-artifacts.*collect-artifacts\.mjs.*exited/
    );
  });

  it('succeeds and returns parsed artifacts for a clean workspace', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'collect-ws-'));
    const scenario = mkdtempSync(join(tmpdir(), 'collect-scn-'));
    const artifacts = collectArtifacts(workspace, scenario);
    assert.deepEqual(artifacts.trajectory, []);
  });
});

describe('symlink safety when restoring agent workspace metadata', () => {
  it('writeRegularFile does not follow an agent-planted symlink at the destination', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-symlink-'));
    const secret = join(dir, 'outside-secret.txt');
    writeFileSync(secret, 'original');
    const dest = join(dir, 'agent-output.txt');
    symlinkSync(secret, dest);

    writeRegularFile(dest, 'written by harness');

    assert.equal(readFileSync(secret, 'utf8'), 'original');
    assert.equal(readFileSync(dest, 'utf8'), 'written by harness');
    assert.equal(lstatSync(dest).isSymbolicLink(), false);
  });

  it('ensureRealDir replaces a symlinked .eval dir with a real directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-symlink-'));
    const outsideDir = mkdtempSync(join(tmpdir(), 'ws-symlink-outside-'));
    const evalDir = join(dir, '.eval');
    symlinkSync(outsideDir, evalDir);

    ensureRealDir(evalDir);

    assert.equal(lstatSync(evalDir).isSymbolicLink(), false);
    assert.equal(lstatSync(evalDir).isDirectory(), true);
  });

  it('restoreHookLogs does not follow an agent-planted symlink at a hook-log destination', () => {
    const logDir = mkdtempSync(join(tmpdir(), 'ws-logdir-'));
    writeFileSync(join(logDir, 'hook-events.ndjson'), 'real log line\n');
    const evalMetaDir = mkdtempSync(join(tmpdir(), 'ws-evalmeta-'));
    const secret = join(evalMetaDir, 'outside-secret.txt');
    writeFileSync(secret, 'original');
    symlinkSync(secret, join(evalMetaDir, 'hook-events.ndjson'));

    restoreHookLogs(logDir, evalMetaDir);

    assert.equal(readFileSync(secret, 'utf8'), 'original');
    assert.equal(
      readFileSync(join(evalMetaDir, 'hook-events.ndjson'), 'utf8'),
      'real log line\n'
    );
  });

  it('restoreHookLogs removes a planted symlink when the real log is absent', () => {
    const logDir = mkdtempSync(join(tmpdir(), 'ws-logdir-'));
    const evalMetaDir = mkdtempSync(join(tmpdir(), 'ws-evalmeta-'));
    const secret = join(evalMetaDir, 'outside-secret.txt');
    writeFileSync(secret, 'original');
    symlinkSync(secret, join(evalMetaDir, 'tool-calls.jsonl'));

    restoreHookLogs(logDir, evalMetaDir);

    assert.equal(existsSync(join(evalMetaDir, 'tool-calls.jsonl')), false);
    assert.equal(readFileSync(secret, 'utf8'), 'original');
  });
});
