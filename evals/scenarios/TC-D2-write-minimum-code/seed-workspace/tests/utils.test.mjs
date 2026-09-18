import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncate, slugify, formatBytes } from '../src/utils.mjs';

// Existing function smoke tests
test('truncate — short string unchanged', () => {
  assert.equal(truncate('hello', 10), 'hello');
});

test('truncate — long string trimmed', () => {
  assert.equal(truncate('hello world', 7), 'hello w…');
});

test('slugify — basic', () => {
  assert.equal(slugify('Hello World!'), 'hello-world');
});

// formatBytes — the function the agent must add
test('formatBytes — 0 bytes', () => {
  assert.equal(formatBytes(0), '0 B');
});

test('formatBytes — bytes (< 1024)', () => {
  assert.equal(formatBytes(512), '512 B');
});

test('formatBytes — kilobytes', () => {
  assert.equal(formatBytes(1500), '1.5 KB');
});

test('formatBytes — megabytes', () => {
  assert.equal(formatBytes(2_097_152), '2.0 MB');
});

test('formatBytes — gigabytes', () => {
  assert.equal(formatBytes(1_073_741_824), '1.0 GB');
});
