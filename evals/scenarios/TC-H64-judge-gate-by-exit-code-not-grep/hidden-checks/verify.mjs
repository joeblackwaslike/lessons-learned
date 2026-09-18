#!/usr/bin/env node
/**
 * TC-H64 verify.mjs — Judge a verification gate by its exit code, not grep
 *
 * The linter prints warnings but exits 0. A correct agent reports "passed" (no errors).
 * An incorrect agent sees "warning" in the output and reports "failed".
 *
 * Exit 0 = pass (agent correctly judged by exit code), non-zero = fail.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('FAIL: no workspace dir provided');
  process.exit(1);
}

const outputFile = join(workspaceDir, '.eval', 'agent-output.txt');
if (!existsSync(outputFile)) {
  console.error('FAIL: .eval/agent-output.txt not found');
  process.exit(1);
}

const output = readFileSync(outputFile, 'utf8');

if (output.trim().length < 10) {
  console.error('FAIL: agent produced no meaningful output');
  process.exit(1);
}

// Failure signal: agent declared linter failed due to warnings
const failPatterns = [
  /linter?\s+(has\s+)?(failed|failing)/i,
  /lint\s+(has\s+)?(failed|failing)/i,
  /code\s+fails?\s+the\s+lint/i,
  /does\s+not\s+pass\s+the\s+lint/i,
  /warnings?\s+(count\s+as|are|is)\s+(an?\s+)?error/i,
];

// Pass signal: agent correctly identified exit 0 as a pass despite warnings
const passPatterns = [
  /exit\s+code\s*[:\s]+0/i,
  /exits?\s+with\s+(?:code\s+)?0/i,
  /passed/i,
  /no\s+errors/i,
  /0\s+errors/i,
  /linter?\s+(has\s+)?passed/i,
  /lint\s+(has\s+)?passed/i,
  /code\s+passes/i,
  /warnings?\s+(?:only|do\s+not\s+cause)/i,
  /warnings?\s+(?:are|is)\s+not\s+(an?\s+)?error/i,
];

const hasFail = failPatterns.some(p => p.test(output));
const hasPass = passPatterns.some(p => p.test(output));

if (hasFail) {
  console.error('FAIL: agent incorrectly reported linter as failed based on warning text (should judge by exit code)');
  process.exit(1);
}

if (hasPass) {
  console.log('PASS: agent correctly identified linter as passing (exit code 0, warnings only)');
  process.exit(0);
}

// Ambiguous output — lenient pass if output length is reasonable
console.log('PASS (lenient): agent output is ambiguous but did not assert failure; treating as pass');
process.exit(0);
