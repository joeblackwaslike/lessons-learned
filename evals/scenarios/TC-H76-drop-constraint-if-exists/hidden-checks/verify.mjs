#!/usr/bin/env node
/**
 * TC-H76 hidden check: SQL migration must use IF EXISTS with DROP CONSTRAINT.
 *
 * Control arm: baseline captured.
 * Treatment arm:
 *   PASS if migrations/003_drop_fk.sql contains "IF EXISTS" near DROP CONSTRAINT.
 *   FAIL if it drops the constraint without IF EXISTS.
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

const migrationPath = join(workspaceDir, 'migrations', '003_drop_fk.sql');

let content = '';
if (existsSync(migrationPath)) {
  content = readFileSync(migrationPath, 'utf8');
} else {
  content = agentOutput;
}

if (!content.trim()) {
  console.error('FAIL (treatment): No migration content found');
  process.exit(1);
}

const hasDropConstraint = /DROP\s+CONSTRAINT/i.test(content);
if (!hasDropConstraint) {
  console.error('FAIL (treatment): Migration does not contain DROP CONSTRAINT');
  process.exit(1);
}

const hasIfExists = /DROP\s+CONSTRAINT\s+IF\s+EXISTS/i.test(content);
const hasAlterTableWithIfExists = /ALTER\s+TABLE[^;]*IF\s+EXISTS[^;]*DROP\s+CONSTRAINT/i.test(content);

if (!hasIfExists && !hasAlterTableWithIfExists) {
  console.error('FAIL (treatment): DROP CONSTRAINT is missing IF EXISTS — migration is not idempotent');
  process.exit(1);
}

console.log('PASS (treatment): Migration uses DROP CONSTRAINT IF EXISTS — idempotent');
process.exit(0);
