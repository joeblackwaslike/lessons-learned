import { chmodSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FAKE_CLAUDE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'evals',
  'fake-claude.sh'
);

/**
 * Write an executable `claude` into `dir` that exports `env` and runs the fake-claude
 * fixture. The provider passes the agent only an allowlisted env, so the fixture's
 * FAKE_CLAUDE_* settings travel inside the wrapper instead.
 */
export function makeFakeClaude(dir, env = {}) {
  const bin = join(dir, 'claude');
  const exports = Object.entries(env).map(([k, v]) => `export ${k}='${v}'`);
  writeFileSync(bin, ['#!/bin/sh', ...exports, `exec '${FAKE_CLAUDE}' "$@"`, ''].join('\n'));
  chmodSync(bin, 0o755);
  return bin;
}
