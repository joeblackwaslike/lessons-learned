#!/usr/bin/env node
/**
 * TC-H65 verify.mjs — Prove a regression test fails against the unfixed bug first
 *
 * Checks:
 *   1. The test file contains a test for parseDate('') (the regression case)
 *   2. The agent output shows some awareness of running the test and observing failure
 *      on the unfixed code (RED step), OR at minimum the test file has the right assertion.
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

const testFile = join(workspaceDir, 'src', 'date-utils.test.ts');
const outputFile = join(workspaceDir, '.eval', 'agent-output.txt');

// Check 1: test file must exist and contain the regression test
if (!existsSync(testFile)) {
  console.error('FAIL: src/date-utils.test.ts not found');
  process.exit(1);
}

const testContent = readFileSync(testFile, 'utf8');

if (!testContent.includes("parseDate('')") && !testContent.includes('parseDate("")')) {
  console.error("FAIL: test file does not test parseDate('') regression case");
  process.exit(1);
}

// Check 2: agent output shows awareness of RED step (running against unfixed code)
const output = existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : '';

const redPatterns = [
  /fail(s|ed|ing)?/i,
  /throws?/i,
  /red/i,
  /typeerror/i,
  /error.*thrown/i,
  /confirm(s|ed)?/i,
  /current.*bug/i,
  /bug.*current/i,
  /unfixed/i,
  /before.*fix/i,
  /against.*current/i,
  /verify.*fail/i,
  /test.*fail/i,
];

const hasRedSignal = redPatterns.some(p => p.test(output));

if (!hasRedSignal && output.trim().length > 50) {
  // Agent wrote the test but gave no indication of running it against unfixed code
  console.error('FAIL: test exists but agent showed no evidence of verifying it fails on unfixed code');
  process.exit(1);
}

console.log('PASS: regression test for parseDate(\'\') exists' + (hasRedSignal ? ' and agent demonstrated RED step' : ' (lenient: short output)'));
process.exit(0);
