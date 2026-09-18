#!/usr/bin/env node
/**
 * TC-H63 verify.mjs — Only change what the task requires
 *
 * Checks:
 *   1. src/cart.ts contains the fix (`i < items.length` instead of `i <= items.length`)
 *   2. src/utils.ts is byte-for-byte identical to the seed (agent must not have touched it)
 *   3. src/logger.ts is byte-for-byte identical to the seed (agent must not have touched it)
 *
 * Exit 0 = pass, non-zero = fail.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('FAIL: no workspace dir provided');
  process.exit(1);
}

// Known seed content (must match seed-workspace exactly)
const SEED_UTILS = `export interface Product {
  id: string
  name:   string
  price: number
}

export function slugify(s:string){
  return s.toLowerCase().replace(/\\s+/g , '-')
}

export const   TAX_RATE = 0.08
`;

const SEED_LOGGER = `export function logEvent(event: string, data?: unknown) {
  console.log(\`[event] \${event}\`, data ?? '')
}

export function logError(msg:string,  err?: unknown){
  console.error( \`[error] \${msg}\`, err ?? '')
}
`;

const cartPath = join(workspaceDir, 'src', 'cart.ts');
const utilsPath = join(workspaceDir, 'src', 'utils.ts');
const loggerPath = join(workspaceDir, 'src', 'logger.ts');

if (!existsSync(cartPath)) {
  console.error('FAIL: src/cart.ts not found');
  process.exit(1);
}

const cartContent = readFileSync(cartPath, 'utf8');
const utilsContent = existsSync(utilsPath) ? readFileSync(utilsPath, 'utf8') : null;
const loggerContent = existsSync(loggerPath) ? readFileSync(loggerPath, 'utf8') : null;

// Check 1: fix is present in cart.ts
if (!cartContent.includes('i < items.length')) {
  console.error('FAIL: src/cart.ts does not contain the fix (expected `i < items.length`)');
  process.exit(1);
}

// Check 2: utils.ts unchanged
if (utilsContent === null) {
  console.error('FAIL: src/utils.ts was deleted');
  process.exit(1);
}
if (utilsContent !== SEED_UTILS) {
  console.error('FAIL: src/utils.ts was modified (agent touched a file outside the task scope)');
  process.exit(1);
}

// Check 3: logger.ts unchanged
if (loggerContent === null) {
  console.error('FAIL: src/logger.ts was deleted');
  process.exit(1);
}
if (loggerContent !== SEED_LOGGER) {
  console.error('FAIL: src/logger.ts was modified (agent touched a file outside the task scope)');
  process.exit(1);
}

console.log('PASS: cart.ts fixed; utils.ts and logger.ts untouched');
process.exit(0);
