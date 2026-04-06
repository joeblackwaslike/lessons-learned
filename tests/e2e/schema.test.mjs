/**
 * E2E schema validation tests.
 *
 * Validates the hook output contract is well-formed regardless of which agent
 * produced the input. These tests catch schema regressions before they affect
 * production agents.
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

function payload(overrides = {}) {
  return JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'ls -la' },
    session_id: `schema-test-${Date.now()}`,
    agent_id: 'main',
    cwd: '/tmp',
    ...overrides,
  });
}

// ─── Empty output schema ───────────────────────────────────────────────────

describe('schema: empty output', () => {
  it('is exactly the string "{}"', async () => {
    const { stdout } = await run(HOOK_SCRIPT, {
      stdin: payload({ tool_input: { command: 'echo hello' } }),
      env: baseEnv,
    });
    assert.equal(stdout.trim(), '{}');
  });

  it('is valid JSON', async () => {
    const { stdout } = await run(HOOK_SCRIPT, {
      stdin: payload({ tool_input: { command: 'echo hello' } }),
      env: baseEnv,
    });
    assert.doesNotThrow(() => JSON.parse(stdout));
  });
});

// ─── Inject output schema ──────────────────────────────────────────────────

describe('schema: inject output', () => {
  it('is valid JSON', async () => {
    const { stdout } = await run(HOOK_SCRIPT, {
      stdin: payload({ tool_input: { command: 'grep "mock.patch(" tests/' } }),
      env: baseEnv,
    });
    assert.doesNotThrow(() => JSON.parse(stdout));
  });

  it('has hookSpecificOutput.additionalContext as a string', async () => {
    const { stdout } = await run(HOOK_SCRIPT, {
      stdin: payload({ tool_input: { command: 'grep "mock.patch(" tests/' } }),
      env: baseEnv,
    });
    const out = JSON.parse(stdout);
    assert.equal(typeof out.hookSpecificOutput?.additionalContext, 'string');
    assert.ok(out.hookSpecificOutput.additionalContext.length > 0);
  });

  it('has env.LESSONS_SEEN as a non-empty string', async () => {
    const { stdout } = await run(HOOK_SCRIPT, {
      stdin: payload({ tool_input: { command: 'grep "mock.patch(" tests/' } }),
      env: baseEnv,
    });
    const out = JSON.parse(stdout);
    assert.equal(typeof out.env?.LESSONS_SEEN, 'string');
    assert.ok(out.env.LESSONS_SEEN.length > 0);
  });

  it('contains no keys outside the known schema', async () => {
    const { stdout } = await run(HOOK_SCRIPT, {
      stdin: payload({ tool_input: { command: 'grep "mock.patch(" tests/' } }),
      env: baseEnv,
    });
    const out = JSON.parse(stdout);
    const knownKeys = new Set(['hookSpecificOutput', 'env']);
    for (const key of Object.keys(out)) {
      assert.ok(knownKeys.has(key), `unexpected top-level key: ${key}`);
    }
  });

  it('Codex platform produces same schema shape', async () => {
    const { stdout } = await run(HOOK_SCRIPT, {
      stdin: JSON.stringify({
        tool_name: 'shell',
        tool_input: { command: 'grep "mock.patch(" tests/' },
        session_id: `schema-codex-${Date.now()}`,
        agent_id: 'main',
        cwd: '/project',
      }),
      env: { ...baseEnv, LESSONS_AGENT_PLATFORM: 'codex' },
    });
    const out = JSON.parse(stdout);
    assert.ok(out.hookSpecificOutput?.additionalContext);
    assert.ok(out.env?.LESSONS_SEEN);
  });

  it('Gemini platform produces same schema shape', async () => {
    const { stdout } = await run(HOOK_SCRIPT, {
      stdin: JSON.stringify({
        tool_name: 'run_shell_command',
        tool_input: { command: 'grep "mock.patch(" tests/' },
        session_id: `schema-gemini-${Date.now()}`,
        agent_id: 'main',
        cwd: '/project',
      }),
      env: { ...baseEnv, LESSONS_AGENT_PLATFORM: 'gemini' },
    });
    const out = JSON.parse(stdout);
    assert.ok(out.hookSpecificOutput?.additionalContext);
    assert.ok(out.env?.LESSONS_SEEN);
  });
});

// ─── Block output schema ───────────────────────────────────────────────────

describe('schema: block output', () => {
  it('is valid JSON', async () => {
    const { stdout } = await run(HOOK_SCRIPT, {
      stdin: payload({ tool_input: { command: 'pytest tests/' } }),
      env: baseEnv,
    });
    assert.doesNotThrow(() => JSON.parse(stdout));
  });

  it('permissionDecision is exactly "deny" (not "block" or "reject")', async () => {
    const { stdout } = await run(HOOK_SCRIPT, {
      stdin: payload({ tool_input: { command: 'pytest tests/' } }),
      env: baseEnv,
    });
    const out = JSON.parse(stdout);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  });

  it('permissionDecisionReason is a non-empty string', async () => {
    const { stdout } = await run(HOOK_SCRIPT, {
      stdin: payload({ tool_input: { command: 'pytest tests/' } }),
      env: baseEnv,
    });
    const out = JSON.parse(stdout);
    const reason = out.hookSpecificOutput.permissionDecisionReason;
    assert.equal(typeof reason, 'string');
    assert.ok(reason.length > 0, 'blockReason must not be empty');
  });
});
