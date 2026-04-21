#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

/**
 * lessons — Manage the lessons-learned lesson store.
 *
 * Subcommands:
 *   add               Add a new lesson (interactive, --json, or --file)
 *   build             Rebuild the lesson manifest from the DB
 *   edit              Edit fields on an existing lesson in place
 *   list              List all lessons with key fields
 *   promote           Promote candidates to active, archive, or patch fields
 *   restore           Restore archived lessons back to active
 *   review            Review T2 scan candidates against intake validation rules
 *   scan              Incrementally scan session logs for new candidates
 *   scan aggregate    List ranked candidates from the DB
 *
 * Usage:
 *   node scripts/lessons.mjs <subcommand> [options]
 *   node scripts/lessons.mjs --help
 *   node scripts/lessons.mjs <subcommand> --help
 */

import { readFileSync, writeFileSync, createReadStream, readdirSync, statSync } from 'node:fs';
import {
  openDb,
  closeDb,
  getActiveRecords,
  getManifestRecords,
  getCandidateRecords,
  getCandidatesBelowConfidence,
  getPendingWindows,
  archivePendingWindows,
  insertCandidate,
  insertCandidateBatch,
  promoteToActive,
  archiveRecords,
  restoreToActive,
  updateRecord,
  getRecordsByIds,
  insertReviewSession,
  computeContentHash as computeContentHashFromDb,
} from './db.mjs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { scanLineForLessons } from './scanner/structured.mjs';
import { HeuristicDetector } from './scanner/detector.mjs';
import { extractFromStructured, extractFromHeuristic } from './scanner/extractor.mjs';
import {
  loadScanState,
  saveScanState,
  getResumeOffset,
  updateOffset,
  getSemanticOffset,
  updateSemanticOffset,
  resetSemanticOffsets,
} from './scanner/incremental.mjs';
import { semanticScanFile, seedLessonEmbeddings } from './scanner/semantic.mjs';
import { loadVecExtension } from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..');
const DATA_DIR = process.env.LESSONS_DATA_DIR ?? join(PLUGIN_ROOT, 'data');
const MANIFEST_PATH = process.env.LESSONS_MANIFEST_PATH ?? join(DATA_DIR, 'lesson-manifest.json');
const CONFIG_PATH = process.env.LESSONS_CONFIG_PATH ?? join(DATA_DIR, 'config.json');
const DEFAULT_SCAN_PATH = join(homedir(), '.claude', 'projects');

// ─── ANSI colors ─────────────────────────────────────────────────────

const ANSI = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

// ─── Help ────────────────────────────────────────────────────────────

const HELP = {
  root: `
lessons — Manage the lessons-learned lesson store.

Usage:
  node scripts/lessons.mjs <subcommand> [options]

Subcommands:
  add               Add a new lesson interactively or from JSON
  build             Rebuild the lesson manifest from the DB
  edit              Edit fields on an existing lesson in place
  list              List all active lessons with their trigger patterns
  onboard           Batch-import lessons from a JSON array
  promote           Promote candidates to active, archive, or patch fields
  purge             Archive all candidates below a confidence threshold
  windows           List or archive pending semantic windows (from Tier 3 scan)
  restore           Restore archived lessons back to active
  review            Review candidates from the DB against validation rules
  doctor            Audit active lessons for quality issues
  scan              Incrementally scan session logs for new candidates
  scan aggregate    List ranked candidates from the DB (for /lessons:review)

Options:
  --help, -h   Show help for a subcommand

Examples:
  node scripts/lessons.mjs add --interactive
  node scripts/lessons.mjs add --json '{"summary":"...","problem":"...","solution":"..."}'
  node scripts/lessons.mjs build
  node scripts/lessons.mjs list
  node scripts/lessons.mjs review
  node scripts/lessons.mjs scan
  node scripts/lessons.mjs scan aggregate
  node scripts/lessons.mjs promote --ids <id1>,<id2>
  node scripts/lessons.mjs promote --ids <id1> --archive "<id2>:reason"
  node scripts/lessons.mjs doctor
`.trim(),

  doctor: `
lessons doctor — Audit active lessons for quality issues.

Per-lesson checks:
  - dead-trigger: hint/guard missing toolNames — lesson can never fire
  - directive-with-toolNames: toolNames silently ignored for directive/protocol types
  - summary-too-long: summary > 80 chars (truncated in injection output)
  - summary-truncated: summary ends with ... (truncation indicator)
  - placeholder: unfilled template placeholders in summary, problem, or solution
  - no-patterns: hint/guard with no commandPatterns or pathPatterns (fires on every call)
  - weak-pair: solution < 60 chars, or solution Jaccard similarity with problem >= 0.7
  - overspecified-trigger: commandPattern > 40 non-regex chars (too specific, misses variants)
  - solution-staleness: solution contains version strings that may be outdated
  - context-bleed: problem/solution contains session-specific language (first-person, "this repo")
  - orphaned-scope: scope ID not found in ~/.claude/projects/ — lesson will never fire

Store-level checks:
  - priority-homogeneity: >80% of lessons share the same priority value

Usage:
  node scripts/lessons.mjs doctor
  node scripts/lessons.mjs doctor --json

Options:
  --json   Output as { lessons: [...], store: [...] } JSON; exits 1 if any issues
`.trim(),

  add: `
lessons add — Add a new lesson to the store.

Usage:
  node scripts/lessons.mjs add --interactive
  node scripts/lessons.mjs add --json '<json-string>'
  node scripts/lessons.mjs add --file <path>
  echo '<json>' | node scripts/lessons.mjs add

Required fields (in JSON):
  summary       One-line description of the lesson
  problem       What went wrong and why
  solution      The correction that resolves it

Optional fields:
  tool            Tool name(s), comma-separated (e.g. "Bash,Edit")
  trigger         Shell command or path that triggers the issue
  commandPatterns Array of regex strings to match Bash commands
  pathPatterns    Array of glob patterns to match file paths
  tags            Array of category:value strings
  priority        Integer 1-10 (default: 5)
  confidence      Float 0.0-1.0 (default: 0.8)

Notes:
  - Lessons below confidence 0.7 are flagged needsReview and excluded from the manifest.
  - Duplicate detection uses both exact content hash and fuzzy Jaccard similarity (≥0.5).
  - Intake validation rejects: truncated summaries, template placeholders, prose triggers.
`.trim(),

  build: `
lessons build — Rebuild the lesson manifest from lessons.json.

Usage:
  node scripts/lessons.mjs build

The manifest is a pre-compiled, runtime-optimized view of the lesson store.
It contains only the fields needed for matching and injection, with regex
patterns pre-compiled as { source, flags } objects.

Lessons are excluded from the manifest if:
  - confidence < minConfidence (from config.json, default 0.5)
  - priority < minPriority (from config.json, default 1)
  - needsReview is true
`.trim(),

  list: `
lessons list — List all lessons with key fields.

Usage:
  node scripts/lessons.mjs list [--json]

Options:
  --json   Output as JSON array instead of formatted text
`.trim(),

  review: `
lessons review — Review T2 scan candidates against intake validation rules.

Usage:
  node scripts/lessons.mjs review [--batch=N] [--offset=N]

Options:
  --batch=N   Show N candidates at a time (default: all)
  --offset=N  Skip first N candidates (default: 0)

Shows each candidate with a PASS/FAIL status based on intake validation rules:
  - Problem and solution meet minimum length
  - No unfilled template placeholders
  - Trigger is a shell command, not prose
  - Not a fuzzy duplicate of an existing lesson (Jaccard ≥ 0.5)

Grouped by tag → tool, with similarity clustering when detected.
`.trim(),

  promote: `
lessons promote — Promote candidates to active, archive, or patch fields.

Usage:
  node scripts/lessons.mjs promote --ids <id1>,<id2>
  node scripts/lessons.mjs promote --ids <id1> --archive "<id2>:reason"
  node scripts/lessons.mjs promote --ids <id1> --patch '{"<id1>": {"priority": 8}}'

Options:
  --ids <id1,...>             Comma-separated IDs to promote to status='active'
  --archive "<id>:<reason>"   Archive an ID with a reason (repeatable)
  --patch '<json>'            Per-id field overrides as a JSON object

Notes:
  - Promoted IDs move to status='active' and are included in the next manifest build
  - Archived IDs move to status='archived' and are hidden from future reviews
  - Skipped IDs (not mentioned) remain as status='candidate' for the next session
  - A review session audit log is written to the review_sessions table in lessons.db
  - The manifest is automatically rebuilt when any IDs are promoted
`.trim(),

  scan: `
lessons scan — Incrementally scan session logs for new lesson candidates.

Usage:
  node scripts/lessons.mjs scan [options]

Options:
  --full            Force full rescan (ignore saved byte offsets)
  --path <dir>      Scan a specific directory instead of ~/.claude/projects/
  --tier1-only      Only structured scanning (#lesson tags)
  --tier2-only      Only heuristic scanning (error→correction detection)
  --semantic        Also run Tier 3 semantic scan (incremental, Ollama required)
  --semantic-full   Reset semantic offsets and rescan all historical sessions
  --dry-run         Show candidates without saving state
  --verbose, -v     Show per-file scan details
  --auto            Background/silent mode (no stdout)

Subcommands:
  aggregate         List ranked candidates from the DB (JSON output)
`.trim(),

  scanAggregate: `
lessons scan aggregate — List ranked candidates from the DB.

Reads from lessons.db and outputs a ranked JSON list of candidates,
applying multi-session and multi-project confidence/priority boosts.
This is the input for the /lessons:review LLM review pass.

Usage:
  node scripts/lessons.mjs scan aggregate

Output: JSON to stdout — { generatedAt, totalCandidates, candidates[] }
`.trim(),

  edit: `
lessons edit — Edit fields on an existing lesson in place.

Usage:
  node scripts/lessons.mjs edit --id <id> --patch '<json>'

Options:
  --id <id>        ID of the lesson to edit (any status)
  --patch '<json>' JSON object of fields to update

Patchable fields:
  summary, problem, solution, type,
  toolNames, commandPatterns, commandMatchTarget, pathPatterns, priority, confidence, tags

Notes:
  - Status is not changed — active lessons stay active, candidates stay candidates.
  - The manifest is automatically rebuilt when an active lesson is edited.
`.trim(),

  restore: `
lessons restore — Restore archived lessons back to active status.

Usage:
  node scripts/lessons.mjs restore --ids <id1>,<id2>,...

Options:
  --ids <id1,...>   Comma-separated IDs of archived lessons to restore

Notes:
  - Only lessons with status='archived' can be restored.
  - archivedAt and archiveReason are cleared on restore.
  - The manifest is automatically rebuilt after restore.
`.trim(),

  purge: `
lessons purge — Archive all candidates below a confidence threshold.

Usage:
  node scripts/lessons.mjs purge --below-conf <threshold>
  node scripts/lessons.mjs purge --below-conf <threshold> --dry-run

Options:
  --below-conf <n>   Archive candidates with confidence < n (0–1, required)
  --dry-run          Show what would be archived without making changes

Notes:
  - Only candidates (status='candidate') are affected; active lessons are untouched.
  - Archived candidates are hidden from 'lessons review' and 'scan aggregate'.
  - Use 'lessons restore' to recover individual IDs if needed.
  - A review session is written to the DB for auditability.
`.trim(),

  windows: `
lessons windows — Manage pending semantic windows from Tier 3 scanning.

Usage:
  node scripts/lessons.mjs windows                   List all pending windows
  node scripts/lessons.mjs windows --show <id>       Print full window text
  node scripts/lessons.mjs windows --archive <id>    Mark window(s) as processed

Options:
  --show <id>      Print full text of a pending window (for lesson extraction)
  --archive <ids>  Comma-separated IDs to mark as processed

Notes:
  - Pending windows are conversation fragments flagged by semantic similarity to existing lessons.
  - Use 'lessons review' to see a summary of pending windows alongside candidates.
  - Extract a lesson with 'lessons add', then archive the window with --archive.
`.trim(),

  onboard: `
lessons onboard — Batch-import lessons from a JSON array.

Usage:
  node scripts/lessons.mjs onboard --file <path> [--from N] [--count M]
  node scripts/lessons.mjs onboard --json '<json-array>' [--from N] [--count M]

Options:
  --file <path>   Path to a JSON file containing an array of lesson objects
  --json <str>    Inline JSON array string
  --from N        Skip the first N items (0-indexed); for resume and batching
  --count M       Process at most M items; for batching

Each array element uses the same fields as \`lessons add\`.
Required per element: summary, problem, solution.

Notes:
  - Each lesson is validated independently; failures are reported and skipped.
  - Duplicate detection (hash + fuzzy Jaccard) applies per lesson.
  - The manifest is rebuilt once after all lessons are processed.
  - Use /lessons:onboard for the interactive per-lesson approval workflow.
`.trim(),
};

