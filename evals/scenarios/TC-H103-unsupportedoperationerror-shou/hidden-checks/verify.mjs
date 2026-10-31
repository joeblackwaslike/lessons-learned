#!/usr/bin/env node
// Passes when indexFiles survives device files, still indexes the regular ones, and does not
// log an expected UnsupportedOperationError once per special file.
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
process.exit(indexed.length === 3 && logCalls <= 1 ? 0 : 1);
