/**
 * E2E tests: Gemini CLI tool name protocol.
 *
 * Gemini uses its own tool name set for equivalent operations. The hook normalizes
 * them via LESSONS_AGENT_PLATFORM=gemini.
 *
 * Gemini → CC mapping:
 *   run_shell_command → Bash
 *   read_file         → Read
 *   write_file        → Write
 *   replace_in_file   → Edit
 *   find_files        → Glob
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
  LESSONS_AGENT_PLATFORM: 'gemini',
};

function payload(toolName, toolInput) {
  return JSON.stringify({
    tool_name: toolName,
    tool_input: toolInput,
    session_id: `e2e-gemini-${Date.now()}`,
    agent_id: 'main',
    cwd: '/project',
  });
}

describe('Gemini: run_shell_command → Bash matching', () => {
  it('run_shell_command with mock.patch grep triggers injection', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: payload('run_shell_command', { command: 'grep "mock.patch(" tests/' }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    const out = JSON.parse(stdout);
    assert.ok(
      out.hookSpecificOutput?.additionalContext,
      'expected injection for run_shell_command'
    );
  });

  it('run_shell_command with pytest triggers block', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: payload('run_shell_command', { command: 'pytest tests/' }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    assert.equal(JSON.parse(stdout).hookSpecificOutput?.permissionDecision, 'deny');
  });
});

describe('Gemini: replace_in_file → Edit matching', () => {
  it('replace_in_file on test .py file triggers injection', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: payload('replace_in_file', { file_path: '/project/tests/test_service.py' }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    const out = JSON.parse(stdout);
    assert.ok(out.hookSpecificOutput?.additionalContext);
  });
});

describe('Gemini: write_file → Write matching', () => {
  it('write_file on test .py file triggers injection', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: payload('write_file', { file_path: '/project/tests/test_new.py' }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    const out = JSON.parse(stdout);
    assert.ok(out.hookSpecificOutput?.additionalContext);
  });
});

describe('Gemini: unknown tool', () => {
  it('unknown Gemini tool returns {}', async () => {
    const { stdout, exitCode } = await run(HOOK_SCRIPT, {
      stdin: payload('list_directory', { path: '.' }),
      env: baseEnv,
    });
    assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(stdout), {});
  });
});