// ─── ULID ────────────────────────────────────────────────────────────

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateUlid() {
  let now = Date.now();
  let timeStr = '';
  for (let i = 10; i > 0; i--) {
    const mod = now % ENCODING.length;
    timeStr = ENCODING[mod] + timeStr;
    now = (now - mod) / ENCODING.length;
  }
  const bytes = randomBytes(16);
  let randStr = '';
  for (let i = 0; i < 16; i++) randStr += ENCODING[bytes[i] % ENCODING.length];
  return timeStr + randStr;
}

// ─── Slug ────────────────────────────────────────────────────────────

function generateSlug(summary) {
  const base = summary
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/-$/, '');
  return `${base}-${randomBytes(2).toString('hex').slice(0, 4)}`;
}

// ─── Validation ──────────────────────────────────────────────────────

const TEMPLATE_PLACEHOLDER_RE =
  /<(what_went_wrong|the_correction|tool_name|command_or_action|category_value_tags)>/i;
const PROSE_TRIGGER_RE =
  /^(explaining|implementing|registering|seeing|fixing|doing|using|running|working|writing|checking|adding|removing|creating|updating|building|testing|debugging|reviewing)\b/i;
const MIN_FIELD_LENGTH = 20;

function validateLesson(input) {
  const errors = [];
  if (input.summary.endsWith('...')) errors.push('summary appears truncated (ends with ...)');
  if (TEMPLATE_PLACEHOLDER_RE.test(input.summary))
    errors.push('summary contains unfilled template placeholder');
  if (input.summary.length < MIN_FIELD_LENGTH)
    errors.push(`summary too short (${input.summary.length} chars, min ${MIN_FIELD_LENGTH})`);
  if (TEMPLATE_PLACEHOLDER_RE.test(input.problem))
    errors.push('problem contains unfilled template placeholder');
  if (input.problem.length < MIN_FIELD_LENGTH)
    errors.push(`problem too short (${input.problem.length} chars, min ${MIN_FIELD_LENGTH})`);
  if (TEMPLATE_PLACEHOLDER_RE.test(input.solution))
    errors.push('solution contains unfilled template placeholder');
  if (input.solution.length < MIN_FIELD_LENGTH)
    errors.push(`solution too short (${input.solution.length} chars, min ${MIN_FIELD_LENGTH})`);
  if (input.trigger && PROSE_TRIGGER_RE.test(input.trigger.trim()))
    errors.push(`trigger "${input.trigger}" looks like prose, not a shell command`);
  return errors;
}

// ─── Fuzzy similarity ────────────────────────────────────────────────

function tokenize(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
}

function jaccardSimilarity(a, b) {
  const A = tokenize(a),
    B = tokenize(b);
  const intersection = [...A].filter(w => B.has(w)).length;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : intersection / union;
}

// ─── Lesson building ─────────────────────────────────────────────────

function buildInjection(lesson) {
  return `## Lesson: ${lesson.summary}\n${lesson.problem}\n**Fix**: ${lesson.solution}`;
}

function buildTriggers(input) {
  const triggers = { toolNames: [], commandPatterns: [], pathPatterns: [], contentPatterns: [] };

  if (input.tool)
    triggers.toolNames = input.tool
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

  if (input.trigger) {
    const escaped = input.trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    triggers.commandPatterns = [`\\b${escaped}\\b`];
  }

  if (input.commandPatterns) {
    const patterns = Array.isArray(input.commandPatterns)
      ? input.commandPatterns
      : [input.commandPatterns];
    triggers.commandPatterns = patterns.filter(p => {
      try {
        new RegExp(p);
        return true;
      } catch {
        return false;
      }
    });
  }

  if (input.pathPatterns) {
    triggers.pathPatterns = Array.isArray(input.pathPatterns)
      ? input.pathPatterns
      : [input.pathPatterns];
  }

  return triggers;
}

// ─── Config loading ──────────────────────────────────────────────────

/**
 * Load config.json and apply LESSONS_* environment variable overrides.
 *
 * Environment variables (all optional):
 *   LESSONS_CONFIG_PATH                    — override path to config.json
 *   LESSONS_INJECTION_BUDGET_BYTES         — injectionBudgetBytes (integer)
 *   LESSONS_MAX_LESSONS_PER_INJECTION      — maxLessonsPerInjection (integer)
 *   LESSONS_MIN_CONFIDENCE                 — minConfidence (float)
 *   LESSONS_MIN_PRIORITY                   — minPriority (integer)
 *   LESSONS_COMPACTION_REINJECTION_THRESHOLD — compactionReinjectionThreshold (integer)
 *   LESSONS_SCAN_PATHS                     — scanPaths (colon-separated list)
 *   LESSONS_AUTO_SCAN_INTERVAL_HOURS       — autoScanIntervalHours (integer)
 *   LESSONS_MAX_CANDIDATES_PER_SCAN        — maxCandidatesPerScan (integer)
 *
 * @returns {Record<string, unknown>}
 */
function loadConfig() {
  let base = {};
  try {
    base = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    // missing config.json is fine — defaults apply
  }

  const env = process.env;
  const overrides = {};

  if (env.LESSONS_INJECTION_BUDGET_BYTES !== undefined)
    overrides.injectionBudgetBytes = parseInt(env.LESSONS_INJECTION_BUDGET_BYTES, 10);
  if (env.LESSONS_MAX_LESSONS_PER_INJECTION !== undefined)
    overrides.maxLessonsPerInjection = parseInt(env.LESSONS_MAX_LESSONS_PER_INJECTION, 10);
  if (env.LESSONS_MIN_CONFIDENCE !== undefined)
    overrides.minConfidence = parseFloat(env.LESSONS_MIN_CONFIDENCE);
  if (env.LESSONS_MIN_PRIORITY !== undefined)
    overrides.minPriority = parseInt(env.LESSONS_MIN_PRIORITY, 10);
  if (env.LESSONS_COMPACTION_REINJECTION_THRESHOLD !== undefined)
    overrides.compactionReinjectionThreshold = parseInt(
      env.LESSONS_COMPACTION_REINJECTION_THRESHOLD,
      10
    );
  if (env.LESSONS_SCAN_PATHS !== undefined)
    overrides.scanPaths = env.LESSONS_SCAN_PATHS.split(':').filter(Boolean);
  if (env.LESSONS_AUTO_SCAN_INTERVAL_HOURS !== undefined)
    overrides.autoScanIntervalHours = parseInt(env.LESSONS_AUTO_SCAN_INTERVAL_HOURS, 10);
  if (env.LESSONS_MAX_CANDIDATES_PER_SCAN !== undefined)
    overrides.maxCandidatesPerScan = parseInt(env.LESSONS_MAX_CANDIDATES_PER_SCAN, 10);

  return { ...base, ...overrides };
}

