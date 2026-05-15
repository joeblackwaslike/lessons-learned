#!/usr/bin/env node
/**
 * Jessify audit — checks every active lesson for quality issues beyond what `doctor` covers.
 *
 * Checks:
 *   summary-too-long        summary > 80 chars (also caught by doctor)
 *   missing-trigger         hint/guard has no commandPatterns and no pathPatterns
 *   protocol-has-toolnames  directive/protocol has non-empty toolNames (ignored at session start)
 *   weak-solution           solution reads as general advice, not a concrete gate or action
 *   root-cause-missing      problem doesn't explain why/when the failure occurs
 *   missing-tags            no tool: tag when toolNames are set, or no severity: tag for data-loss lessons
 *   no-eval                 no evals/scenarios entry with a matching lessonId
 *   overbroad-message       compiled message body likely to exceed injection byte budget (>1200 bytes)
 *
 * recommendedAction:
 *   mechanical-fix    field change only, no behavior reasoning needed
 *   rewrite           lesson content needs rethinking
 *   eval-needed       requires an eval scenario before the rewrite is considered verified
 *   ok                no issues found
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const MANIFEST_PATH = join(REPO_ROOT, 'data/lesson-manifest.json');
const SCENARIOS_DIR = join(REPO_ROOT, 'evals/scenarios');

const SESSION_START_TYPES = new Set(['directive', 'protocol']);
const TRIGGER_TYPES = new Set(['hint', 'guard']);

const HELP = `\
audit-lessons — Jessify quality audit for the lessons-learned corpus

Usage:
  node scripts/jessify/audit-lessons.mjs [options]

Options:
  --json          Emit JSON array instead of human-readable output
  --id <id>       Audit a single lesson by slug fragment or ID
  --action <act>  Filter by recommendedAction: mechanical-fix|rewrite|eval-needed|ok
  --check <code>  Filter by issue code (e.g. missing-trigger)
  --no-ok         Hide lessons with no issues (default when not --json)
  --help          Show this message

Output shape (--json):
  [{ id, slug, type, priority, issues: [{ code, detail }], recommendedAction }]
`;

function loadManifest() {
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  const m = JSON.parse(raw);
  return Object.entries(m.lessons).map(([id, l]) => ({ id, ...l }));
}

function loadCoveredSlugs() {
  const covered = new Set();
  if (!existsSync(SCENARIOS_DIR)) return covered;
  for (const entry of readdirSync(SCENARIOS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const scenarioPath = join(SCENARIOS_DIR, entry.name, 'scenario.json');
    if (!existsSync(scenarioPath)) continue;
    try {
      const s = JSON.parse(readFileSync(scenarioPath, 'utf8'));
      if (s.lessonId) covered.add(s.lessonId);
      if (s.recommendedInterventions) s.recommendedInterventions.forEach(id => covered.add(id));
    } catch {
      // skip malformed scenario
    }
  }
  return covered;
}

function auditLesson(lesson, coveredSlugs) {
  const issues = [];
  const {
    slug,
    type,
    priority,
    toolNames,
    commandRegexSources,
    pathRegexSources,
    tags,
    summary,
    problem,
    solution,
    message,
  } = lesson;

  const isSessionStart = SESSION_START_TYPES.has(type);
  const isTriggerType = TRIGGER_TYPES.has(type);

  // summary-too-long
  if (summary && summary.length > 80) {
    issues.push({ code: 'summary-too-long', detail: `${summary.length} chars (max 80)` });
  }

  // protocol-has-toolnames
  if (isSessionStart && toolNames && toolNames.length > 0) {
    issues.push({
      code: 'protocol-has-toolnames',
      detail: `toolNames ${JSON.stringify(toolNames)} are ignored at session start`,
    });
  }

  // missing-trigger: hint/guard with no patterns fires on every tool call
  if (isTriggerType) {
    const hasCommandPattern = commandRegexSources && commandRegexSources.length > 0;
    const hasPathPattern = pathRegexSources && pathRegexSources.length > 0;
    if (!hasCommandPattern && !hasPathPattern) {
      issues.push({
        code: 'missing-trigger',
        detail:
          'hint/guard has no commandPatterns or pathPatterns — fires on every matching toolName call',
      });
    }
  }

  // weak-solution: solution lacks imperative gate language
  if (solution) {
    const lower = solution.toLowerCase();
    const hasGate =
      /\b(before|run|check|verify|use\s+\w|ensure|confirm|always\s+\w|never\s+\w|add\s+\w|pass\s+\w|set\s+\w|include\s+\w|prefer\s+\w)\b/.test(
        lower
      );
    const isTooShort = solution.trim().length < 30;
    if (!hasGate || isTooShort) {
      issues.push({
        code: 'weak-solution',
        detail:
          'solution lacks a concrete gate or action verb (before/run/check/verify/use/ensure)',
      });
    }
  }

  // root-cause-missing: problem doesn't explain why
  if (problem) {
    const lower = problem.toLowerCase();
    const hasRootCause =
      /\b(because|when|if|due to|since|caused by|results in|leads to|triggers|silently|without|missing)\b/.test(
        lower
      );
    if (!hasRootCause && problem.trim().length > 0) {
      issues.push({
        code: 'root-cause-missing',
        detail: 'problem field does not explain why or when the failure occurs',
      });
    }
  }

  // missing-tags: no tool: tag when toolNames are set
  const tagSet = new Set(tags ?? []);
  const hasTool = [...tagSet].some(t => t.startsWith('tool:'));
  if (toolNames && toolNames.length > 0 && !hasTool) {
    issues.push({
      code: 'missing-tags',
      detail: `toolNames are set (${toolNames.join(', ')}) but no tool: tag present`,
    });
  }

  // missing severity: tag for high-priority lessons
  const hasSeverity = [...tagSet].some(t => t.startsWith('severity:'));
  if (priority >= 8 && !hasSeverity) {
    issues.push({
      code: 'missing-tags',
      detail: `priority ${priority} but no severity: tag (severity:data-loss, severity:hang, etc.)`,
    });
  }

  // no-eval: lesson not covered by any scenario
  if (!coveredSlugs.has(slug)) {
    issues.push({
      code: 'no-eval',
      detail: 'no eval scenario with matching lessonId or recommendedInterventions',
    });
  }

  // overbroad-message: compiled message body over ~1200 bytes
  if (message && Buffer.byteLength(message, 'utf8') > 1200) {
    issues.push({
      code: 'overbroad-message',
      detail: `${Buffer.byteLength(message, 'utf8')} bytes — may exceed injection budget`,
    });
  }

  return issues;
}

function recommendedAction(issues, priority) {
  if (issues.length === 0) return 'ok';

  const codes = new Set(issues.map(i => i.code));
  const mechanicalOnly = new Set([
    'summary-too-long',
    'protocol-has-toolnames',
    'missing-tags',
    'overbroad-message',
  ]);
  const needsRewrite = ['missing-trigger', 'weak-solution', 'root-cause-missing'];

  const hasRewrite = needsRewrite.some(c => codes.has(c));
  const hasNoEval = codes.has('no-eval');
  const allMechanical = [...codes].every(c => mechanicalOnly.has(c));

  if (hasRewrite && (hasNoEval || priority >= 7)) return 'eval-needed';
  if (hasRewrite) return 'rewrite';
  if (allMechanical) return 'mechanical-fix';
  if (hasNoEval && priority >= 7) return 'eval-needed';
  return 'rewrite';
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  const jsonMode = args.includes('--json');
  const noOk = !jsonMode || args.includes('--no-ok');

  const idFilter = args.includes('--id') ? args[args.indexOf('--id') + 1] : null;
  const actionFilter = args.includes('--action') ? args[args.indexOf('--action') + 1] : null;
  const checkFilter = args.includes('--check') ? args[args.indexOf('--check') + 1] : null;

  const lessons = loadManifest();
  const coveredSlugs = loadCoveredSlugs();

  let results = lessons.map(lesson => {
    const issues = auditLesson(lesson, coveredSlugs);
    const action = recommendedAction(issues, lesson.priority ?? 5);
    return {
      id: lesson.id,
      slug: lesson.slug,
      type: lesson.type,
      priority: lesson.priority,
      issues,
      recommendedAction: action,
    };
  });

  if (idFilter) {
    results = results.filter(r => r.id.includes(idFilter) || r.slug.includes(idFilter));
  }
  if (actionFilter) {
    results = results.filter(r => r.recommendedAction === actionFilter);
  }
  if (checkFilter) {
    results = results.filter(r => r.issues.some(i => i.code === checkFilter));
  }
  if (noOk && !jsonMode) {
    results = results.filter(r => r.issues.length > 0);
  }

  if (jsonMode) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return;
  }

  // Human-readable output
  const byAction = {};
  for (const r of results) {
    if (!byAction[r.recommendedAction]) byAction[r.recommendedAction] = [];
    byAction[r.recommendedAction].push(r);
  }

  const order = ['eval-needed', 'rewrite', 'mechanical-fix', 'ok'];

  for (const action of order) {
    const group = byAction[action];
    if (!group || group.length === 0) continue;
    if (action === 'ok' && noOk) continue;

    console.log(
      `\n── ${action} (${group.length}) ${'─'.repeat(Math.max(0, 50 - action.length - String(group.length).length - 6))}`
    );
    for (const r of group.sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5))) {
      console.log(`\n  ${r.slug} [${r.type}] priority:${r.priority ?? '?'}`);
      for (const issue of r.issues) {
        console.log(`    ✗ ${issue.code}: ${issue.detail}`);
      }
    }
  }

  const totalIssues = results.filter(r => r.issues.length > 0).length;
  const evalNeeded = (byAction['eval-needed'] ?? []).length;
  const rewrite = (byAction['rewrite'] ?? []).length;
  const mechanical = (byAction['mechanical-fix'] ?? []).length;

  console.log(`\n${totalIssues} of ${lessons.length} lessons have jessify issues`);
  console.log(`  eval-needed: ${evalNeeded}  rewrite: ${rewrite}  mechanical-fix: ${mechanical}`);
}

main();
