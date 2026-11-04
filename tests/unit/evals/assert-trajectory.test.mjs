import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assertTrajectory from '../../../evals/scripts/assert-trajectory.mjs';

function scenarioDirWith(trajectoryAssertions) {
  const dir = mkdtempSync(join(tmpdir(), 'assert-traj-'));
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify({ trajectoryAssertions }));
  return dir;
}

function contextWith(scenarioDir, artifacts) {
  return {
    vars: { scenarioDir },
    providerResponse: { metadata: { artifacts } },
  };
}

describe('assertTrajectory', () => {
  it('fails when a forbidden assertion is defined but trajectory telemetry is missing', () => {
    const dir = scenarioDirWith([{ type: 'forbidden', tool: 'Bash', commandMatch: 'rm -rf' }]);
    const result = assertTrajectory('output', contextWith(dir, undefined));
    assert.equal(result.pass, false);
    assert.match(result.reason, /telemetry is missing/);
  });

  it('fails when telemetry has parse errors, even with an empty trajectory', () => {
    const dir = scenarioDirWith([{ type: 'forbidden', tool: 'Bash', commandMatch: 'rm -rf' }]);
    const result = assertTrajectory('output', contextWith(dir, { trajectory: [], parseErrors: 1 }));
    assert.equal(result.pass, false);
    assert.match(result.reason, /evidence is incomplete/);
  });

  it('passes a required assertion when the matching event is present', () => {
    const dir = scenarioDirWith([{ type: 'required', tool: 'Bash', commandMatch: 'echo' }]);
    const trajectory = [{ tool: 'Bash', command: 'echo hi' }];
    const result = assertTrajectory('output', contextWith(dir, { trajectory, parseErrors: 0 }));
    assert.equal(result.pass, true);
  });

  it('fails with a clear message instead of throwing on an invalid regex', () => {
    const dir = scenarioDirWith([{ type: 'required', tool: 'Bash', commandMatch: '(' }]);
    const trajectory = [{ tool: 'Bash', command: 'echo hi' }];
    const result = assertTrajectory('output', contextWith(dir, { trajectory, parseErrors: 0 }));
    assert.equal(result.pass, false);
    assert.match(result.reason, /Invalid commandMatch regex/);
  });

  it('fails a forbidden assertion with an invalid regex even on an empty trajectory', () => {
    const dir = scenarioDirWith([{ type: 'forbidden', tool: 'Bash', commandMatch: '(' }]);
    const result = assertTrajectory('output', contextWith(dir, { trajectory: [], parseErrors: 0 }));
    assert.equal(result.pass, false);
    assert.match(result.reason, /Invalid commandMatch regex/);
  });
});