// ─── Manifest building ───────────────────────────────────────────────

function buildManifest() {
  const db = openDb();
  const lessons = getManifestRecords(db);
  closeDb(db);

  const config = loadConfig();
  const minConfidence = config.minConfidence ?? 0.5;
  const minPriority = config.minPriority ?? 1;

  const manifestLessons = {};
  let included = 0,
    excluded = 0;

  for (const lesson of lessons) {
    const isDisabled = lesson.status === 'disabled';

    if (!isDisabled) {
      if ((lesson.confidence ?? 0) < minConfidence) {
        excluded++;
        continue;
      }
      if ((lesson.priority ?? 0) < minPriority) {
        excluded++;
        continue;
      }
    }

    const commandRegexSources = (lesson.commandPatterns ?? [])
      .map(p => {
        try {
          new RegExp(p);
          return { source: p, flags: '' };
        } catch {
          console.warn(`  Warning: invalid regex in ${lesson.slug}: ${p}`);
          return null;
        }
      })
      .filter(Boolean);

    const pathRegexSources = (lesson.pathPatterns ?? [])
      .map(p => {
        const src = globToRegex(p);
        try {
          new RegExp(src);
          return { source: src, flags: 'i' };
        } catch {
          console.warn(`  Warning: invalid path pattern in ${lesson.slug}: ${p}`);
          return null;
        }
      })
      .filter(Boolean);

    const lessonType = lesson.type ?? 'hint';
    const commandMatchTarget =
      lesson.commandMatchTarget ?? (lessonType === 'guard' ? 'executable' : 'full');

    manifestLessons[lesson.id] = {
      slug: lesson.slug,
      type: lessonType,
      priority: lesson.priority,
      toolNames: lesson.toolNames ?? [],
      commandRegexSources,
      commandMatchTarget,
      pathRegexSources,
      tags: lesson.tags ?? [],
      scope: lesson.scope ?? null,
      message: buildInjection(lesson),
      summary: lesson.summary,
      problem: lesson.problem ?? '',
      solution: lesson.solution ?? '',
      ...(isDisabled ? { disabled: true } : {}),
    };
    included++;
  }

  const manifest = {
    $schema: '../schemas/manifest.schema.json',
    type: 'lessons-learned-manifest',
    version: 1,
    generatedAt: new Date().toISOString(),
    config: {
      injectionBudgetBytes: config.injectionBudgetBytes ?? 4096,
      maxLessonsPerInjection: config.maxLessonsPerInjection ?? 3,
      minConfidence,
      minPriority,
      compactionReinjectionThreshold: config.compactionReinjectionThreshold ?? 7,
    },
    lessons: manifestLessons,
  };

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Built manifest: ${included} lessons included, ${excluded} excluded`);
  console.log(`  → ${MANIFEST_PATH}`);
}

function globToRegex(pattern) {
  if (/[\\^$|+()[\]{}]/.test(pattern)) return pattern;
  return pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
}

// ─── Internal add (used by scan auto-promote) ────────────────────────

/**
 * Core lesson-add logic without process.exit or manifest rebuild.
 * Returns { ok: true, lesson } or { ok: false, error: string }.
 */
function addLessonInternal(input) {
  const validationErrors = validateLesson(input);
  if (validationErrors.length > 0) {
    return { ok: false, error: `validation: ${validationErrors.join('; ')}` };
  }

  const triggers = buildTriggers(input);
  const now = new Date().toISOString();
  const confidence = input.confidence ?? 0.8;
  const slug = generateSlug(input.summary);
  const commandPatterns = triggers.commandPatterns ?? [];
  const type = input.type ?? 'hint';

  const record = {
    id: generateUlid(),
    slug,
    status: confidence >= 0.7 ? 'active' : 'reviewed',
    type,
    summary: input.summary,
    problem: input.problem,
    solution: input.solution,
    toolNames: triggers.toolNames ?? [],
    commandPatterns,
    pathPatterns: triggers.pathPatterns ?? [],
    priority: input.priority ?? 5,
    confidence,
    tags: input.tags ?? [],
    source: type === 'directive' ? 'manual' : 'manual',
    sourceSessionIds: input.sourceSessionIds ?? [],
    occurrenceCount: input.occurrenceCount ?? 0,
    sessionCount: 0,
    projectCount: 0,
    contentHash: computeContentHashFromDb({
      problem: input.problem,
      solution: input.solution,
      commandPatterns,
    }),
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
    archivedAt: null,
    archiveReason: null,
  };

  const db = openDb();
  const result = insertCandidate(db, record);
  closeDb(db);

  if (!result.ok) {
    if (result.reason === 'duplicate_hash') {
      return { ok: false, error: `duplicate content hash (${result.existing?.slug})` };
    }
    return { ok: false, error: `fuzzy duplicate of "${result.existing?.slug}"` };
  }

  return { ok: true, lesson: record };
}

// ─── Subcommands ─────────────────────────────────────────────────────

async function cmdAdd(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP.add);
    return;
  }

  let input;

  if (args.includes('--interactive') || args.includes('-i')) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const ask = q => new Promise(r => rl.question(q, r));
    console.error('Add a new lesson (Ctrl+C to cancel)\n');
    const summary = await ask('Summary (one line): ');
    const problem = await ask('Problem: ');
    const solution = await ask('Solution: ');
    const type = await ask('Type (directive/guard/hint/protocol) [hint]: ');
    const tool = await ask('Tool(s) comma-separated (e.g. Bash,Edit): ');
    const trigger = await ask('Trigger (command or path): ');
    const tagsStr = await ask('Tags comma-separated (e.g. lang:python,tool:pytest): ');
    const priorityStr = await ask('Priority 1-10 [5]: ');
    const confidenceStr = await ask('Confidence 0.0-1.0 [0.8]: ');
    rl.close();
    input = {
      summary: summary.trim(),
      problem: problem.trim(),
      solution: solution.trim(),
      type: type.trim() || 'hint',
      tool: tool.trim() || null,
      trigger: trigger.trim() || null,
      tags: tagsStr
        ? tagsStr
            .split(',')
            .map(t => t.trim())
            .filter(Boolean)
        : [],
      priority: priorityStr ? parseInt(priorityStr, 10) : 5,
      confidence: confidenceStr ? parseFloat(confidenceStr) : 0.8,
    };
  } else if (args.includes('--json')) {
    const idx = args.indexOf('--json');
    if (!args[idx + 1]) {
      console.error('Error: --json requires a JSON string');
      process.exit(1);
    }
    input = JSON.parse(args[idx + 1]);
  } else if (args.includes('--file')) {
    const idx = args.indexOf('--file');
    if (!args[idx + 1]) {
      console.error('Error: --file requires a file path');
      process.exit(1);
    }
    input = JSON.parse(readFileSync(args[idx + 1], 'utf8'));
  } else {
    try {
      const stdin = readFileSync(0, 'utf8');
      if (stdin.trim()) input = JSON.parse(stdin);
    } catch {
      /* no stdin */
    }
  }

  if (!input) {
    console.error(HELP.add);
    process.exit(1);
  }
  if (!input.summary || !input.problem || !input.solution) {
    console.error('Error: summary, problem, and solution are required');
    process.exit(1);
  }

  const VALID_TYPES = ['directive', 'guard', 'hint', 'protocol'];
  if (input.type && !VALID_TYPES.includes(input.type)) {
    console.error(`Error: type must be one of: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
  }

  if (input.type === 'directive') {
    input.source = 'manual';
  }

  if (input.type === 'guard' && (!input.solution || input.solution.length < 20)) {
    console.error('Error: guard lessons require actionable solution (≥20 chars)');
    process.exit(1);
  }

  const result = addLessonInternal(input);
  if (!result.ok) {
    console.error(`Failed: ${result.error}`);
    process.exit(1);
  }

  const { lesson } = result;
  console.log(`Added lesson: ${lesson.slug} (${lesson.id})`);
  console.log(`  Summary:    ${lesson.summary}`);
  console.log(`  Type:       ${lesson.type}`);
  console.log(`  Priority:   ${lesson.priority} | Confidence: ${lesson.confidence}`);
  console.log(`  Tags:       ${lesson.tags.join(', ') || '(none)'}`);
  console.log('\nRebuilding manifest...');
  buildManifest();
}

async function cmdOnboard(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP.onboard);
    return;
  }

  let lessons;

  if (args.includes('--file')) {
    const idx = args.indexOf('--file');
    if (!args[idx + 1]) {
      console.error('Error: --file requires a file path');
      process.exit(1);
    }
    lessons = JSON.parse(readFileSync(args[idx + 1], 'utf8'));
  } else if (args.includes('--json')) {
    const idx = args.indexOf('--json');
    if (!args[idx + 1]) {
      console.error('Error: --json requires a JSON array string');
      process.exit(1);
    }
    lessons = JSON.parse(args[idx + 1]);
  } else {
    console.error(HELP.onboard);
    process.exit(1);
  }

  if (!Array.isArray(lessons)) {
    console.error('Error: input must be a JSON array of lesson objects');
    process.exit(1);
  }

  const fromIdx = args.includes('--from') ? parseInt(args[args.indexOf('--from') + 1], 10) : 0;
  const maxCount = args.includes('--count')
    ? parseInt(args[args.indexOf('--count') + 1], 10)
    : Infinity;
  const slice = lessons.slice(fromIdx, fromIdx + maxCount);
  const total = lessons.length;

  let accepted = 0;
  let failed = 0;

  for (let i = 0; i < slice.length; i++) {
    const absoluteIdx = fromIdx + i;
    const item = slice[i];
    const label = item.summary ? `"${item.summary.slice(0, 60)}"` : `#${absoluteIdx + 1}`;
    const result = addLessonInternal(item);
    if (result.ok) {
      console.log(`[${absoluteIdx + 1}/${total}] ✓  ${label}`);
      accepted++;
    } else {
      console.log(`[${absoluteIdx + 1}/${total}] ✗  ${label} — ${result.error}`);
      failed++;
    }
  }

  console.log(`\nDone: ${accepted} added, ${failed} failed`);
  if (accepted > 0) {
    console.log('Rebuilding manifest...');
    buildManifest();
  }
}

