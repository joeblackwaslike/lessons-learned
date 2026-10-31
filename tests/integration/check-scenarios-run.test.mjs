/**
 * Integration test: the pre-push eval gate (`check-scenarios-run.mjs --new-only`).
 *
 * The script resolves everything relative to its own location, so the test copies it into a
 * throwaway git repo that has an `origin/main` ref one commit behind HEAD.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATE_SCRIPT = join(__dirname, '..', '..', 'scripts', 'check-scenarios-run.mjs');

let root;

afterEach(() => root && rmSync(root, { recursive: true, force: true }));

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function writeScenario(id) {
  mkdirSync(join(root, 'evals', 'scenarios', id), { recursive: true });
  // distinct content per id keeps git from reporting the swap as a rename
  writeFileSync(join(root, 'evals', 'scenarios', id, 'scenario.json'), JSON.stringify({ id }));
}

function setupSwappedScenarios(receiptIds) {
  root = mkdtempSync(join(tmpdir(), 'gate-'));
  mkdirSync(join(root, 'scripts'));
  copyFileSync(GATE_SCRIPT, join(root, 'scripts', 'check-scenarios-run.mjs'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeScenario('TC-OLD');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('remote', 'add', 'origin', root);
  git('config', 'branch.main.remote', 'origin');
  git('config', 'branch.main.merge', 'refs/heads/main');

  git('rm', '-rq', 'evals/scenarios/TC-OLD');
  writeScenario('TC-NEW');
  git('add', '-A');
  git('commit', '-qm', 'swap scenarios');
  mkdirSync(join(root, 'evals', 'results', 'cache'), { recursive: true });
  writeFileSync(
    join(root, 'evals', 'results', 'cache', 'latest-run.json'),
    JSON.stringify({
      results: { results: receiptIds.map(scenarioId => ({ vars: { scenarioId } })) },
    })
  );
}

function runGate() {
  return spawnSync('node', ['scripts/check-scenarios-run.mjs', '--new-only', '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
}

describe('check-scenarios-run --new-only', () => {
  it('ignores scenarios deleted in the push', () => {
    setupSwappedScenarios(['TC-NEW']);

    const res = runGate();

    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.deepEqual(JSON.parse(res.stdout).unrun, []);
  });

  it('still blocks when a surviving new scenario has not been run', () => {
    setupSwappedScenarios([]);

    const res = runGate();

    assert.equal(res.status, 1);
    assert.deepEqual(JSON.parse(res.stdout).unrun, ['TC-NEW']);
  });
});
