#!/usr/bin/env node
/**
 * Pre-push gate: scenarios being introduced in this push must have been run.
 *
 * Usage:
 *   node scripts/check-scenarios-run.mjs             # check ALL scenarios (preflight)
 *   node scripts/check-scenarios-run.mjs --new-only  # check only scenarios new vs origin/main (pre-push)
 *   node scripts/check-scenarios-run.mjs --json      # JSON output (any mode)
 *
 * Exit 0 = all relevant scenarios covered. Exit 1 = unrun scenarios found.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIOS_DIR = join(PLUGIN_ROOT, 'evals', 'scenarios');
const RESULTS_FILE = join(PLUGIN_ROOT, 'evals', 'results', 'cache', 'latest-run.json');

const jsonMode = process.argv.includes('--json');
const newOnly = process.argv.includes('--new-only');

function fail(msg, unrun = []) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ ok: false, message: msg, unrun }) + '\n');
  } else {
    process.stderr.write(`\n✗ ${msg}\n`);
    if (unrun.length) {
      process.stderr.write('\n  Unrun scenarios:\n');
      unrun.forEach(id => process.stderr.write(`    - ${id}\n`));
      const pattern = unrun.slice(0, 3).join('|') + (unrun.length > 3 ? '|...' : '');
      process.stderr.write(
        '\n  Run them first:\n' +
          '    cd evals && npx promptfoo eval --config promptfooconfig.yaml \\\n' +
          `      --filter-pattern "${pattern}"\n\n`
      );
    }
  }
  process.exit(1);
}

if (!existsSync(SCENARIOS_DIR)) {
  if (jsonMode)
    process.stdout.write(
      JSON.stringify({ ok: true, message: 'no scenarios dir', unrun: [] }) + '\n'
    );
  process.exit(0);
}

// Determine which scenario dirs to check
let scenarioDirs;
if (newOnly) {
  // Only check scenario dirs introduced in commits not yet on the remote
  try {
    const remote = execSync(
      'git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo origin/main',
      {
        cwd: PLUGIN_ROOT,
        encoding: 'utf8',
      }
    ).trim();
    const diffOut = execSync(
      `git diff --name-only "${remote}"...HEAD -- evals/scenarios/ 2>/dev/null || true`,
      { cwd: PLUGIN_ROOT, encoding: 'utf8' }
    );
    scenarioDirs = [
      ...new Set(
        diffOut
          .split('\n')
          .filter(l => l.includes('/scenario.json'))
          .map(l => l.replace(/^evals\/scenarios\//, '').replace(/\/scenario\.json$/, ''))
      ),
    ];
  } catch {
    // Git not available or no remote — fall through to check all
    scenarioDirs = readdirSync(SCENARIOS_DIR).filter(d => /^TC-/.test(d));
  }
} else {
  scenarioDirs = readdirSync(SCENARIOS_DIR).filter(d => /^TC-/.test(d));
}

if (scenarioDirs.length === 0) {
  if (jsonMode)
    process.stdout.write(
      JSON.stringify({ ok: true, message: 'no new scenarios', unrun: [] }) + '\n'
    );
  else process.stdout.write('✓ No new scenarios to check\n');
  process.exit(0);
}

if (!existsSync(RESULTS_FILE)) {
  fail(`No eval results found — run scenarios before pushing.`, scenarioDirs.slice(0, 5));
}

let ran;
try {
  const res = JSON.parse(readFileSync(RESULTS_FILE, 'utf8'));
  ran = new Set((res?.results?.results ?? []).map(r => r?.vars?.scenarioId).filter(Boolean));
} catch {
  fail('Could not parse evals/results/cache/latest-run.json — re-run the eval.');
}

const unrun = scenarioDirs.filter(id => !ran.has(id));

if (unrun.length > 0) {
  fail(`${unrun.length} scenario(s) have not been run since last eval:`, unrun);
}

const label = newOnly
  ? `${scenarioDirs.length} new scenario(s)`
  : `all ${scenarioDirs.length} scenarios`;
if (jsonMode) {
  process.stdout.write(JSON.stringify({ ok: true, message: `${label} covered`, unrun: [] }) + '\n');
} else {
  process.stdout.write(`✓ ${label[0].toUpperCase() + label.slice(1)} covered by latest results\n`);
}
