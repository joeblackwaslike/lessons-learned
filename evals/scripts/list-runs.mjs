#!/usr/bin/env node
/**
 * list-runs.mjs — list eval run result files with summary stats.
 * Reads from results/cache/ and prints a table to stdout.
 *
 * Usage: node scripts/list-runs.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, '..', 'results', 'cache');

const files = readdirSync(CACHE_DIR)
  .filter(f => f.endsWith('.json') && !f.startsWith('control-') && !f.startsWith('smoke-'))
  .map(f => {
    const path = join(CACHE_DIR, f);
    const stat = statSync(path);
    let tests = 0,
      passes = 0,
      failures = 0;
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'));
      const results = data.results?.results ?? [];
      tests = results.length;
      passes = results.filter(r => r.success !== false && r.score !== 0).length;
      failures = tests - passes;
    } catch {
      /* skip unparseable */
    }
    return { file: f, mtime: stat.mtimeMs, date: stat.mtime, tests, passes, failures };
  })
  .sort((a, b) => b.mtime - a.mtime);

if (files.length === 0) {
  console.log('No eval run files found in results/cache/.');
  console.log('Run: npm run eval');
  process.exit(0);
}

const RUN = 'FILE'.padEnd(20);
const DATE = 'DATE'.padEnd(20);
const HDR = `${RUN}  ${DATE}  TESTS  PASS  FAIL`;
console.log(HDR);
console.log('─'.repeat(HDR.length));

for (const run of files) {
  const name = run.file.slice(0, 18).padEnd(20);
  const date = run.date.toISOString().slice(0, 16).replace('T', ' ').padEnd(20);
  const tests = String(run.tests).padStart(5);
  const passes = String(run.passes).padStart(5);
  const failures = String(run.failures).padStart(5);
  console.log(`${name}  ${date}  ${tests}  ${passes}  ${failures}`);
}
