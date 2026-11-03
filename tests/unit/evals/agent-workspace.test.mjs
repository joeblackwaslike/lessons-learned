import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  linkSync,
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
  readToolCallLog,
  restoreHookLogs,
  runVerify,
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
    assert.equal(readFileSync(join(evalMetaDir, 'hook-events.ndjson'), 'utf8'), 'real log line\n');
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

  it('ensureRealDir preserves an existing real directory and its contents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-realdir-'));
    const evalDir = join(dir, '.eval');
    mkdirSync(evalDir);
    writeFileSync(join(evalDir, 'intervention.json'), '{"kept":true}');

    ensureRealDir(evalDir);

    assert.equal(lstatSync(evalDir).isDirectory(), true);
    assert.equal(readFileSync(join(evalDir, 'intervention.json'), 'utf8'), '{"kept":true}');
  });

  it('writeRegularFile does not truncate an agent-planted hard link at the destination', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-hardlink-'));
    const secret = join(dir, 'outside-secret.txt');
    writeFileSync(secret, 'original');
    const dest = join(dir, 'agent-output.txt');
    linkSync(secret, dest);

    writeRegularFile(dest, 'written by harness');

    assert.equal(readFileSync(secret, 'utf8'), 'original');
    assert.equal(readFileSync(dest, 'utf8'), 'written by harness');
  });

  it('restoreHookLogs does not truncate an agent-planted hard link at a hook-log destination', () => {
    const logDir = mkdtempSync(join(tmpdir(), 'ws-logdir-'));
    writeFileSync(join(logDir, 'hook-events.ndjson'), 'real log line\n');
    const evalMetaDir = mkdtempSync(join(tmpdir(), 'ws-evalmeta-'));
    const secret = join(evalMetaDir, 'outside-secret.txt');
    writeFileSync(secret, 'original');
    linkSync(secret, join(evalMetaDir, 'hook-events.ndjson'));

    restoreHookLogs(logDir, evalMetaDir);

    assert.equal(readFileSync(secret, 'utf8'), 'original');
    assert.equal(readFileSync(join(evalMetaDir, 'hook-events.ndjson'), 'utf8'), 'real log line\n');
  });

  it('writeRegularFile removes an agent-planted directory at the destination', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-plantdir-'));
    const dest = join(dir, 'agent-output.txt');
    mkdirSync(dest);
    writeFileSync(join(dest, 'nested.txt'), 'planted');

    writeRegularFile(dest, 'written by harness');

    assert.equal(lstatSync(dest).isDirectory(), false);
    assert.equal(readFileSync(dest, 'utf8'), 'written by harness');
  });

  it('restoreHookLogs replaces an agent-planted directory with the trusted log', () => {
    const logDir = mkdtempSync(join(tmpdir(), 'ws-logdir-'));
    writeFileSync(join(logDir, 'tool-calls.jsonl'), 'real log line\n');
    const evalMetaDir = mkdtempSync(join(tmpdir(), 'ws-evalmeta-'));
    const dest = join(evalMetaDir, 'tool-calls.jsonl');
    mkdirSync(dest);
    writeFileSync(join(dest, 'nested.txt'), 'planted');

    restoreHookLogs(logDir, evalMetaDir);

    assert.equal(lstatSync(dest).isDirectory(), false);
    assert.equal(readFileSync(dest, 'utf8'), 'real log line\n');
  });

  it('restoreHookLogs removes an agent-planted directory when the real log is absent', () => {
    const logDir = mkdtempSync(join(tmpdir(), 'ws-logdir-'));
    const evalMetaDir = mkdtempSync(join(tmpdir(), 'ws-evalmeta-'));
    const dest = join(evalMetaDir, 'hook-events.ndjson');
    mkdirSync(dest);
    writeFileSync(join(dest, 'nested.txt'), 'planted');

    restoreHookLogs(logDir, evalMetaDir);

    assert.equal(existsSync(dest), false);
  });
});

describe('runVerify', () => {
  it('throws naming the verify script instead of returning an ordinary failed check on spawn error', () => {
    const scenario = mkdtempSync(join(tmpdir(), 'verify-scn-'));
    mkdirSync(join(scenario, 'hidden-checks'), { recursive: true });
    writeFileSync(join(scenario, 'hidden-checks', 'verify.mjs'), 'process.exit(0);');
    // An oversized workspaceDir argument makes the underlying spawn syscall itself fail
    // (E2BIG) rather than the verify script running and exiting non-zero.
    const oversizedWorkspace = 'x'.repeat(2_000_000);

    assert.throws(
      () => runVerify(scenario, oversizedWorkspace),
      /verify .*verify\.mjs.*failed to spawn/
    );
  });
});

describe('readToolCallLog', () => {
  it('throws naming the log path instead of silently discarding a malformed log', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'toolcalls-ws-'));
    const evalDir = join(workspace, '.eval');
    mkdirSync(evalDir, { recursive: true });
    writeFileSync(join(evalDir, 'tool-calls.jsonl'), 'not valid json\n');

    assert.throws(() => readToolCallLog(workspace), /tool-calls\.jsonl.*malformed/);
  });
});
