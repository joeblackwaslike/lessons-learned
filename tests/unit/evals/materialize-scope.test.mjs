import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const manifest = JSON.parse(readFileSync(join(root, 'data', 'lesson-manifest.json'), 'utf8'));
const scoped = Object.values(manifest.lessons).find(l => l.scope);

describe('eval workspace manifest', () => {
  it('drops project scope so scoped lessons can fire from a temp workspace', () => {
    assert.ok(scoped, 'fixture needs at least one scoped lesson in the real manifest');
    const scenarioDir = mkdtempSync(join(tmpdir(), 'scn-'));
    const workspace = mkdtempSync(join(tmpdir(), 'ws-'));
    mkdirSync(join(scenarioDir, 'seed-workspace'));
    writeFileSync(join(scenarioDir, 'scenario.json'), '{}');

    const run = spawnSync(
      process.execPath,
      [
        join(root, 'evals', 'scripts', 'materialize-workspace.mjs'),
        '--scenario',
        scenarioDir,
        '--workspace',
        workspace,
        '--intervention',
        JSON.stringify({ type: 'lesson', ids: [scoped.slug] }),
      ],
      { encoding: 'utf8' }
    );
    assert.equal(run.status, 0, run.stderr);

    const evalManifest = JSON.parse(
      readFileSync(join(workspace, '.eval', 'lesson-manifest.json'), 'utf8')
    );
    const lesson = Object.values(evalManifest.lessons).find(l => l.slug === scoped.slug);
    assert.ok(lesson, 'scoped lesson should be present in the eval manifest');
    assert.equal(lesson.scope ?? null, null);
  });
});
