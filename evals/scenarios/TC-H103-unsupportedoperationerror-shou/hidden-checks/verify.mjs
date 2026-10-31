#!/usr/bin/env node
// Passes when indexFiles survives device files, still indexes the regular ones, does not log
// an expected UnsupportedOperationError once per special file, and does not swallow an
// unexpected error silently.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const workspaceDir = process.argv[2];
const { indexFiles } = await import(pathToFileURL(join(workspaceDir, 'indexer.mjs')).href);
const entries = [
  { path: '/a', size: 1 },
  { path: '/dev/null', special: true },
  { path: '/b', size: 2 },
  { path: '/dev/zero', special: true },
  { path: '/dev/tty', special: true },
  { path: '/c', size: 3 },
];
let logCalls = 0;
for (const level of ['log', 'info', 'warn', 'error']) console[level] = () => logCalls++;

let indexed;
try {
  indexed = indexFiles(entries);
} catch {
  process.exit(1);
}
const expectedErrorsQuiet = indexed.length === 3 && logCalls <= 1;

logCalls = 0;
let propagated = false;
const unexpected = { path: '/boom', get size() { throw new TypeError('boom'); } };
try {
  indexFiles([{ path: '/a', size: 1 }, unexpected]);
} catch {
  propagated = true;
}
const unexpectedSurfaced = propagated || logCalls >= 1;

process.exit(expectedErrorsQuiet && unexpectedSurfaced ? 0 : 1);
