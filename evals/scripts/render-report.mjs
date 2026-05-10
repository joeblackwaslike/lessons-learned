#!/usr/bin/env node
/**
 * render-report.mjs
 *
 * Reads a Promptfoo JSON result file and renders a Markdown eval report
 * matching the format defined in PRD 004 section 17.
 *
 * Usage:
 *   node scripts/render-report.mjs [--input <path>] [--output <path>]
 *
 * Defaults:
 *   --input   results/cache/latest-run.json
 *   --output  results/reports/report-<timestamp>.md  (and stdout)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVALS_ROOT = resolve(__dirname, '..');

const args = parseArgs(process.argv.slice(2));
const inputPath = resolve(
  args['--input'] ?? join(EVALS_ROOT, 'results', 'cache', 'latest-run.json')
);
const reportsDir = join(EVALS_ROOT, 'results', 'reports');
mkdirSync(reportsDir, { recursive: true });

const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-').slice(0, 19);
const defaultOutput = join(reportsDir, `report-${timestamp}.md`);
const outputPath = args['--output'] ? resolve(args['--output']) : defaultOutput;

// --- Load Promptfoo JSON --------------------------------------------------------

let runData;
try {
  runData = JSON.parse(readFileSync(inputPath, 'utf8'));
} catch (err) {
  console.error(`Failed to read result file: ${inputPath}\n${err.message}`);
  process.exit(1);
}

// --- Extract results ------------------------------------------------------------
// Promptfoo nests results: runData.results.results[] and runData.results.timestamp

const pfResults = runData.results?.results ?? [];
const createdAt = runData.results?.timestamp ?? runData.createdAt ?? new Date().toISOString();

// Pair control + treatment arms into scenario results for the report
const results = buildScenarioResults(pfResults);
const stats = computeStats(results);

// --- Render report --------------------------------------------------------------

const report = [
  `# Eval Report — ${formatDate(createdAt)}`,
  '',
  `**Run:** \`${runData.id ?? 'unknown'}\` | **Ref:** \`${gitRef()}\` | **Judge:** claude-sonnet-4-6 + o4-mini`,
  '',
  '## Summary',
  '',
  '| Metric | Value |',
  '|--------|-------|',
  `| Lessons evaluated | ${stats.total} |`,
  `| Pass rate | ${stats.passRate}% (${stats.passed}/${stats.total}) |`,
  `| Mean improvement delta | ${stats.meanDelta} |`,
  `| Regressions | ${stats.regressions} |`,
  `| New failures | ${stats.failures} |`,
  `| Cache hits (control arms) | ${stats.cacheHits} |`,
  '',
  '## Results',
  '',
  '| Scenario | Type | Mode | Control | Treatment | Delta | Pass |',
  '|---|---|---|---|---|---|---|',
  ...results.map(formatResultRow),
  '',
  ...renderFailures(results.filter(r => !r.pass)),
].join('\n');

// --- Write output ---------------------------------------------------------------

writeFileSync(outputPath, report, 'utf8');
console.log(report);
console.error(`\nReport written to: ${outputPath}`);

// --- Helpers --------------------------------------------------------------------

function computeStats(results) {
  if (results.length === 0) {
    return {
      total: 0,
      passed: 0,
      passRate: '–',
      meanDelta: '–',
      regressions: 0,
      failures: 0,
      cacheHits: 0,
    };
  }
  const passed = results.filter(r => r.pass).length;
  const deltas = results.map(r => r.delta).filter(d => typeof d === 'number');
  const meanDelta = deltas.length
    ? (deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(2)
    : '–';
  return {
    total: results.length,
    passed,
    passRate: ((passed / results.length) * 100).toFixed(0),
    meanDelta: meanDelta === '–' ? '–' : `+${meanDelta}`,
    regressions: results.filter(r => r.regression).length,
    failures: results.filter(r => !r.pass && !r.regression).length,
    cacheHits: results.filter(r => r.cacheHit).length,
  };
}

function formatResultRow(result) {
  const scenario = result.scenarioId ?? '–';
  const type = result.lessonType ?? '–';
  const mode = result.mode ?? '–';
  const control = typeof result.controlScore === 'number' ? result.controlScore.toFixed(2) : '—';
  const treatment =
    typeof result.treatmentScore === 'number' ? result.treatmentScore.toFixed(2) : '—';
  let delta = '—';
  if (typeof result.delta === 'number') {
    delta = result.delta >= 0 ? `+${result.delta.toFixed(2)}` : result.delta.toFixed(2);
  }
  const pass = result.pass ? '✅' : '❌';
  return `| ${scenario} | ${type} | ${mode} | ${control} | ${treatment} | ${delta} | ${pass} |`;
}

function renderFailures(failures) {
  if (failures.length === 0) return [];
  return [
    '## Failures',
    '',
    ...failures.flatMap(f => {
      const judgeResult = f.judgeResult ?? null;
      const lines = [
        `### ${f.scenarioId ?? 'unknown'} (${f.lessonType ?? '–'}) — FAILED`,
        '',
        `Delta: ${typeof f.delta === 'number' ? f.delta.toFixed(2) : '–'} | Score: ${f.treatmentScore?.toFixed(2) ?? '–'}`,
        '',
      ];

      if (judgeResult) {
        if (judgeResult.outcome === 'CONTROL_CORRECT') {
          lines.push(
            '**CONTROL_CORRECT**: The control agent solved this without the lesson.',
            '',
            'Next steps (in order):',
            '1. **Check the trigger prompt first.** Is it specific enough to reliably reproduce',
            '   the failure mode? If not, refine it and re-run before drawing any conclusions.',
            '2. **If the prompt is sound and control still passes**, the lesson may be injecting',
            '   unnecessary noise. Consider archiving it.',
            ''
          );
        } else {
          if (judgeResult.reasoning) {
            lines.push(`**Judge reasoning**: ${judgeResult.reasoning}`, '');
          }
          if (judgeResult.outcome === 'FAIL') {
            lines.push(
              '**Consider editing**: Make the solution more prescriptive about the exact action to take.',
              ''
            );
          }
          const ds = judgeResult.dimension_scores;
          if (ds?.treatment) {
            lines.push(...renderDimensionScores(ds));
          }
        }
      } else if (f.failureReason) {
        lines.push(`**Diagnosis:** ${f.failureReason}`, '');
      }

      return lines;
    }),
  ];
}

const DIMENSION_LABELS = [
  'Correctness',
  'Scope adherence',
  'Clarity',
  'Testability',
  'Absence of failure mode',
];

function renderDimensionScores(ds) {
  const control = ds.control;
  const treatment = ds.treatment;
  const lines = [
    '**Tier 3 dimension scores**:',
    '| Dimension | Control | Treatment |',
    '| --- | --- | --- |',
  ];
  for (let i = 0; i < DIMENSION_LABELS.length; i++) {
    const c = control ? (control[i] ?? '–') : '–';
    const t = treatment ? (treatment[i] ?? '–') : '–';
    lines.push(`| ${DIMENSION_LABELS[i]} | ${c} | ${t} |`);
  }
  const cAvg = control ? (control.reduce((a, b) => a + b, 0) / control.length).toFixed(1) : '–';
  const tAvg = treatment
    ? (treatment.reduce((a, b) => a + b, 0) / treatment.length).toFixed(1)
    : '–';
  const delta =
    control && treatment
      ? ` (+${(treatment.reduce((a, b) => a + b, 0) / treatment.length - control.reduce((a, b) => a + b, 0) / control.length).toFixed(1)})`
      : '';
  lines.push(`| **Avg / Delta** | ${cAvg} | ${tAvg}${delta} |`, '');
  return lines;
}

/**
 * Build scenario-level results from Promptfoo's flat per-arm result array.
 * Pairs control + treatment arms by scenarioId.
 */
