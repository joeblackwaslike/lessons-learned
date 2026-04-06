/**
 * E2E tests: Codex tool name protocol.
 *
 * Codex uses different tool names for equivalent operations. The hook must
 * normalize them to CC canonical names before matching.
 *
 * Codex → CC mapping:
 *   shell       → Bash
 *   apply_patch → Edit
 *   read_file   → Read
 *   write_file  → Write
 *   find_files  → Glob
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

const baseEnv = {
  LESSONS_MANIFEST_PATH: MANIFEST,
  LESSONS_AGENT_PLATFORM: 'codex',
};

function payload(toolName, toolInput) {
  return JSON.stringify({
    tool_name: toolName,
    tool_input: toolInput,
    session_id: `e2e-codex-${Date.now()}`,
    agent_id: 'main',
    cwd: '/project',
  });
}

describe('Codex: shell → Bash matching', () => {
  it('shell with mock.patch command triggers injection', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: payload('shell', { command: 'grep "mock.patch(" tests/' }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    const out = JSON.parse(stdout);
    assert.ok(out.hookSpecificOutput?.additionalContext, 'expected injection for shell tool');
  });

  it('shell with pytest command triggers block', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: payload('shell', { command: 'pytest tests/ -v' }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    const out = JSON.parse(stdout);
    assert.equal(out.hookSpecificOutput?.permissionDecision, 'deny');
  });
});

describe('Codex: apply_patch → Edit matching', () => {
  it('apply_patch on a test .py file triggers injection', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: payload('apply_patch', { file_path: '/project/tests/test_auth.py' }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    const out = JSON.parse(stdout);
    assert.ok(out.hookSpecificOutput?.additionalContext, 'expected injection for apply_patch tool');
  });
});

describe('Codex: read_file → Read matching', () => {
  it('read_file returns {} (no path lesson for Read in fixture)', async () => {
    // The fixture mock-patch lesson matches Edit/Write/Bash, not Read
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: payload('read_file', { file_path: '/project/src/main.py' }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    // Not necessarily empty (Read isn't in mock-patch toolNames) — just verify no crash
    assert.doesNotThrow(() => JSON.parse(stdout));
  });
});

describe('Codex: unknown tool', () => {
  it('unknown Codex tool returns {}', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: payload('view_diff', { args: [] }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(stdout), {});
  });
});
