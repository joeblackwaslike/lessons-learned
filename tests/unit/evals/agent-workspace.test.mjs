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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  collectArtifacts,
  ensureRealDir,
  readToolCallLog,
  restoreHookLogs,
  runVerify,
  writeRegularFile,
} from '../../../evals/lib/agent-workspace.mjs';

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
}

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

  it('counts an unparseable hook-events.ndjson line as a parse error', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'collect-ws-'));
    const scenario = mkdtempSync(join(tmpdir(), 'collect-scn-'));
    mkdirSync(join(workspace, '.eval'), { recursive: true });
    writeFileSync(
      join(workspace, '.eval', 'hook-events.ndjson'),
      '{"type":"PreToolUse","tool_name":"Bash"}\nnot valid json\n'
    );

    const artifacts = collectArtifacts(workspace, scenario);

    assert.equal(artifacts.parseErrors, 1);
    assert.equal(artifacts.hookEvents.length, 1);
  });

  it('counts a PARSE_ERROR record in tool-calls.jsonl as a parse error', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'collect-ws-'));
    const scenario = mkdtempSync(join(tmpdir(), 'collect-scn-'));
    mkdirSync(join(workspace, '.eval'), { recursive: true });
    // This is what eval-post-hook-shim.mjs writes to tool-calls.jsonl on malformed stdin.
    writeFileSync(
      join(workspace, '.eval', 'tool-calls.jsonl'),
      '{"type":"PARSE_ERROR","error":"boom"}\n'
    );

    const artifacts = collectArtifacts(workspace, scenario);

    assert.equal(artifacts.parseErrors, 1);
  });

  it('does not execute an agent-planted diff.external or core.fsmonitor hook', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'collect-ws-'));
    const scenario = mkdtempSync(join(tmpdir(), 'collect-scn-'));
    const marker = join(workspace, 'marker.txt');
    const hookScript = join(workspace, 'evil-hook.sh');
    writeFileSync(hookScript, `#!/bin/sh\necho pwned > "${marker}"\n`, { mode: 0o755 });

    git(workspace, ['init', '-q']);
    git(workspace, ['config', 'user.email', 'test@example.com']);
    git(workspace, ['config', 'user.name', 'Test']);
    writeFileSync(join(workspace, 'file.txt'), 'original\n');
    git(workspace, ['add', '.']);
    git(workspace, ['commit', '-q', '-m', 'init']);
    git(workspace, ['config', 'diff.external', hookScript]);
    git(workspace, ['config', 'core.fsmonitor', hookScript]);
    writeFileSync(join(workspace, 'file.txt'), 'changed\n');

    collectArtifacts(workspace, scenario);

    assert.equal(existsSync(marker), false);
  });

  it('propagates a failing workspace diff instead of treating it as empty', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'collect-ws-'));
    const scenario = mkdtempSync(join(tmpdir(), 'collect-scn-'));
    // A .git that is not a real repository makes `git diff` fail non-zero.
    mkdirSync(join(workspace, '.git'));

    assert.throws(() => collectArtifacts(workspace, scenario), /collect-artifacts.*exited/);
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

  it('restoreHookLogs does not copy through an agent-planted symlink at a hook-log source', () => {
    const logDir = mkdtempSync(join(tmpdir(), 'ws-logdir-'));
    const evalMetaDir = mkdtempSync(join(tmpdir(), 'ws-evalmeta-'));
    const secret = join(mkdtempSync(join(tmpdir(), 'ws-secret-')), 'credential');
    writeFileSync(secret, 'TOP SECRET');
    symlinkSync(secret, join(logDir, 'tool-calls.jsonl'));

    restoreHookLogs(logDir, evalMetaDir);

    assert.equal(existsSync(join(evalMetaDir, 'tool-calls.jsonl')), false);
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

describe('eval-post-hook-shim', () => {
  const SHIM = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'evals',
    'scripts',
    'eval-post-hook-shim.mjs'
  );

  it('records a PARSE_ERROR in tool-calls.jsonl instead of silently discarding malformed stdin', () => {
    const logDir = mkdtempSync(join(tmpdir(), 'post-hook-'));
    const result = spawnSync('node', [SHIM], {
      input: 'not valid json',
      encoding: 'utf8',
      env: { ...process.env, EVAL_LOG_DIR: logDir },
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '{}');
    const logPath = join(logDir, 'tool-calls.jsonl');
    assert.ok(existsSync(logPath));
    const record = JSON.parse(readFileSync(logPath, 'utf8').trim());
    assert.equal(record.type, 'PARSE_ERROR');

    // The resulting telemetry gap makes collectArtifacts report a nonzero parseErrors
    // count, which is what makes claude-agent.mjs treat the trial as uncacheable.
    const workspace = mkdtempSync(join(tmpdir(), 'post-hook-ws-'));
    mkdirSync(join(workspace, '.eval'), { recursive: true });
    writeFileSync(join(workspace, '.eval', 'tool-calls.jsonl'), readFileSync(logPath, 'utf8'));
    const scenario = mkdtempSync(join(tmpdir(), 'post-hook-scn-'));
    const artifacts = collectArtifacts(workspace, scenario);
    assert.ok(artifacts.parseErrors > 0);
  });
});