function cmdBuild(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP.build);
    return;
  }
  buildManifest();
}

function cmdList(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP.list);
    return;
  }
  const db = openDb();
  const lessons = getActiveRecords(db);
  closeDb(db);

  if (args.includes('--json')) {
    console.log(JSON.stringify(lessons, null, 2));
    return;
  }

  console.log(`${lessons.length} lessons\n`);
  for (const l of lessons) {
    const typeLabel = l.type ? ` [${l.type}]` : '';
    const sessionStart = l.type === 'directive' || l.type === 'protocol';
    const injectLabel = sessionStart ? ' [session-start]' : '';
    const patterns = l.commandPatterns?.length
      ? l.commandPatterns.join(', ')
      : l.pathPatterns?.length
        ? l.pathPatterns.join(', ')
        : '(no pattern)';
    console.log(`${l.slug}${typeLabel}${injectLabel}`);
    console.log(`  ${l.summary}`);
    console.log(`  patterns: ${patterns}`);
    console.log(`  conf:${l.confidence} pri:${l.priority} tags:${l.tags.join(', ') || 'none'}`);
    console.log();
  }
}

/**
 * Clusters candidates by Jaccard similarity on problem field.
 * Returns array of clusters, each containing similar candidates.
 * @unused - Reserved for future --cluster-preview feature
 */
