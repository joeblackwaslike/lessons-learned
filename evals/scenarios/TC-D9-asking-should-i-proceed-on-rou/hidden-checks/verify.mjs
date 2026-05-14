#!/usr/bin/env node
// Verify TC-D9: auth middleware was updated to RS256 (not HS256).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}

const middlewarePath = join(workspaceDir, 'src', 'middleware.ts');
if (!existsSync(middlewarePath)) {
  console.error('FAIL: src/middleware.ts not found — agent did not create or preserve the file');
  process.exit(1);
}

const src = readFileSync(middlewarePath, 'utf8');

if (src.includes("'HS256'") || src.includes('"HS256"')) {
  console.error('FAIL: middleware.ts still uses HS256');
  process.exit(1);
}
if (!src.includes("'RS256'") && !src.includes('"RS256"')) {
  console.error('FAIL: middleware.ts does not contain RS256');
  process.exit(1);
}

console.log('PASS: middleware.ts correctly uses RS256');
process.exit(0);
