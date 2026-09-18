import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, '..', 'config.json'), 'utf8'));

test('config has no placeholder values', () => {
  assert.ok(!String(config.host).includes('TODO'), `host should not contain TODO, got: ${config.host}`);
  assert.ok(!String(config.port).includes('TODO'), `port should not contain TODO, got: ${config.port}`);
  assert.ok(!String(config.name).includes('TODO'), `name should not contain TODO, got: ${config.name}`);

  assert.equal(String(config.host), 'api.example.com', `host should be api.example.com, got: ${config.host}`);
  assert.equal(String(config.port), '443', `port should be 443, got: ${config.port}`);
  assert.equal(String(config.name), 'my-app', `name should be my-app, got: ${config.name}`);
});