function _clusterBySimilarity(candidates, threshold = 0.6) {
  const clusters = [];
  const processed = new Set();

  for (let i = 0; i < candidates.length; i++) {
    if (processed.has(i)) continue;

    const cluster = [candidates[i]];
    processed.add(i);

    // Find all similar candidates
    for (let j = i + 1; j < candidates.length; j++) {
      if (processed.has(j)) continue;

      const similarity = jaccardSimilarity(candidates[i].problem, candidates[j].problem);
      if (similarity >= threshold) {
        cluster.push(candidates[j]);
        processed.add(j);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

/**
 * Generates a comparison preview for a cluster
 * @unused - Reserved for future --cluster-preview feature
 */
function _generateClusterPreview(cluster) {
  const items = cluster.map(c => c.candidate);
  const ids = items.map(c => c.id.slice(0, 8));

  let preview = `CLUSTER COMPARISON (${items.length} candidates)\n${'─'.repeat(60)}\n\n`;

  // Check what's the same vs different
  const problemSame = items.every(c => c.problem === items[0].problem);
  const solutionSame = items.every(c => c.solution === items[0].solution);
  const confSame = items.every(c => c.confidence === items[0].confidence);
  const priSame = items.every(c => c.priority === items[0].priority);

  // Show IDs
  preview += `IDs: ${cluster.map((c, i) => `[${c.index}] ${ids[i]}`).join(', ')}\n\n`;

  // Problem
  if (problemSame) {
    preview += `Problem: IDENTICAL (${items[0].problem.length} chars)\n`;
    preview += `  ${items[0].problem.slice(0, 120)}...\n\n`;
  } else {
    preview += `Problem: VARIATIONS\n`;
    items.forEach((c, i) => {
      preview += `  [${cluster[i].index}] ${c.problem.slice(0, 80)}...\n`;
    });
    preview += '\n';
  }

  // Solution
  if (solutionSame) {
    preview += `Solution: IDENTICAL (${items[0].solution.length} chars)\n`;
    preview += `  ${items[0].solution.slice(0, 120)}...\n\n`;
  } else {
    preview += `Solution: VARIATIONS\n`;
    items.forEach((c, i) => {
      preview += `  [${cluster[i].index}] ${c.solution.slice(0, 80)}...\n`;
    });
    preview += '\n';
  }

  // Metadata differences
  preview += `Metadata:\n`;
  preview += `  Conf:     ${items.map((c, i) => `[${cluster[i].index}] ${c.confidence}`).join('  ')}  ${confSame ? '[SAME]' : '[DIFF]'}\n`;
  preview += `  Priority: ${items.map((c, i) => `[${cluster[i].index}] ${c.priority}`).join('  ')}  ${priSame ? '[SAME]' : '[DIFF]'}\n`;

  // Tags
  preview += `  Tags:\n`;
  items.forEach((c, i) => {
    const tags = c.tags?.join(', ') || 'none';
    preview += `    [${cluster[i].index}] ${tags}\n`;
  });

  // Merged result preview
  preview += `\n${'─'.repeat(60)}\nMERGED RESULT:\n`;
  preview += `  Problem: ${problemSame ? 'keep shared' : 'longest'} (${Math.max(...items.map(c => c.problem.length))} chars)\n`;
  preview += `  Solution: ${solutionSame ? 'keep shared' : 'longest'} (${Math.max(...items.map(c => c.solution.length))} chars)\n`;

  const allTags = new Set(items.flatMap(c => c.tags || []));
  preview += `  Tags: ${[...allTags].join(', ')} (union)\n`;
  preview += `  Conf: ${Math.max(...items.map(c => c.confidence))} (max)\n`;
  preview += `  Priority: ${Math.max(...items.map(c => c.priority))} (max)\n`;

  return preview;
}

/**
 * Split text into diff-able sentences (on '. ' boundaries and newlines).
 */
function splitSentences(text) {
  return text
    .split(/\.\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Render a sentence-level diff between two texts.
 * Shared sentences → plain. A-only → red `-`. B-only → green `+`.
 * Returns an array of formatted lines.
 */
function sentenceDiff(textA, textB) {
  const sentA = splitSentences(textA);
  const sentB = splitSentences(textB);
  const setA = new Set(sentA);
  const setB = new Set(sentB);
  const lines = [];

  // Walk A sentences, marking shared vs removed
  for (const s of sentA) {
    if (setB.has(s)) {
      lines.push(`  ${s}`);
    } else {
      lines.push(ANSI.red(`- ${s}`));
    }
  }
  // Add B-only sentences
  for (const s of sentB) {
    if (!setA.has(s)) {
      lines.push(ANSI.green(`+ ${s}`));
    }
  }

  return lines;
}

/**
 * Render the action preview block for a cluster.
 * Shows what merge/promote-best/archive-all would produce.
 */
function renderClusterActions(cluster) {
  const items = cluster.map(c => c.candidate);
  const [a, b] = items;

  // Merge: longest field wins, tag union, max conf/priority
  const mergedProblem = a.problem.length >= b.problem.length ? a.problem : b.problem;
  const mergedSolution = a.solution.length >= b.solution.length ? a.solution : b.solution;
  const mergedTags = [...new Set([...(a.tags ?? []), ...(b.tags ?? [])])];
  const mergedConf = Math.max(a.confidence, b.confidence);
  const mergedPri = Math.max(a.priority, b.priority);

  // Best: candidate with highest confidence (tie → first)
  const best = a.confidence >= b.confidence ? { label: '[A]', c: a } : { label: '[B]', c: b };
  const other = best.label === '[A]' ? { label: '[B]', c: b } : { label: '[A]', c: a };

  const lines = [];
  lines.push(ANSI.dim('  Actions:'));

  // merge action
  lines.push(
    ANSI.dim(
      `  merge  → problem: ${mergedProblem.slice(0, 60).replace(/\n/g, ' ')}… | solution: ${mergedSolution.slice(0, 40).replace(/\n/g, ' ')}… | tags: ${mergedTags.join(', ')} | conf:${mergedConf} pri:${mergedPri}`
    )
  );

  // promote-best action
  const bestTagStr = best.c.tags?.join(', ') || 'none';
  lines.push(
    ANSI.dim(
      `  promote-best ${best.label} → conf:${best.c.confidence} · ${best.c.sessionCount} sessions · ${bestTagStr} (archive ${other.label})`
    )
  );

  // archive-all action
  lines.push(ANSI.dim(`  archive-all → discard both candidates`));

  return lines;
}

/**
 * Render a cluster as a unified diff view.
 * For 2-member clusters: full diff layout.
 * For 3+ members: compact listing (rare in practice).
 */
function renderClusterDiff(cluster, totalCandidates, validationErrors) {
  const WIDTH = 70;
  const [entryA, entryB] = cluster;
  const a = entryA.candidate;
  const b = entryB?.candidate;

  // Determine shared tool and first tag for the header
  const toolLabel = a.toolNames?.[0] ?? 'unknown';
  const firstTag = a.tags?.[0] ?? b?.tags?.[0] ?? '';
  const memberCount = cluster.length;

  const headerBase = `── cluster · ${memberCount} similar · ${toolLabel}${firstTag ? ' · ' + firstTag : ''} `;
  const headerPad = '─'.repeat(Math.max(0, WIDTH - headerBase.length));
  console.log(`\n${headerBase}${headerPad}`);

  if (memberCount === 2) {
    // Problem diff
    console.log(ANSI.bold('  Problem'));
    const problemLines = sentenceDiff(a.problem, b.problem);
    for (const line of problemLines) console.log(`  ${line}`);

    console.log('');

    // Solution diff
    console.log(ANSI.bold('  Solution'));
    const solutionLines = sentenceDiff(a.solution, b.solution);
    for (const line of solutionLines) console.log(`  ${line}`);

    console.log('');

    // Metadata footer: [A] in red, [B] in green
    const aErrors = validationErrors.get(a.id) ?? [];
    const bErrors = validationErrors.get(b.id) ?? [];
    const aStatus = aErrors.length === 0 ? '✓' : '✗';
    const bStatus = bErrors.length === 0 ? '✓' : '✗';
    const aTags = a.tags?.join(', ') || 'none';
    const bTags = b.tags?.join(', ') || 'none';

    console.log(
      ANSI.red(
        `  [A]${entryA.index}/${totalCandidates} ${aStatus} conf:${a.confidence} · ${a.sessionCount} sessions · ${aTags}${aErrors.length ? ' · ' + aErrors.join('; ') : ''}`
      )
    );
    console.log(
      ANSI.green(
        `  [B]${entryB.index}/${totalCandidates} ${bStatus} conf:${b.confidence} · ${b.sessionCount} sessions · ${bTags}${bErrors.length ? ' · ' + bErrors.join('; ') : ''}`
      )
    );

    console.log('');
    for (const line of renderClusterActions(cluster)) console.log(line);
  } else {
    // 3+ members: compact listing
    for (const { candidate: c, index } of cluster) {
      const errs = validationErrors.get(c.id) ?? [];
      const status = errs.length === 0 ? '✓' : '✗';
      const tags = c.tags?.join(', ') || 'none';
      console.log(
        `  [${index}/${totalCandidates}] ${status} conf:${c.confidence} · ${c.sessionCount} sessions · ${tags}`
      );
      console.log(`    P: ${c.problem.slice(0, 80).replace(/\n/g, ' ')}`);
      console.log(`    S: ${c.solution.slice(0, 80).replace(/\n/g, ' ')}`);
      if (errs.length) console.log(`    ! ${errs.join(', ')}`);
    }
  }

  console.log('─'.repeat(WIDTH));
}

function cmdReview(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP.review);
    return;
  }

  // Parse flags
  let batchSize = null;
  let offset = 0;
  const showClusters = !args.includes('--no-clusters');

  for (const arg of args) {
    if (arg.startsWith('--batch=')) {
      batchSize = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--offset=')) {
      offset = parseInt(arg.split('=')[1], 10);
    }
  }

  const db = openDb();
  const allCandidates = getCandidateRecords(db);
  const activeProblemTexts = getActiveRecords(db).map(l => ({ slug: l.slug, problem: l.problem }));
  closeDb(db);

  if (allCandidates.length === 0) {
    console.log('No candidates found. Run: node scripts/lessons.mjs scan');
    return;
  }

  // Apply batch/offset
  const totalCandidates = allCandidates.length;
  const candidates = batchSize
    ? allCandidates.slice(offset, offset + batchSize)
    : allCandidates.slice(offset);

  const showing = candidates.length;
  const remaining = totalCandidates - offset - showing;

  if (batchSize) {
    console.log(
      `\n╔═══ Batch ${Math.floor(offset / batchSize) + 1} of ${Math.ceil(totalCandidates / batchSize)} ═══════════════════════════════════════════════════════`
    );
    console.log(`║ Showing ${showing} of ${totalCandidates} candidates (${remaining} remaining)`);
    console.log(`╚${'═'.repeat(70)}`);
  }

  if (candidates.length === 0) {
    console.log('No candidates in this range.');
    return;
  }

  // Cluster within this batch
  let clusters = [];
  if (showClusters) {
    const processed = new Set();
    for (let i = 0; i < candidates.length; i++) {
      if (processed.has(i)) continue;
      const cluster = [{ candidate: candidates[i], index: offset + i + 1 }];
      processed.add(i);

      for (let j = i + 1; j < candidates.length; j++) {
        if (processed.has(j)) continue;
        const sim = jaccardSimilarity(candidates[i].problem, candidates[j].problem);
        if (sim >= 0.5) {
          cluster.push({ candidate: candidates[j], index: offset + j + 1 });
          processed.add(j);
        }
      }

      clusters.push(cluster);
    }
  } else {
    clusters = candidates.map((c, i) => [{ candidate: c, index: offset + i + 1 }]);
  }

  // Pre-compute validation errors for every candidate in this batch
  const validationErrors = new Map();
  let pass = 0,
    fail = 0;

  for (const { candidate: c } of clusters.flat()) {
    const errors = [];
    if (!c.problem || c.problem.length < MIN_FIELD_LENGTH) errors.push('problem too short');
    if (!c.solution || c.solution.length < MIN_FIELD_LENGTH) errors.push('solution too short');
    if (TEMPLATE_PLACEHOLDER_RE.test(c.problem)) errors.push('problem has placeholder');
    if (TEMPLATE_PLACEHOLDER_RE.test(c.solution)) errors.push('solution has placeholder');
    const trigger = (c.commandPatterns ?? [])[0];
    if (trigger && PROSE_TRIGGER_RE.test(trigger.trim()))
      errors.push(`prose trigger: "${trigger}"`);
    const dup = activeProblemTexts.find(l => jaccardSimilarity(c.problem, l.problem) >= 0.5);
    if (dup)
      errors.push(
        `fuzzy duplicate of "${dup.slug}" (${jaccardSimilarity(c.problem, dup.problem).toFixed(2)})`
      );
    validationErrors.set(c.id, errors);
    if (errors.length === 0) pass++;
    else fail++;
  }

  for (const cluster of clusters) {
    if (cluster.length > 1) {
      // Cluster diff view
      renderClusterDiff(cluster, totalCandidates, validationErrors);
    } else {
      // Single-candidate card (unchanged style)
      const { candidate: c, index: candidateNum } = cluster[0];
      const errors = validationErrors.get(c.id) ?? [];
      const status = errors.length === 0 ? '✓ PASS' : '✗ FAIL';

      console.log(`\n┌─ [${candidateNum}/${totalCandidates}] ${status} ${'─'.repeat(55)}`);

      const tool = (c.toolNames?.[0] ?? 'unknown').padEnd(25);
      const conf = `conf:${c.confidence}`.padEnd(10);
      const pri = `pri:${c.priority}`.padEnd(8);
      const sessions = `sessions:${c.sessionCount}`.padEnd(12);
      console.log(`│ ${tool} ${conf} ${pri} ${sessions}`);

      const tags = c.tags?.length ? c.tags.join(', ') : 'none';
      console.log(`│ Tags: ${tags}`);
      console.log(`│ ID:   ${c.id}`);

      console.log(`├─ Problem ${'─'.repeat(60)}`);
      const problemLines = c.problem.split('\n');
      for (let i = 0; i < Math.min(2, problemLines.length); i++) {
        console.log(`│ ${problemLines[i].slice(0, 100)}`);
      }
      if (problemLines.length > 2 || c.problem.length > 200) {
        console.log(`│ ... (${c.problem.length} chars total)`);
      }

      console.log(`├─ Solution ${'─'.repeat(59)}`);
      const solutionLines = c.solution.split('\n');
      for (let i = 0; i < Math.min(2, solutionLines.length); i++) {
        console.log(`│ ${solutionLines[i].slice(0, 100)}`);
      }
      if (solutionLines.length > 2 || c.solution.length > 200) {
        console.log(`│ ... (${c.solution.length} chars total)`);
      }

      if (errors.length > 0) {
        console.log(`├─ Issues ${'─'.repeat(61)}`);
        console.log(`│ ${errors.join(', ')}`);
      }

      console.log(`└${'─'.repeat(70)}`);
    }
  }

  console.log(`\n${pass} pass, ${fail} fail`);

  if (batchSize && remaining > 0) {
    console.log(
      `Next: node scripts/lessons.mjs review --batch=${batchSize} --offset=${offset + batchSize}`
    );
  }

  // Show pending semantic windows if any
  const dbW = openDb();
  const pendingWindows = getPendingWindows(dbW);
  closeDb(dbW);

  if (pendingWindows.length > 0) {
    console.log(`\n${'═'.repeat(71)}`);
    console.log(`Pending Semantic Windows (${pendingWindows.length}) — from Tier 3 scanner`);
    console.log(`${'═'.repeat(71)}`);
    console.log(`These conversation windows are semantically similar to existing lessons.`);
    console.log(`Review each, extract a lesson with 'lessons add', then archive.\n`);
    for (const w of pendingWindows) {
      const preview = w.windowText.replace(/\n/g, ' ').slice(0, 120);
      console.log(
        `  [${w.id}] dist:${Number(w.nearestDistance).toFixed(3)}  nearest:${w.nearestLessonId ?? 'n/a'}`
      );
      console.log(`    ${preview}...`);
      console.log(`    Show: node scripts/lessons.mjs windows --show ${w.id}`);
      console.log(`    Archive: node scripts/lessons.mjs windows --archive ${w.id}\n`);
    }
  }
}

// ─── Promote subcommand ──────────────────────────────────────────────

async function cmdPromote(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP.promote);
    return;
  }

  // Parse --ids
  const idsIdx = args.indexOf('--ids');
  const promoteIds =
    idsIdx !== -1
      ? args[idsIdx + 1]
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      : [];

  // Parse --archive (repeatable): "--archive id:reason"
  const archiveItems = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--archive' && args[i + 1]) {
      const colonIdx = args[i + 1].indexOf(':');
      if (colonIdx === -1) {
        console.error(`--archive: expected "id:reason", got: ${args[i + 1]}`);
        process.exit(1);
      }
      archiveItems.push({
        id: args[i + 1].slice(0, colonIdx),
        reason: args[i + 1].slice(colonIdx + 1),
      });
    }
  }

  // Parse --patch
  const patchIdx = args.indexOf('--patch');
  const patches = patchIdx !== -1 ? JSON.parse(args[patchIdx + 1]) : {};

  if (promoteIds.length === 0 && archiveItems.length === 0) {
    console.error('promote: requires --ids and/or --archive');
    console.error('Run with --help for usage.');
    process.exit(1);
  }

  // Validate all IDs exist
  const db = openDb();
  const allIds = [...promoteIds, ...archiveItems.map(a => a.id)];
  const existing = getRecordsByIds(db, allIds);
  const foundIds = new Set(existing.map(r => r.id));
  const missing = allIds.filter(id => !foundIds.has(id));
  if (missing.length > 0) {
    closeDb(db);
    console.error(`promote: unknown IDs: ${missing.join(', ')}`);
    process.exit(1);
  }

  const promoted = promoteIds.length > 0 ? promoteToActive(db, promoteIds, patches) : [];
  const archived = archiveItems.length > 0 ? archiveRecords(db, archiveItems) : [];

  const sessionId = generateUlid();
  insertReviewSession(db, {
    id: sessionId,
    createdAt: new Date().toISOString(),
    promoted: promoted.map(r => r.id),
    archived: archived.map(r => ({
      id: r.id,
      reason: archiveItems.find(a => a.id === r.id)?.reason,
    })),
    ...(Object.keys(patches).length > 0 ? { patches } : {}),
  });
  closeDb(db);

  if (promoted.length > 0) {
    console.log(`Promoted ${promoted.length} lesson(s):`);
    for (const r of promoted) console.log(`  + ${r.slug} (${r.id})`);
    buildManifest();
  }
  if (archived.length > 0) {
    console.log(`Archived ${archived.length} lesson(s):`);
    for (const r of archived) console.log(`  - ${r.slug} (${r.id})`);
  }
  console.log(`Review session saved to DB: ${sessionId}`);
}

