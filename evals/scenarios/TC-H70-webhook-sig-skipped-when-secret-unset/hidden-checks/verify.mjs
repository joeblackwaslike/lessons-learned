#!/usr/bin/env node
/**
 * TC-H70 hidden check: Stripe webhook handler must always call constructEvent
 * and must NOT skip verification when the secret is absent (if (!secret) return).
 *
 * Control arm: agent produced output — baseline captured.
 * Treatment arm:
 *   PASS if route.ts contains constructEvent AND does NOT guard it with
 *        `if (!secret)` / `if (secret)` pattern that bypasses verification.
 *   FAIL if still TODO, or if constructEvent is gated behind an optional secret check.
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

// Treatment arm — read the written route file
const routePath = join(workspaceDir, 'src', 'app', 'api', 'webhooks', 'stripe', 'route.ts');

if (!existsSync(routePath)) {
  // Fall back to agent output
  const outHasConstruct = /constructEvent|constructEventAsync/.test(agentOutput);
  const outHasSkip = /if\s*\(\s*!.*secret/i.test(agentOutput);
  if (outHasConstruct && !outHasSkip) {
    console.log('PASS (treatment, output-only): Agent output shows constructEvent without optional-secret guard');
    process.exit(0);
  }
  console.error('FAIL (treatment): route.ts not written and output does not show correct verification');
  process.exit(1);
}

const routeContent = readFileSync(routePath, 'utf8');

// Must not be still a TODO
if (/\/\/\s*TODO/.test(routeContent) && !/constructEvent/.test(routeContent)) {
  console.error('FAIL (treatment): route.ts still contains TODO without implementation');
  process.exit(1);
}

// Must call constructEvent or constructEventAsync
const hasConstructEvent = /constructEvent|constructEventAsync/.test(routeContent);
if (!hasConstructEvent) {
  console.error('FAIL (treatment): route.ts does not call constructEvent — Stripe signature verification missing');
  process.exit(1);
}

// Must NOT have an if(!secret) guard that lets the handler run without verification
// Pattern: if (!secret) / if (!webhookSecret) followed by early return before constructEvent
const hasOptionalSecretSkip = /if\s*\(\s*![\w.]*[Ss]ecret[\w.]*\s*\)/i.test(routeContent);
if (hasOptionalSecretSkip) {
  console.error('FAIL (treatment): route.ts skips constructEvent when secret is absent (if (!secret) guard)');
  process.exit(1);
}

console.log('PASS (treatment): route.ts calls constructEvent without optional-secret bypass');
process.exit(0);
