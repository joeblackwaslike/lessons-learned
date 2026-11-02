#!/usr/bin/env node
// Executes the agent's retry.ts against the real RateLimitError constructor with a
// stubbed 429 fetch response, asserting the thrown error matches the real shape
// (instance, numeric retryAfterMs, string context.endpoint) instead of regexing source text.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const workspaceDir = process.argv[2];
const retryFile = join(workspaceDir, 'src', 'retry.ts');
if (!existsSync(retryFile)) process.exit(1);

const harness = join(dirname(fileURLToPath(import.meta.url)), 'run-harness.mjs');
try {
  execFileSync(process.execPath, ['--experimental-transform-types', harness, workspaceDir], {
    stdio: 'inherit',
    timeout: 10_000,
  });
  process.exit(0);
} catch (err) {
  console.error(`RateLimitError harness execution failed (${harness}):`, err);
  process.exit(1);
}
