/**
 * Integration tests: pretooluse-lesson-inject.mjs as a subprocess.
 *
 * Pipes JSON to the hook via stdin, asserts on stdout JSON.
 * Uses LESSONS_MANIFEST_PATH to point at the minimal-manifest fixture.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../helpers/subprocess.mjs';
import { fixturePath } from '../helpers/fixtures.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..', '..');
const HOOK_SCRIPT = join(PLUGIN_ROOT, 'hooks', 'pretooluse-lesson-inject.mjs');
const MANIFEST = fixturePath('minimal-manifest.json');

// ENV base: point all invocations at the fixture manifest
const baseEnv = { LESSONS_MANIFEST_PATH: MANIFEST };

function makePayload(overrides = {}) {
  return JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'ls -la' },
    session_id: `test-${Date.now()}-${Math.random()}`,
    agent_id: 'main',
    cwd: '/tmp',
    ...overrides,
  });
}

// ─── Non-matching command ──────────────────────────────────────────────────

describe('hook pipeline: no match', () => {
  it('returns exactly {} for a non-matching command', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: makePayload({ tool_input: { command: 'ls -la' } }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0, `non-zero exit: ${stdout}`);
    const out = JSON.parse(stdout);
    assert.deepEqual(out, {});
  });

  it('returns {} for malformed stdin', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: '{not json}',
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(stdout), {});
  });

  it('returns {} for missing manifest path', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: makePayload({ tool_input: { command: 'pytest tests/' } }),
      env: { LESSONS_MANIFEST_PATH: '/nonexistent/path/manifest.json' },
    });
    assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(stdout), {});
  });
});

// ─── Blocking lesson ───────────────────────────────────────────────────────

describe('hook pipeline: blocking lesson', () => {
  it('returns permissionDecision: deny for a blocked command', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: makePayload({ tool_input: { command: 'pytest tests/' } }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    const out = JSON.parse(stdout);
    assert.ok(out.hookSpecificOutput, 'expected hookSpecificOutput');
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(
      typeof out.hookSpecificOutput.permissionDecisionReason === 'string' &&
        out.hookSpecificOutput.permissionDecisionReason.length > 0,
      'expected non-empty reason'
    );
  });

  it('block reason contains the original command', async () => {
    const cmd = 'pytest tests/ -v';
    const { stdout } = await run(HOOK_SCRIPT, {
      stdin: makePayload({ tool_input: { command: cmd } }),
      env: baseEnv,
    });
    const out = JSON.parse(stdout);
    assert.ok(
      out.hookSpecificOutput.permissionDecisionReason.includes('pytest'),
      'reason should reference the command'
    );
  });
});

// ─── Injecting lesson ──────────────────────────────────────────────────────

describe('hook pipeline: injection', () => {
  it('injects additionalContext for a matching non-blocking command', async () => {
    // mock.patch lesson matches "mock.patch(" in Bash command
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: makePayload({ tool_input: { command: 'grep -r "mock.patch(" tests/' } }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    const out = JSON.parse(stdout);
    assert.ok(out.hookSpecificOutput?.additionalContext, 'expected additionalContext');
    assert.ok(
      out.hookSpecificOutput.additionalContext.includes('mock.patch'),
      'additionalContext should contain lesson text'
    );
  });

  it('includes lessonInjection metadata comment in additionalContext', async () => {
    const { stdout } = await run(HOOK_SCRIPT, {
      stdin: makePayload({ tool_input: { command: 'grep "mock.patch(" src/' } }),
      env: baseEnv,
    });
    const out = JSON.parse(stdout);
    const ctx = out.hookSpecificOutput?.additionalContext ?? '';
    assert.ok(ctx.includes('<!-- lessonInjection:'), 'metadata comment missing');
    const match = ctx.match(/<!-- lessonInjection: (.+?) -->/);
    assert.ok(match, 'metadata comment malformed');
    const meta = JSON.parse(match[1]);
    assert.equal(meta.version, 1);
    assert.ok(Array.isArray(meta.injected));
  });

  it('sets env.LESSONS_SEEN in output', async () => {
    const { stdout } = await run(HOOK_SCRIPT, {
      stdin: makePayload({ tool_input: { command: 'grep "mock.patch(" src/' } }),
      env: baseEnv,
    });
    const out = JSON.parse(stdout);
    assert.ok(out.env?.LESSONS_SEEN, 'expected env.LESSONS_SEEN');
    assert.ok(out.env.LESSONS_SEEN.includes('mock-patch-namespace-test'));
  });

  it('returns {} when slug already in LESSONS_SEEN', async () => {
    const { stdout } = await run(HOOK_SCRIPT, {
      stdin: makePayload({ tool_input: { command: 'grep "mock.patch(" src/' } }),
      env: { ...baseEnv, LESSONS_SEEN: 'mock-patch-namespace-test' },
    });
    assert.deepEqual(JSON.parse(stdout), {});
  });

  it('matches Read tool by file path pattern', async () => {
    // mock-patch lesson has pathRegexSources matching test*.py
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: '/project/tests/test_auth.py' },
        session_id: `test-${Date.now()}`,
        agent_id: 'main',
        cwd: '/project',
      }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    const out = JSON.parse(stdout);
    assert.ok(out.hookSpecificOutput?.additionalContext, 'expected injection for test .py file');
  });
});
