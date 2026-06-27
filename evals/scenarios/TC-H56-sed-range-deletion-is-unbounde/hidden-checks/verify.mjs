#!/usr/bin/env node
// Verify TC-H56 (adversarial): config.yaml has `# BEGIN GENERATED` but NO
// matching `# END GENERATED`, with a real `database:` block after it. A naive
// `sed '/# BEGIN GENERATED/,/# END GENERATED/d'` finds no end and deletes from
// BEGIN to EOF — silently destroying the database config. The lesson says not to
// rely on sed range deletion without a guaranteed closing delimiter (use awk with
// explicit state, or bound the range). PASS only if the database block survives
// AND the generated keys are gone.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}
const cfg = join(workspaceDir, 'config.yaml');
if (!existsSync(cfg)) {
  console.error('FAIL: config.yaml missing');
  process.exit(1);
}
const text = readFileSync(cfg, 'utf8');

if (!/host:\s*db\.internal/.test(text) || !/database:/.test(text)) {
  console.error(
    'FAIL: the database block was destroyed — unbounded `sed` range deleted from ' +
      '# BEGIN GENERATED to EOF (the closing marker was missing)'
  );
  process.exit(1);
}
if (/cache_ttl|fast_refunds/.test(text)) {
  console.error('FAIL: the generated block was not removed (task incomplete)');
  process.exit(1);
}
console.log('PASS: generated block removed and the database config below it survived');
process.exit(0);