// ─── Doctor subcommand ───────────────────────────────────────────────

const SUMMARY_MAX_LENGTH = 80;
const WEAK_SOLUTION_MIN_LENGTH = 60;
const SOLUTION_RESTATE_THRESHOLD = 0.7;
const OVERSPECIFIED_PATTERN_LENGTH = 40;
const PRIORITY_HOMOGENEITY_THRESHOLD = 0.8;
const CONTEXT_BLEED_RE =
  /\bthis (repo|project|codebase)\b|\blast (session|week|tuesday|monday|wednesday|thursday|friday)\b|\bthe PR\b|\b I (ran|tried|found|noticed|saw|did|added|removed|wrote|used)\b/i;
const VERSION_REF_RE = /[@v]\d+\.\d+|\bversion\s+\d|\bv\d+\b/i;
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

function auditLesson(lesson) {
  const issues = [];
  const { type } = lesson;
  const isInjectOnMatch = type === 'hint' || type === 'guard';
  const isSessionStart = type === 'directive' || type === 'protocol';

  // dead-trigger: hint/guard with no toolNames can never fire (matchLessons bails at step 1)
  if (isInjectOnMatch && (!lesson.toolNames || lesson.toolNames.length === 0))
    issues.push('missing toolNames — lesson can never fire');

  // directive-with-toolNames: toolNames silently ignored for session-start types
  if (isSessionStart && lesson.toolNames && lesson.toolNames.length > 0)
    issues.push(
      `directive/protocol has toolNames (${lesson.toolNames.join(', ')}) — toolNames are silently ignored for session-start types; convert to hint if trigger-scoped`
    );

  // summary-too-long: injection formatter truncates at 80 chars
  if (lesson.summary && lesson.summary.length > SUMMARY_MAX_LENGTH)
    issues.push(`summary too long (${lesson.summary.length} chars, max ${SUMMARY_MAX_LENGTH})`);

  // summary-truncated: ends with ellipsis
  if (lesson.summary && lesson.summary.endsWith('...'))
    issues.push('summary appears truncated (ends with ...)');

  // placeholder: unfilled template fields
  for (const field of ['summary', 'problem', 'solution']) {
    if (lesson[field] && TEMPLATE_PLACEHOLDER_RE.test(lesson[field]))
      issues.push(`${field} contains unfilled template placeholder`);
  }

  // no-patterns: hint/guard with no patterns fires on every call to that tool
  if (
    isInjectOnMatch &&
    (!lesson.commandPatterns || lesson.commandPatterns.length === 0) &&
    (!lesson.pathPatterns || lesson.pathPatterns.length === 0)
  )
    issues.push('no commandPatterns or pathPatterns — fires on every matching tool call');

  // weak-pair: solution too short, or solution mostly restates the problem
  if (lesson.solution && lesson.solution.length < WEAK_SOLUTION_MIN_LENGTH)
    issues.push(
      `solution too short (${lesson.solution.length} chars, min ${WEAK_SOLUTION_MIN_LENGTH}) — won't transfer knowledge`
    );
  if (
    lesson.problem &&
    lesson.solution &&
    jaccardSimilarity(lesson.problem, lesson.solution) >= SOLUTION_RESTATE_THRESHOLD
  )
    issues.push(
      `solution restates problem (Jaccard ${jaccardSimilarity(lesson.problem, lesson.solution).toFixed(2)}) — solution must add new information`
    );

  // overspecified-trigger: very long patterns likely match only the exact original invocation
  for (const pat of lesson.commandPatterns ?? []) {
    const raw = pat.replace(/[\\^$.*+?()[\]{}|]/g, '');
    if (raw.length > OVERSPECIFIED_PATTERN_LENGTH)
      issues.push(
        `commandPattern "${pat.slice(0, 50)}${pat.length > 50 ? '…' : ''}" may be overspecified (${raw.length} non-regex chars) — generalize to the hazardous argument, not the full invocation`
      );
  }

  // solution-staleness: references specific version strings
  if (lesson.solution && VERSION_REF_RE.test(lesson.solution))
    issues.push(
      'solution references a version string — verify it is still current, or remove the version pin'
    );

  // context-bleed: session-specific language that is uninterpretable globally
  for (const field of ['problem', 'solution']) {
    if (lesson[field] && CONTEXT_BLEED_RE.test(lesson[field]))
      issues.push(
        `${field} contains session-specific language ("this repo", first-person, date references) — rewrite to be universally applicable`
      );
  }

  // orphaned-scope: scope ID doesn't match any project directory
  // Directory names have a leading '-' (raw path replacement); scope strips it — normalize both.
  if (lesson.scope) {
    let projects = [];
    try {
      projects = readdirSync(PROJECTS_DIR).map(d => d.replace(/^-/, ''));
    } catch {
      /* ~/.claude/projects not present in this env */
    }
    if (projects.length > 0 && !projects.includes(lesson.scope))
      issues.push(
        `scope "${lesson.scope}" does not match any directory in ~/.claude/projects/ — lesson will never fire`
      );
  }

  return issues;
}

function auditStore(lessons) {
  const warnings = [];

  // priority-homogeneity: if >80% of lessons share the same priority, ordering is arbitrary
  // Only meaningful with enough lessons to form a real distribution.
  if (lessons.length >= 5) {
    const priorityCounts = {};
    for (const l of lessons) priorityCounts[l.priority] = (priorityCounts[l.priority] ?? 0) + 1;
    for (const [pri, count] of Object.entries(priorityCounts)) {
      if (count / lessons.length >= PRIORITY_HOMOGENEITY_THRESHOLD)
        warnings.push(
          `priority homogeneity: ${count}/${lessons.length} lessons are priority ${pri} — injection ordering within the cluster is arbitrary; differentiate priorities`
        );
    }
  }

  return warnings;
}

function cmdDoctor(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP.doctor);
    return;
  }

  const db = openDb();
  const lessons = getActiveRecords(db);
  closeDb(db);

  const results = lessons.map(l => ({ lesson: l, issues: auditLesson(l) }));
  const storeWarnings = auditStore(lessons);
  const failing = results.filter(r => r.issues.length > 0);
  const hasIssues = failing.length > 0 || storeWarnings.length > 0;

  if (args.includes('--json')) {
    const out = {
      lessons: failing.map(r => ({ slug: r.lesson.slug, issues: r.issues })),
      store: storeWarnings,
    };
    console.log(JSON.stringify(out, null, 2));
    if (hasIssues) process.exit(1);
    return;
  }

  if (!hasIssues) {
    console.log(`✓ All ${lessons.length} lessons passed quality checks.`);
    return;
  }

  if (storeWarnings.length > 0) {
    console.log('Store-level warnings:');
    for (const w of storeWarnings) console.log(`  ⚠ ${w}`);
    console.log();
  }

  if (failing.length > 0) {
    console.log(`${failing.length} of ${lessons.length} lessons have quality issues:\n`);
    for (const { lesson, issues } of failing) {
      console.log(`  ${lesson.slug} [${lesson.type ?? 'hint'}]`);
      console.log(`    ${lesson.summary}`);
      for (const issue of issues) console.log(`    ✗ ${issue}`);
      console.log();
    }
    console.log(`To fix: node scripts/lessons.mjs edit --id <slug> --patch '{"field":"value"}'`);
  }

  process.exit(1);
}

// ─── Edit subcommand ─────────────────────────────────────────────────

function cmdEdit(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP.edit);
    return;
  }

  const idIdx = args.indexOf('--id');
  const patchIdx = args.indexOf('--patch');

  if (idIdx === -1 || !args[idIdx + 1]) {
    console.error('edit: --id is required');
    process.exit(1);
  }
  if (patchIdx === -1 || !args[patchIdx + 1]) {
    console.error('edit: --patch is required');
    process.exit(1);
  }

  const id = args[idIdx + 1];
  let patch;
  try {
    patch = JSON.parse(args[patchIdx + 1]);
  } catch {
    console.error('edit: --patch must be valid JSON');
    process.exit(1);
  }

  const db = openDb();
  const records = getRecordsByIds(db, [id]);
  if (records.length === 0) {
    closeDb(db);
    console.error(`edit: unknown ID: ${id}`);
    process.exit(1);
  }

  const result = updateRecord(db, id, patch);
  const wasActive = records[0].status === 'active';
  closeDb(db);

  if (!result) {
    console.error('edit: no patchable fields found in --patch');
    process.exit(1);
  }

  console.log(`Updated ${result.slug} (${result.id})`);
  if (wasActive) {
    buildManifest();
  }
}

