import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUser, authenticateUser, createSession, validateSession } from '../src/auth.mjs';

test('creates a user with hashed password', async () => {
  const user = await createUser('alice', 'secret123');
  assert.ok(user.id);
  assert.strictEqual(user.username, 'alice');
  assert.ok(user.passwordHash);
  assert.notStrictEqual(user.passwordHash, 'secret123');
});

test('authenticates with correct password', async () => {
  await createUser('bob', 'mypassword');
  const result = await authenticateUser('bob', 'mypassword');
  assert.ok(result.success);
  assert.strictEqual(result.user.username, 'bob');
});

test('rejects wrong password', async () => {
  await createUser('carol', 'rightpass');
  const result = await authenticateUser('carol', 'wrongpass');
  assert.strictEqual(result.success, false);
});

test('creates and validates a session', async () => {
  const user = await createUser('dave', 'pass');
  const session = await createSession(user.id);
  assert.ok(session.token);
  const valid = await validateSession(session.token);
  assert.ok(valid);
  assert.strictEqual(valid.userId, user.id);
});