function buildScenarioResults(pfResults) {
  const byScenario = new Map();

  for (const r of pfResults) {
    const scenarioId = r.vars?.scenarioId ?? 'unknown';
    const isControl = (r.vars?.intervention?.type ?? 'none') === 'none';
    const hiddenCheck = r.response?.metadata?.hiddenCheck ?? {};
    const armPass = hiddenCheck.pass !== false && r.success !== false;

    if (!byScenario.has(scenarioId)) {
      byScenario.set(scenarioId, { scenarioId, control: null, treatment: null });
    }
    const entry = byScenario.get(scenarioId);
    if (isControl) {
      entry.control = {
        pass: armPass,
        score: r.score ?? 0,
        cacheHit: r.response?.metadata?.cacheHit ?? false,
      };
    } else {
      entry.treatment = {
        pass: armPass,
        score: r.score ?? 0,
        ids: r.vars?.intervention?.ids ?? [],
        cacheHit: r.response?.metadata?.cacheHit ?? false,
        failureReason: hiddenCheck.details ?? r.failureReason,
      };
    }
  }

  return [...byScenario.values()].map(({ scenarioId, control, treatment }) => {
    const controlScore = control?.score ?? null;
    const treatmentScore = treatment?.score ?? null;
    const delta =
      controlScore !== null && treatmentScore !== null ? treatmentScore - controlScore : null;
    const pass = treatment?.pass ?? false;
    return {
      scenarioId,
      lessonType: null,
      mode: 'candidate-vs-none',
      controlScore,
      treatmentScore,
      delta,
      pass,
      regression: false,
      cacheHit: control?.cacheHit ?? false,
      failureReason: pass ? null : (treatment?.failureReason ?? null),
    };
  });
}

function formatDate(iso) {
  return new Date(iso).toISOString().replaceAll('T', ' ').slice(0, 16) + ' UTC';
}

function gitRef() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      result[argv[i]] = argv[i + 1];
      i++;
    }
  }
  return result;
}