// ─── Restore subcommand ──────────────────────────────────────────────

function cmdRestore(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP.restore);
    return;
  }

  const idsIdx = args.indexOf('--ids');
  if (idsIdx === -1 || !args[idsIdx + 1]) {
    console.error('restore: --ids is required');
    process.exit(1);
  }

  const ids = args[idsIdx + 1]
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const db = openDb();
  const records = getRecordsByIds(db, ids);
  const foundIds = new Set(records.map(r => r.id));
  const missing = ids.filter(id => !foundIds.has(id));
  if (missing.length > 0) {
    closeDb(db);
    console.error(`restore: unknown IDs: ${missing.join(', ')}`);
    process.exit(1);
  }

  const notArchived = records.filter(r => r.status !== 'archived');
  if (notArchived.length > 0) {
    closeDb(db);
    console.error(
      `restore: these IDs are not archived: ${notArchived.map(r => r.slug).join(', ')}`
    );
    process.exit(1);
  }

  const restored = restoreToActive(db, ids);
  closeDb(db);

  console.log(`Restored ${restored.length} lesson(s):`);
  for (const r of restored) console.log(`  + ${r.slug} (${r.id})`);
  buildManifest();
}

// ─── Windows subcommand ──────────────────────────────────────────────

function cmdWindows(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP.windows);
    return;
  }

  const db = openDb();

  const showIdx = args.indexOf('--show');
  if (showIdx !== -1) {
    const id = args[showIdx + 1];
    if (!id) {
      console.error('windows --show: id required');
      closeDb(db);
      process.exit(1);
    }
    const row = db.prepare('SELECT * FROM pending_semantic_windows WHERE id=?').get(id);
    if (!row) {
      console.error(`windows: not found: ${id}`);
      closeDb(db);
      process.exit(1);
    }
    const r = Object.assign({}, /** @type {any} */ (row));
    console.log(`id: ${r.id}`);
    console.log(
      `dist: ${r.nearestDistance.toFixed(3)}  nearest: ${r.nearestLessonId ?? 'n/a'}  project: ${r.projectId ?? 'n/a'}`
    );
    console.log(`created: ${r.createdAt}  processed: ${r.processedAt ?? 'no'}`);
    console.log('\n── window text ─────────────────────────────────');
    console.log(r.windowText);
    closeDb(db);
    return;
  }

  const archiveIdx = args.indexOf('--archive');
  if (archiveIdx !== -1) {
    const raw = args[archiveIdx + 1];
    if (!raw) {
      console.error('windows --archive: id(s) required');
      closeDb(db);
      process.exit(1);
    }
    const ids = raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    archivePendingWindows(db, ids);
    closeDb(db);
    console.log(`Archived ${ids.length} window(s).`);
    return;
  }

  // Default: list
  const windows = getPendingWindows(db);
  closeDb(db);

  if (windows.length === 0) {
    console.log('No pending semantic windows.');
    return;
  }

  console.log(`Pending semantic windows (${windows.length}):\n`);
  for (const w of windows) {
    const preview = w.windowText.replace(/\n/g, ' ').slice(0, 100);
    console.log(`  ${w.id}  dist:${w.nearestDistance.toFixed(3)}  ${preview}...`);
  }
  console.log(`\nUse --show <id> for full text, --archive <id> to mark processed.`);
}

// ─── Purge subcommand ────────────────────────────────────────────────

function cmdPurge(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP.purge);
    return;
  }

  const confIdx = args.indexOf('--below-conf');
  if (confIdx === -1 || !args[confIdx + 1]) {
    console.error('purge: --below-conf <threshold> is required');
    console.error('Run with --help for usage.');
    process.exit(1);
  }

  const threshold = parseFloat(args[confIdx + 1]);
  if (isNaN(threshold) || threshold <= 0 || threshold > 1) {
    console.error(
      `purge: --below-conf must be a number between 0 and 1, got: ${args[confIdx + 1]}`
    );
    process.exit(1);
  }

  const dryRun = args.includes('--dry-run');

  const db = openDb();
  const candidates = getCandidatesBelowConfidence(db, threshold);

  if (candidates.length === 0) {
    closeDb(db);
    console.log(`No candidates found with confidence < ${threshold}`);
    return;
  }

  if (dryRun) {
    closeDb(db);
    console.log(`Would archive ${candidates.length} candidate(s) with confidence < ${threshold}:`);
    for (const r of candidates) console.log(`  - ${r.slug} (conf: ${r.confidence})`);
    return;
  }

  const items = candidates.map(r => ({
    id: r.id,
    reason: `bulk purge: confidence ${r.confidence} < ${threshold}`,
  }));
  const archived = archiveRecords(db, items);

  const sessionId = generateUlid();
  insertReviewSession(db, {
    id: sessionId,
    createdAt: new Date().toISOString(),
    promoted: [],
    archived: archived.map(r => ({ id: r.id, reason: `bulk purge: confidence < ${threshold}` })),
  });
  closeDb(db);

  console.log(`Archived ${archived.length} candidate(s) with confidence < ${threshold}`);
  console.log(`Review session saved: ${sessionId}`);
}

// ─── Scan subcommand ─────────────────────────────────────────────────

async function cmdScan(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP.scan);
    return;
  }

  // Route scan sub-subcommands
  const sub = args.find(a => !a.startsWith('-'));
  if (sub === 'aggregate') {
    runScanAggregate();
  } else if (sub === 'candidates') {
    // Renamed: 'scan candidates' → 'scan aggregate'
    process.stderr.write("Note: 'scan candidates' has been renamed to 'scan aggregate'\n");
    runScanAggregate();
  } else if (sub === 'promote') {
    console.error(
      "'scan promote' has been removed. Use: node scripts/lessons.mjs promote --ids <id>"
    );
    process.exit(1);
  } else {
    await runScan(args);
  }
}

async function runScan(args) {
  const flags = {
    full: args.includes('--full'),
    semanticFull: args.includes('--semantic-full'),
    tier1Only: args.includes('--tier1-only'),
    tier2Only: args.includes('--tier2-only'),
    semantic: args.includes('--semantic') || args.includes('--semantic-full'),
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    auto: args.includes('--auto'),
    path: null,
  };

  const pathIdx = args.indexOf('--path');
  if (pathIdx !== -1 && args[pathIdx + 1]) flags.path = resolve(args[pathIdx + 1]);

  const log = flags.auto ? () => {} : console.log.bind(console);
  const scanPath = flags.path ?? DEFAULT_SCAN_PATH;

  log(`Scanning: ${scanPath}`);
  log(
    `Mode: ${flags.tier1Only ? 'Tier 1 only' : flags.tier2Only ? 'Tier 2 only' : 'Both tiers'}${flags.semantic ? ' + semantic' : ''}`
  );
  log(`Type: ${flags.full ? 'Full rescan' : 'Incremental'}`);
  log();

  const files = findJsonlFiles(scanPath);
  log(`Found ${files.length} JSONL files`);

  if (files.length === 0) {
    log('No session files found. Nothing to scan.');
    return;
  }

  const state = flags.full ? { files: {}, lastFullScanAt: null } : loadScanState();

  // Reset semantic offsets to 0 for all files so the full history is re-scanned.
  if (flags.semanticFull && !flags.full) resetSemanticOffsets(state);

  const allCandidates = [];
  let filesScanned = 0,
    filesSkipped = 0,
    totalNewBytes = 0;
  let semanticFilesScanned = 0;

  // Open a vec-enabled db handle for semantic scanning (separate from the write handle below).
  let vecDb = null;
  if (flags.semantic) {
    vecDb = openDb(undefined, { allowExtension: true });
    loadVecExtension(vecDb);
    await seedLessonEmbeddings(vecDb, { verbose: flags.verbose });
    const embeddedCount = vecDb.prepare(`SELECT COUNT(*) as n FROM lesson_vec_map`).get()?.n ?? 0;
    log(`Semantic mode: ${embeddedCount} active lesson embedding(s) indexed`);
    if (embeddedCount === 0) {
      log('  Warning: no active lessons embedded yet. Semantic scan will produce no results.');
      log('  Promote at least one lesson to active first, then re-scan.');
    }
  }

  for (const filePath of files) {
    const offset = flags.full ? 0 : getResumeOffset(state, filePath);
    const semanticOffset = flags.full ? 0 : getSemanticOffset(state, filePath);
    const fileSize = statSync(filePath).size;

    const regularNeedsWork = flags.full || offset < fileSize;
    const semanticNeedsWork = flags.semantic && (flags.full || semanticOffset < fileSize);

    if (!regularNeedsWork && !semanticNeedsWork) {
      filesSkipped++;
      continue;
    }

    if (regularNeedsWork) {
      const newBytes = fileSize - offset;
      if (flags.verbose) log(`  Scanning: ${filePath} (${newBytes} new bytes)`);

      const projectId = projectIdFromFilePath(filePath);
      const { candidates, bytesRead } = await scanFile(filePath, offset, flags, projectId);
      allCandidates.push(...candidates);
      updateOffset(state, filePath, bytesRead);
      filesScanned++;
      totalNewBytes += newBytes;
    }

    if (semanticNeedsWork && vecDb) {
      const projectId = projectIdFromFilePath(filePath);
      try {
        const { windowsStored, bytesRead: semBytesRead } = await semanticScanFile(
          vecDb,
          filePath,
          semanticOffset,
          { verbose: flags.verbose, dryRun: flags.dryRun },
          projectId
        );
        updateSemanticOffset(state, filePath, semBytesRead);
        if (flags.verbose && windowsStored > 0) {
          log(`  [semantic] ${windowsStored} window(s) stored for review from ${filePath}`);
        }
        semanticFilesScanned++;
      } catch (err) {
        process.stderr.write(`  [semantic] scan failed for ${filePath}: ${err.message}\n`);
      }
    }
  }

  if (vecDb) closeDb(vecDb);

  log(
    `\nScanned ${filesScanned} files (${filesSkipped} skipped, ${formatBytes(totalNewBytes)} processed)`
  );

  const deduplicated = deduplicateCandidates(allCandidates);
  log(`Found ${allCandidates.length} raw candidates → ${deduplicated.length} after dedup`);

  if (deduplicated.length > 0) {
    log('\n─── Candidates ────────────────────────────────────────');
    for (const c of deduplicated) {
      log(
        `\n[${c.source}] ${c.tool ?? 'unknown'} | confidence: ${c.confidence.toFixed(2)} | priority: ${c.priority}`
      );
      log(`  Problem: ${truncate(c.problem, 120)}`);
      log(`  Solution: ${truncate(c.solution, 120)}`);
      if (c.tags.length > 0) log(`  Tags: ${c.tags.join(', ')}`);
      if (c.occurrenceCount > 1)
        log(`  Seen ${c.occurrenceCount}x across ${c.sourceSessionIds.length} sessions`);
    }
  }

  // Write all candidates to DB (no auto-promote — use /lessons:review to promote)
  if (!flags.dryRun && deduplicated.length > 0) {
    const records = deduplicated.map(mapCandidateToDbRecord);
    const db = openDb();
    const result = insertCandidateBatch(db, records);
    closeDb(db);
    log(
      `\nSaved ${result.inserted} new candidate(s) to DB (${result.skipped} skipped as duplicates)`
    );
    if (result.skipped > 0 && flags.verbose) {
      for (const reason of result.skippedReasons) log(`  Skipped: ${reason}`);
    }
  }

  if (flags.semantic) {
    log(`Semantic: ${semanticFilesScanned} file(s) processed — run 'lessons windows' to review`);
  }

  if (!flags.dryRun) {
    state.lastFullScanAt = flags.full ? new Date().toISOString() : state.lastFullScanAt;
    saveScanState(state);
    log('\nScan state saved.');
  } else {
    log('\nDry run — state not saved.');
  }
}

