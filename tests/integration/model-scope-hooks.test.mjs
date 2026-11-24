/**
 * Integration tests: modelScope gates lessons in every hook that injects them.
 * The running model comes from LESSONS_LEARNED_MODEL, so each case runs the real hook
 * script as a subprocess against a temp manifest.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../helpers/subprocess.mjs';

const hooksDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks');
const sonnet4Only = [{ source: 'claude-sonnet-4', flags: 'i' }];

const lesson = (slug, type, extra = {}) => ({
  slug,
  type,
  priority: 9,
  toolNames: [],
  commandRegexSources: [],
  pathRegexSources: [],
  tags: [],
  summary: `${slug} summary`,
  message: `${slug} message`,
  modelScopeRegexSources: sonnet4Only,
  ...extra,
});

let dir;
let manifestPath;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'll-model-scope-'));
  manifestPath = join(dir, 'manifest.json');
  const lessons = {
    scopedhint: lesson('scopedhint', 'hint', {
      toolNames: ['Bash'],
      commandRegexSources: [{ source: 'scopedmarker', flags: '' }],
    }),
    scopeddirective: lesson('scopeddirective', 'directive'),
  };
  writeFileSync(
    manifestPath,
    JSON.stringify({ config: { sessionStartBudgetBytes: 20000 }, lessons })
  );
});

after(() => rmSync(dir, { recursive: true, force: true }));

const env = model => ({ LESSONS_MANIFEST_PATH: manifestPath, LESSONS_LEARNED_MODEL: model });

describe('modelScope in the PreToolUse hook', () => {
  const stdin = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'scopedmarker go' },
    session_id: `model-scope-${randomUUID()}`,
    cwd: '/tmp',
  });

  it('injects the lesson on a model inside its scope', async () => {
    const { stdout } = await run(join(hooksDir, 'pretooluse-lesson-inject.mjs'), {
      stdin,
      env: env('claude-sonnet-4-6'),
    });
    assert.match(stdout, /scopedhint message/);
  });

  it('suppresses the lesson on a model outside its scope', async () => {
    const { stdout } = await run(join(hooksDir, 'pretooluse-lesson-inject.mjs'), {
      stdin,
      env: env('claude-sonnet-5-5'),
    });
    assert.deepEqual(JSON.parse(stdout), {});
  });
});

describe('modelScope in the session-start hook', () => {
  const script = join(hooksDir, 'session-start-lesson-protocol.mjs');
  const stdin = JSON.stringify({ session_type: 'compact', cwd: '/tmp' });

  it('injects a scoped directive on a model inside its scope', async () => {
    const { stdout } = await run(script, { stdin, env: env('claude-sonnet-4-6') });
    assert.match(stdout, /scopeddirective/);
  });

  it('omits a scoped directive on a model outside its scope', async () => {
    const { stdout } = await run(script, { stdin, env: env('claude-sonnet-5-5') });
    assert.doesNotMatch(stdout, /scopeddirective/);
  });
});

describe('modelScope in the subagent-start hook', () => {
  const script = join(hooksDir, 'subagent-start-lesson-protocol.mjs');

  it('injects a scoped directive inside its scope and omits it outside', async () => {
    const inside = await run(script, { stdin: '{}', env: env('claude-sonnet-4-6') });
    const outside = await run(script, { stdin: '{}', env: env('claude-sonnet-5-5') });
    assert.match(inside.stdout, /scopeddirective/);
    assert.doesNotMatch(outside.stdout, /scopeddirective/);
  });
});
