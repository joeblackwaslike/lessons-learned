#!/usr/bin/env node
/**
 * TC-H71 hidden check: OAuth2 token refresh must use ETSY_CLIENT_SECRET
 * as the client_secret — never ETSY_CLIENT_ID.
 *
 * Control arm: agent produced output — baseline captured.
 * Treatment arm:
 *   PASS if auth.ts contains ETSY_CLIENT_SECRET (not CLIENT_ID) as the
 *        client_secret value.
 *   FAIL if still TODO, or if CLIENT_ID is used where CLIENT_SECRET should be.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const workspaceDir = resolve(process.argv[2] ?? '');
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspaceDir>');
  process.exit(2);
}

const evalMetaDir = join(workspaceDir, '.eval');
const interventionPath = join(evalMetaDir, 'intervention.json');
const agentOutputPath = join(evalMetaDir, 'agent-output.txt');

let intervention = { type: 'none' };
if (existsSync(interventionPath)) {
  try { intervention = JSON.parse(readFileSync(interventionPath, 'utf8')); } catch (_e) { /* ignore */ }
}

const agentOutput = existsSync(agentOutputPath) ? readFileSync(agentOutputPath, 'utf8') : '';

if (intervention.type === 'none') {
  if (!agentOutput.trim()) {
    console.error('FAIL (control): Agent produced no output');
    process.exit(1);
  }
  console.log('PASS (control): Agent produced output — baseline captured');
  process.exit(0);
}

// Treatment arm — read the written auth file
const authPath = join(workspaceDir, 'src', 'integrations', 'etsy', 'auth.ts');

if (!existsSync(authPath)) {
  // Fall back to agent output
  const outHasSecret = /ETSY_CLIENT_SECRET/i.test(agentOutput);
  const outHasBadPattern = /client_secret.*ETSY_CLIENT_ID/i.test(agentOutput);
  if (outHasSecret && !outHasBadPattern) {
    console.log('PASS (treatment, output-only): Agent output uses ETSY_CLIENT_SECRET correctly');
    process.exit(0);
  }
  console.error('FAIL (treatment): auth.ts not written and output does not confirm correct secret usage');
  process.exit(1);
}

const authContent = readFileSync(authPath, 'utf8');

// Must not be still a TODO with no implementation
if (/throw new Error\('not implemented'\)/.test(authContent) && !/client_secret/i.test(authContent)) {
  console.error('FAIL (treatment): auth.ts still has the not-implemented stub');
  process.exit(1);
}

// Must contain CLIENT_SECRET somewhere (correct env var)
const hasClientSecret = /ETSY_CLIENT_SECRET/i.test(authContent);
if (!hasClientSecret) {
  console.error('FAIL (treatment): auth.ts does not reference ETSY_CLIENT_SECRET');
  process.exit(1);
}

// Must NOT use CLIENT_ID as the client_secret value
// Check for the pattern: client_secret: ...CLIENT_ID... or client_secret=...CLIENT_ID...
const badPattern = /client_secret['":\s=]+[^;\n]*CLIENT_ID/i.test(authContent);
if (badPattern) {
  console.error('FAIL (treatment): auth.ts uses ETSY_CLIENT_ID as the client_secret value');
  process.exit(1);
}

console.log('PASS (treatment): auth.ts uses ETSY_CLIENT_SECRET correctly as client_secret');
process.exit(0);
