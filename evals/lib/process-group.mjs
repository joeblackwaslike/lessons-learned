/**
 * Run an agent CLI in its own process group so a timeout, an output overflow, or a
 * normal exit can take down everything it started (background servers, sleeps, test
 * watchers), not just the direct child.
 */

import { spawn } from 'node:child_process';

const KILL_GRACE_MS = 3_000;
const DRAIN_MS = 2_000;

function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    /* group already gone */
  }
}

/**
 * Spawn `command args` detached (new process group) with stdin closed. On timeout or when
 * stdout+stderr exceed `maxBuffer` bytes, the group gets SIGTERM, then SIGKILL after a
 * grace period. Whatever is left of the group is killed once the leader exits.
 * @returns {Promise<{ status: number | null, signal: string | null, stdout: string,
 *   stderr: string, timedOut: boolean, overflow: boolean }>}
 */
export function runProcessGroup(command, args, { cwd, env, timeout, maxBuffer }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = { stdout: [], stderr: [] };
    let bytes = 0;
    let timedOut = false;
    let overflow = false;
    let killTimer = null;
    let drainTimer = null;
    let settled = false;

    const stop = () => {
      if (killTimer) return;
      killGroup(child.pid, 'SIGTERM');
      killTimer = setTimeout(() => {
        killGroup(child.pid, 'SIGKILL');
        drainTimer = setTimeout(() => finish(null, 'SIGKILL'), DRAIN_MS);
      }, KILL_GRACE_MS);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeout);

    for (const name of /** @type {const} */ (['stdout', 'stderr'])) {
      child[name].on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBuffer) {
          overflow = true;
          stop();
          return;
        }
        out[name].push(chunk);
      });
    }

    function finish(status, signal) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(drainTimer);
      killGroup(child.pid, 'SIGKILL');
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({
        status,
        signal,
        stdout: Buffer.concat(out.stdout).toString('utf8'),
        stderr: Buffer.concat(out.stderr).toString('utf8'),
        timedOut,
        overflow,
      });
    }

    child.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    // Stragglers would hold the pipes open and delay 'close' until the timeout.
    child.on('exit', () => killGroup(child.pid, 'SIGKILL'));
    child.on('close', (status, signal) => finish(status, signal));
  });
}
