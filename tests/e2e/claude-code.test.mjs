/**
 * E2E tests: Claude Code protocol round-trips.
 *
 * Validates the canonical CC tool names and output schema.
 * This is the baseline protocol all other agents are normalized to.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../helpers/subprocess.mjs';
import { fixturePath } from '../helpers/fixtures.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_SCRIPT = join(__dirname, '..', '..', 'hooks', 'pretooluse-lesson-inject.mjs');
const MANIFEST = fixturePath('minimal-manifest.json');

const baseEnv = { LESSONS_MANIFEST_PATH: MANIFEST };

function payload(toolName, toolInput) {
  return JSON.stringify({
    tool_name: toolName,
    tool_input: toolInput,
    session_id: `e2e-cc-${Date.now()}`,
    agent_id: 'main',
    cwd: '/project',
  });
}

describe('Claude Code: Bash inject', () => {
  it('mock.patch grep command injects a lesson', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: payload('Bash', { command: 'grep "mock.patch(" tests/' }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    const out = JSON.parse(stdout);
    assert.ok(out.hookSpecificOutput?.additionalContext, 'expected additionalContext');
  });
});

describe('Claude Code: Bash block', () => {
  it('bare pytest is blocked', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: payload('Bash', { command: 'pytest tests/' }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    const out = JSON.parse(stdout);
    assert.equal(out.hookSpecificOutput?.permissionDecision, 'deny');
  });
});

describe('Claude Code: Edit inject (file path match)', () => {
  it('editing a test .py file injects the mock-patch lesson', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: payload('Edit', { file_path: '/project/tests/test_service.py' }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    const out = JSON.parse(stdout);
    assert.ok(out.hookSpecificOutput?.additionalContext);
  });
});

describe('Claude Code: no match', () => {
  it('unrelated Bash command returns exactly {}', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: payload('Bash', { command: 'echo hello' }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(stdout), {});
  });

  it('Glob tool (no lesson for it) returns {}', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: payload('Glob', { pattern: '**/*.py' }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(stdout), {});
  });
});
