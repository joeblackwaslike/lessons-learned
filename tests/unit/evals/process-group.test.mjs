import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcessGroup } from '../../../evals/lib/process-group.mjs';

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('runProcessGroup', () => {
  it('a timeout kills a backgrounded grandchild, not just the direct child', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'process-group-'));
    const pidFile = join(dir, 'child.pid');
    const result = await runProcessGroup(
      'bash',
      ['-c', `sleep 30 & echo $! > ${pidFile}; sleep 30`],
      { cwd: dir, env: process.env, timeout: 300, maxBuffer: 10_000_000 }
    );
    assert.equal(result.timedOut, true);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    for (let i = 0; i < 50 && isAlive(pid); i++) await new Promise(res => setTimeout(res, 100));
    assert.equal(isAlive(pid), false, `background grandchild ${pid} survived the timeout`);
  });

  it('a child ignoring SIGTERM is escalated to SIGKILL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'process-group-'));
    const result = await runProcessGroup(
      'bash',
      ['-c', "trap '' TERM; sleep 30"],
      { cwd: dir, env: process.env, timeout: 300, maxBuffer: 10_000_000 }
    );
    assert.equal(result.timedOut, true);
    assert.equal(result.signal, 'SIGKILL');
  });

  it('output over maxBuffer sets overflow and bounds captured output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'process-group-'));
    const maxBuffer = 1_000;
    const result = await runProcessGroup(
      'bash',
      ['-c', 'yes aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | head -c 5000000'],
      { cwd: dir, env: process.env, timeout: 30_000, maxBuffer }
    );
    assert.equal(result.overflow, true);
    assert.equal(result.timedOut, false);
    assert.ok(
      result.stdout.length <= maxBuffer,
      `stdout (${result.stdout.length} bytes) exceeded maxBuffer (${maxBuffer})`
    );
  });
});
