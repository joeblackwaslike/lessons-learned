import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parsePayload } from '../../../hooks/lib/stdin.mjs';

// Save/restore LESSONS_AGENT_PLATFORM across tests
let savedPlatform;
beforeEach(() => {
  savedPlatform = process.env.LESSONS_AGENT_PLATFORM;
});
afterEach(() => {
  if (savedPlatform === undefined) {
    delete process.env.LESSONS_AGENT_PLATFORM;
  } else {
    process.env.LESSONS_AGENT_PLATFORM = savedPlatform;
  }
});

function makePayload(overrides = {}) {
  return JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'pytest tests/' },
    session_id: 'sess-001',
    agent_id: 'main',
    cwd: '/project',
    ...overrides,
  });
}

describe('parsePayload', () => {
  it('parses a valid Bash payload', () => {
    const result = parsePayload(makePayload());
    assert.equal(result.toolName, 'Bash');
    assert.equal(result.toolInput.command, 'pytest tests/');
    assert.equal(result.sessionId, 'sess-001');
    assert.equal(result.agentId, 'main');
    assert.equal(result.cwd, '/project');
  });

  it('returns null for empty string', () => {
    assert.equal(parsePayload(''), null);
  });

  it('returns null for whitespace-only string', () => {
    assert.equal(parsePayload('   \n'), null);
  });

  it('returns null for invalid JSON', () => {
    assert.equal(parsePayload('{not json}'), null);
  });

  it('returns null for missing tool_name', () => {
    const raw = JSON.stringify({ tool_input: { command: 'ls' }, session_id: 'x' });
    assert.equal(parsePayload(raw), null);
  });

  it('returns null for unsupported tool name (cc platform)', () => {
    const raw = makePayload({ tool_name: 'WebSearch' });
    assert.equal(parsePayload(raw), null);
  });

  it('accepts Read, Edit, Write, Glob tool names', () => {
    for (const tool of ['Read', 'Edit', 'Write', 'Glob']) {
      const raw = makePayload({ tool_name: tool });
      const result = parsePayload(raw);
      assert.equal(result?.toolName, tool, `Expected ${tool} to be accepted`);
    }
  });

  it('uses defaults for missing optional fields', () => {
    const raw = JSON.stringify({ tool_name: 'Bash', tool_input: {} });
    const result = parsePayload(raw);
    assert.equal(result.sessionId, '');
    assert.equal(result.agentId, 'main');
    assert.equal(result.cwd, '');
  });

  it('normalizes Codex shell → Bash via LESSONS_AGENT_PLATFORM=codex', () => {
    process.env.LESSONS_AGENT_PLATFORM = 'codex';
    const raw = makePayload({ tool_name: 'shell' });
    const result = parsePayload(raw);
    assert.equal(result?.toolName, 'Bash');
  });

  it('normalizes Gemini run_shell_command → Bash via LESSONS_AGENT_PLATFORM=gemini', () => {
    process.env.LESSONS_AGENT_PLATFORM = 'gemini';
    const raw = makePayload({ tool_name: 'run_shell_command' });
    const result = parsePayload(raw);
    assert.equal(result?.toolName, 'Bash');
  });

  it('returns null for unsupported Codex tool with unknown mapping', () => {
    process.env.LESSONS_AGENT_PLATFORM = 'codex';
    const raw = makePayload({ tool_name: 'view_diff' });
    assert.equal(parsePayload(raw), null);
  });
});
