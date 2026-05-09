import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(__dirname, '..', 'hooks', 'inject.mjs');

function runHook(toolName, command = '') {
  const input = JSON.stringify({ tool_name: toolName, tool_input: { command } });
  return spawnSync(process.execPath, ['--no-warnings', HOOK], {
    input,
    encoding: 'utf8',
  });
}

test('fires on Bash', () => {
  const result = runHook('Bash', 'ls -la');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('lesson-inject'));
});

test('fires on Edit', () => {
  const result = runHook('Edit');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('lesson-inject'));
});

test('fires on Read', () => {
  const result = runHook('Read');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('lesson-inject'));
});

test('does not fire on unknown tool', () => {
  const result = runHook('UnknownTool');
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
});
