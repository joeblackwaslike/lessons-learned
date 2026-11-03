import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectArtifacts } from '../../../evals/lib/agent-workspace.mjs';

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