function mapCandidateToDbRecord(c) {
  const firstWord = ((c.trigger ?? '').trim().match(/^[a-zA-Z0-9_-]+/) ?? [])[0] ?? '';
  const commandPatterns = firstWord ? [`\\b${firstWord}\\b`] : [];
  const slug = generateSlug(autoSummary(c));
  return {
    id: generateUlid(),
    slug,
    status: 'candidate',
    type: 'hint',
    summary: autoSummary(c),
    problem: c.problem,
    solution: c.solution,
    toolNames: c.tool ? [c.tool] : [],
    commandPatterns,
    pathPatterns: [],
    priority: c.priority,
    confidence: c.confidence,
    tags: c.tags ?? [],
    scope: c.scope === 'project' ? (c.projectId ?? null) : null,
    source: c.source ?? 'heuristic',
    sourceSessionIds: (c.sourceSessionIds ?? []).slice(0, 5),
    occurrenceCount: c.occurrenceCount ?? 1,
    sessionCount: (c.sourceSessionIds ?? []).length || 1,
    projectCount: 1,
    contentHash: computeContentHashFromDb({
      problem: c.problem,
      solution: c.solution,
      commandPatterns,
    }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reviewedAt: null,
    archivedAt: null,
    archiveReason: null,
  };
}

function runScanAggregate() {
  const db = openDb();
  const rows = getCandidateRecords(db);
  closeDb(db);

  if (rows.length === 0) {
    console.log(
      JSON.stringify(
        { generatedAt: new Date().toISOString(), totalCandidates: 0, candidates: [] },
        null,
        2
      )
    );
    return;
  }

  const candidates = rows.map((r, i) => ({
    index: i + 1,
    id: r.id,
    slug: r.slug,
    tool: r.toolNames?.[0] ?? null,
    confidence: Math.min(1.0, parseFloat((r.confidence + 0.1 * (r.projectCount - 1)).toFixed(2))),
    priority: Math.min(10, r.priority + r.projectCount),
    occurrenceCount: r.occurrenceCount,
    sessionCount: r.sessionCount,
    projectCount: r.projectCount,
    problem: r.problem,
    solution: r.solution,
    tags: r.tags,
    sourceSessionIds: r.sourceSessionIds,
    createdAt: r.createdAt,
  }));

  process.stdout.write(
    JSON.stringify(
      { generatedAt: new Date().toISOString(), totalCandidates: candidates.length, candidates },
      null,
      2
    ) + '\n'
  );
}

// ─── Scan helpers ────────────────────────────────────────────────────

/**
 * Derive project ID from a session JSONL file path.
 * ~/.claude/projects/<project-dir>/<session>.jsonl → "<project-dir>"
 */
function projectIdFromFilePath(filePath) {
  const projectsDir = join(homedir(), '.claude', 'projects');
  const rel = relative(projectsDir, filePath);
  return rel.split(sep)[0] ?? null;
}

function findJsonlFiles(dir, maxDepth = 5, depth = 0) {
  if (depth > maxDepth) return [];
  const files = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findJsonlFiles(fullPath, maxDepth, depth + 1));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function scanFile(filePath, startOffset, flags, projectId = null) {
  const candidates = [];
  const cancelPrefixes = []; // problem prefixes from #lesson:cancel blocks
  const detector = new HeuristicDetector();
  let bytesRead = startOffset;

  const stream = createReadStream(filePath, { start: startOffset || undefined, encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, 'utf8') + 1;
    if (!line.trim()) continue;

    if (!flags.tier2Only) {
      const { lessons, cancels } = scanLineForLessons(line);
      for (const tag of lessons) {
        candidates.push(extractFromStructured({ ...tag, projectId }));
      }
      cancelPrefixes.push(...cancels);
    }
    if (!flags.tier1Only) detector.feedLine(line);
  }

  if (!flags.tier1Only) {
    for (const window of detector.flush()) candidates.push(extractFromHeuristic(window));
  }

  // Drop any lesson whose problem starts with a cancel prefix from this file.
  // Cancel tags always appear after the lesson tags they target (chronological order),
  // so filtering after the full pass correctly suppresses them.
  const filtered =
    cancelPrefixes.length === 0
      ? candidates
      : candidates.filter(c => {
          const problemLower = (c.problem ?? '').toLowerCase();
          return !cancelPrefixes.some(prefix => problemLower.startsWith(prefix));
        });

  return { candidates: filtered, bytesRead };
}

function deduplicateCandidates(candidates) {
  const byHash = new Map();
  for (const c of candidates) {
    const existing = byHash.get(c.contentHash);
    if (!existing) {
      byHash.set(c.contentHash, {
        ...c,
        occurrenceCount: 1,
        sourceSessionIds: [c.sessionId].filter(Boolean),
      });
    } else {
      existing.occurrenceCount++;
      if (c.sessionId && !existing.sourceSessionIds.includes(c.sessionId))
        existing.sourceSessionIds.push(c.sessionId);
      if (c.source === 'structured' && existing.source === 'heuristic') {
        const { occurrenceCount, sourceSessionIds } = existing;
        Object.assign(existing, c);
        existing.occurrenceCount = occurrenceCount;
        existing.sourceSessionIds = sourceSessionIds;
      }
      if (existing.sourceSessionIds.length >= 2) {
        existing.priority = Math.min(10, existing.priority + 2);
        existing.confidence = Math.min(1.0, existing.confidence + 0.1);
      }
    }
  }
  return [...byHash.values()];
}

function autoSummary(candidate) {
  const text = candidate.problem ?? '';
  const firstLine = text.split('\n').find(l => l.trim().length > 10) ?? text;
  const clean = firstLine.replace(/\s+/g, ' ').trim();
  if (clean.length <= 120) return clean;
  const boundary = clean.slice(0, 120).search(/[.—]/);
  if (boundary > 20) return clean.slice(0, boundary + 1).trim();
  const wordBoundary = clean.slice(0, 120).lastIndexOf(' ');
  return clean.slice(0, wordBoundary > 20 ? wordBoundary : 120).trim() + '...';
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function truncate(str, maxLen) {
  if (!str) return '';
  const oneLine = str.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  return oneLine.length > maxLen ? oneLine.slice(0, maxLen - 3) + '...' : oneLine;
}

// ─── Dispatch ────────────────────────────────────────────────────────

async function main() {
  const [, , subcommand, ...rest] = process.argv;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log(HELP.root);
    return;
  }

  switch (subcommand) {
    case 'add':
      await cmdAdd(rest);
      break;
    case 'onboard':
      await cmdOnboard(rest);
      break;
    case 'build':
      cmdBuild(rest);
      break;
    case 'list':
      cmdList(rest);
      break;
    case 'promote':
      await cmdPromote(rest);
      break;
    case 'edit':
      cmdEdit(rest);
      break;
    case 'restore':
      cmdRestore(rest);
      break;
    case 'purge':
      cmdPurge(rest);
      break;
    case 'windows':
      cmdWindows(rest);
      break;
    case 'review':
      cmdReview(rest);
      break;
    case 'doctor':
      cmdDoctor(rest);
      break;
    case 'scan':
      await cmdScan(rest);
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('Run with --help to see available subcommands.');
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
