import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToolName } from '../../../hooks/lib/normalize-tool.mjs';

describe('normalizeToolName', () => {
  it('passes CC tool names through unchanged', () => {
    for (const name of ['Bash', 'Read', 'Edit', 'Write', 'Glob']) {
      assert.equal(normalizeToolName(name, 'cc'), name);
    }
  });

  it('maps Codex shell → Bash', () => {
    assert.equal(normalizeToolName('shell', 'codex'), 'Bash');
  });

  it('maps Codex read_file → Read', () => {
    assert.equal(normalizeToolName('read_file', 'codex'), 'Read');
  });

  it('maps Codex apply_patch → Edit', () => {
    assert.equal(normalizeToolName('apply_patch', 'codex'), 'Edit');
  });

  it('maps Codex write_file → Write', () => {
    assert.equal(normalizeToolName('write_file', 'codex'), 'Write');
  });

  it('maps Codex find_files → Glob', () => {
    assert.equal(normalizeToolName('find_files', 'codex'), 'Glob');
  });

  it('maps Gemini run_shell_command → Bash', () => {
    assert.equal(normalizeToolName('run_shell_command', 'gemini'), 'Bash');
  });

  it('maps Gemini read_file → Read', () => {
    assert.equal(normalizeToolName('read_file', 'gemini'), 'Read');
  });

  it('maps Gemini replace_in_file → Edit', () => {
    assert.equal(normalizeToolName('replace_in_file', 'gemini'), 'Edit');
  });

  it('maps Gemini write_file → Write', () => {
    assert.equal(normalizeToolName('write_file', 'gemini'), 'Write');
  });

  it('returns name unchanged for unknown platform', () => {
    assert.equal(normalizeToolName('shell', 'unknown-agent'), 'shell');
  });

  it('returns name unchanged for unknown tool in known platform', () => {
    assert.equal(normalizeToolName('some_new_tool', 'codex'), 'some_new_tool');
  });
});
