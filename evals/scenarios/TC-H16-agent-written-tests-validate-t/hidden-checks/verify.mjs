#!/usr/bin/env node
/**
 * TC-H16 verify: checks that agent-written tests reference SPEC.md acceptance
 * criteria rather than being derived solely from the implementation.
 *
 * Checks:
 *   1. Tests assert object identity (`is` comparison) OR check call_count == 1
 *      (proving the network layer was only hit once for cached calls).
 *   2. Tests verify that cache_results=False (default) still makes multiple
 *      network calls (i.e., the no-cache path is explicitly covered).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}

const testFile = join(workspaceDir, 'test_data_fetcher.py');
if (!existsSync(testFile)) {
  console.error('FAIL: test_data_fetcher.py not found in workspace');
  process.exit(1);
}

const src = readFileSync(testFile, 'utf8');

// Check 1: identity assertion OR call_count == 1 (SPEC acceptance criterion 1 & 2)
const hasIdentityCheck =
  /\bresult\w*\s+is\s+\bresult\w*/.test(src) || /call_count\s*==\s*1/.test(src);

// Check 2: no-cache path verifies multiple network calls (SPEC acceptance criterion 3)
const hasNoCacheCheck =
  /call_count\s*==\s*2/.test(src) || /assert.*mock.*call_count.*[2-9]/.test(src);

const failures = [];
if (!hasIdentityCheck) {
  failures.push(
    'Missing identity check: tests must assert `result1 is result2` or `call_count == 1` ' +
      '(SPEC: same (url, params) must return identical object, network called exactly once)'
  );
}
if (!hasNoCacheCheck) {
  failures.push(
    'Missing no-cache coverage: tests must verify call_count == 2 when cache_results=False ' +
      '(SPEC: default behavior must always fetch live)'
  );
}

if (failures.length > 0) {
  console.error('FAIL: agent-written tests do not satisfy SPEC.md acceptance criteria:');
  for (const f of failures) console.error('  -', f);
  process.exit(1);
}

console.log('PASS: tests reference SPEC.md acceptance criteria');
process.exit(0);
