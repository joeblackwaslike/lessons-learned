/**
 * Promptfoo custom provider: runs Claude Code CLI non-interactively in a
 * materialized scenario workspace. Returns structured output for grading.
 *
 * Promptfoo file:// providers must export a class; the runner calls new Provider(options).
 *
 * callApi contract:
 *   prompt  — task text (contents of scenario PROMPT.md)
 *   context — { vars: { scenarioId, intervention, lessonSnapshot?, dialogFile? } }
 *   options — { config: { model, timeout } }
 *
 * Returns: { output: string, metadata: EvalArmMetadata }
 *
 * Tier 3 judge integration:
 *   - Control arms write transcript to results/cache/control-{controlHash}.json
 *   - Treatment arms read control transcript and call judge.mjs → judgeResult in metadata
 *   - controlHash = sha256(prompt + model)
 *   - lessonContentHash = sha256(lesson.problem + lesson.solution) → included in cacheKey
 */

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVALS_ROOT = resolve(__dirname, '..');
const CACHE_DIR = join(EVALS_ROOT, 'results', 'cache');

const MATERIALIZE_SCRIPT = join(EVALS_ROOT, 'scripts', 'materialize-workspace.mjs');
const COLLECT_SCRIPT = join(EVALS_ROOT, 'scripts', 'collect-artifacts.mjs');
const JUDGE_SCRIPT = join(EVALS_ROOT, 'scripts', 'judge.mjs');

export default class ClaudeAgentProvider {
  constructor(options = {}) {
    this.model = options.model ?? 'claude-sonnet-4-6';
    this.timeout = options.timeout ?? 300_000;
  }

  id() {
    return 'claude-agent';
  }

  /**
   * @param {string} prompt
   * @param {{ vars: Record<string, unknown> }} context
   * @param {{ config?: { model?: string; timeout?: number } }} options
   * @returns {Promise<{ output: string; metadata?: Record<string, unknown> }>}
   */
  async callApi(prompt, context, options) {
    const { vars = {} } = context;
    if (typeof vars.scenarioId !== 'string' || !vars.scenarioId) {
      throw new Error('Provider requires vars.scenarioId (non-empty string)');
    }
    const scenarioId = vars.scenarioId;
    const intervention = vars.intervention ?? { type: 'none', ids: [] };
    const model = options?.config?.model ?? this.model;
    const timeout = options?.config?.timeout ?? this.timeout;
    const isControl = (intervention.type ?? 'none') === 'none';

    const scenarioDir = join(EVALS_ROOT, 'scenarios', scenarioId);
    if (!existsSync(scenarioDir)) {
      throw new Error(`Scenario directory not found: ${scenarioDir}`);
    }

    const lesson = parseLessonSnapshot(vars, isControl);
    const controlHash = computeControlHash(prompt, model);
    const controlTranscriptFile = join(CACHE_DIR, `control-${controlHash}.json`);
    const lessonContentHash = lesson ? computeLessonContentHash(lesson) : null;
    const cacheKey = computeCacheKey(scenarioDir, intervention, model, lessonContentHash);
    const cacheFile = join(CACHE_DIR, `${cacheKey}.json`);

    const cached = tryArmCache(cacheFile, isControl, controlTranscriptFile);
    if (cached) return cached;

    const armResult = await runArm({
      prompt,
      scenarioDir,
      intervention,
      model,
      timeout,
      isControl,
      lesson,
      controlTranscriptFile,
      scenarioId,
      cacheKey,
      controlHash,
      startMs: Date.now(),
    });

    if (armResult.metadata.exitCode === 0) {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(armResult, null, 2));
    }

    return armResult;
  }
}

// ── Arm execution ──────────────────────────────────────────────────────────────

async function runArm({
  prompt,
  scenarioDir,
  intervention,
  model,
  timeout,
  isControl,
  lesson,
  controlTranscriptFile,
  scenarioId,
  cacheKey,
  controlHash,
  startMs,
}) {
  const workspaceDir = mkdtempSync(join(tmpdir(), `eval-${scenarioId}-`));
  try {
    materializeWorkspace(scenarioDir, workspaceDir, intervention);

    const env = buildEnv(workspaceDir, intervention);
    const claudeResult = spawnSync(
      findClaudeBin(),
      ['--print', '--dangerously-skip-permissions', '-p', prompt],
      { cwd: workspaceDir, env, encoding: 'utf8', timeout, maxBuffer: 10 * 1024 * 1024 }
    );

    const output = claudeResult.stdout ?? '';
    const evalMetaDir = join(workspaceDir, '.eval');
    mkdirSync(evalMetaDir, { recursive: true });
    writeFileSync(join(evalMetaDir, 'agent-output.txt'), output);

    const hiddenCheck = runVerify(scenarioDir, workspaceDir);
    const artifacts = collectArtifacts(workspaceDir, scenarioDir);

    if (isControl && claudeResult.status === 0) {
      writeControlTranscript(controlTranscriptFile, output);
    }

    // Judge uses claude --print (OAuth) — no ANTHROPIC_API_KEY required
    const judgeResult =
      !isControl && lesson ? await runJudge({ lesson, controlTranscriptFile, output }) : null;

    return {
      output,
      metadata: {
        scenarioId,
        intervention,
        model,
        durationMs: Date.now() - startMs,
        exitCode: claudeResult.status,
        stderr: (claudeResult.stderr ?? '').slice(0, 2000),
        hiddenCheck,
        artifacts,
        cacheHit: false,
        cacheKey,
        controlHash,
        ...(judgeResult !== null && { judgeResult }),
      },
    };
  } finally {
    try {
      rmSync(workspaceDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

function materializeWorkspace(scenarioDir, workspaceDir, intervention) {
  const result = spawnSync(
    process.execPath,
    [
      '--no-warnings',
      MATERIALIZE_SCRIPT,
      '--scenario',
      scenarioDir,
      '--workspace',
      workspaceDir,
      '--intervention',
      JSON.stringify(intervention),
    ],
    { encoding: 'utf8', timeout: 30_000 }
  );
  if (result.status !== 0) {
    throw new Error(`materialize-workspace failed:\n${result.stderr}`);
  }
}

function runVerify(scenarioDir, workspaceDir) {
  const verifyScriptPath = join(scenarioDir, 'hidden-checks', 'verify.mjs');
  if (!existsSync(verifyScriptPath)) {
    return { pass: true, details: 'no verify script', skipped: true };
  }
  const result = spawnSync(process.execPath, ['--no-warnings', verifyScriptPath, workspaceDir], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return {
    pass: result.status === 0,
    details: (result.stdout + result.stderr).trim(),
    exitCode: result.status,
    skipped: false,
  };
}

function collectArtifacts(workspaceDir, scenarioDir) {
  const result = spawnSync(
    process.execPath,
    ['--no-warnings', COLLECT_SCRIPT, '--workspace', workspaceDir, '--scenario', scenarioDir],
    { encoding: 'utf8', timeout: 10_000 }
  );
  if (result.status === 0 && result.stdout) {
    try {
      return JSON.parse(result.stdout);
    } catch {
      /* fall through */
    }
  }
  return {};
}

function writeControlTranscript(controlTranscriptFile, output) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(controlTranscriptFile, JSON.stringify({ output }, null, 2));
  } catch {
    /* best-effort */
  }
}

function tryArmCache(cacheFile, isControl, controlTranscriptFile) {
  if (!existsSync(cacheFile)) return null;
  let cached;
  try {
    cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch {
    return null;
  }
  if (isControl && cached.output && !existsSync(controlTranscriptFile)) {
    writeControlTranscript(controlTranscriptFile, cached.output);
  }
  return { ...cached, metadata: { ...cached.metadata, cacheHit: true } };
}

function parseLessonSnapshot(vars, isControl) {
  if (isControl || !vars.lessonSnapshot) return null;
  try {
    return JSON.parse(vars.lessonSnapshot);
  } catch {
    return null;
  }
}

// ── Judge ──────────────────────────────────────────────────────────────────────

async function runJudge({ lesson, controlTranscriptFile, output: treatmentTranscript }) {
  const form = ['hint', 'guard'].includes(lesson.type) ? 'A' : 'B';

  const controlTranscript = form === 'A' ? readControlTranscript(controlTranscriptFile) : null;
  if (form === 'A' && controlTranscript === null) {
    return skipResult('Control transcript not found — control arm must run before treatment arm.');
  }

  try {
    const { judge } = await import(JUDGE_SCRIPT);
    return await judge({ lesson, controlTranscript, treatmentTranscript, form });
  } catch (err) {
    return { ...skipResult(`Judge error: ${err.message}`), error: true };
  }
}

function readControlTranscript(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')).output ?? null;
  } catch {
    return null;
  }
}

function skipResult(reasoning) {
  return {
    outcome: 'SKIP',
    reasoning,
    dimension_scores: { control: null, treatment: null },
    delta: null,
  };
}

// ── Environment & binary ───────────────────────────────────────────────────────

function findClaudeBin() {
  const candidates = [
    process.env.CLAUDE_BIN,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    join(process.env.HOME ?? '', '.claude', 'bin', 'claude'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  try {
    const which = spawnSync('which', ['claude'], { encoding: 'utf8' });
    if (which.status === 0) return which.stdout.trim();
  } catch {
    /* ignore */
  }

  throw new Error('claude binary not found. Set CLAUDE_BIN env var or ensure claude is on PATH.');
}

function buildEnv(workspaceDir, _intervention) {
  const allowed = [
    'USER',
    'LOGNAME',
    'SHELL',
    'PATH',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'NODE_PATH',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_BASE_URL',
    'XDG_RUNTIME_DIR',
  ];

  const env = Object.fromEntries(
    allowed.filter(k => process.env[k] != null).map(k => [k, process.env[k]])
  );

  // Fake HOME prevents global ~/.claude hooks from contaminating eval results
  const evalHomeDir = join(workspaceDir, '.eval', 'home');
  mkdirSync(evalHomeDir, { recursive: true });
  env.HOME = evalHomeDir;

  if (!env.ANTHROPIC_API_KEY) {
    const realClaudeSettings = join(process.env.HOME ?? '', '.claude', 'settings.json');
    try {
      const settings = JSON.parse(readFileSync(realClaudeSettings, 'utf8'));
      const token = settings?.env?.CLAUDE_CODE_OAUTH_TOKEN;
      if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
    } catch {
      /* no settings file */
    }
  }

  const manifestPath = join(workspaceDir, '.eval', 'lesson-manifest.json');
  if (existsSync(manifestPath)) env.LESSONS_MANIFEST_PATH = manifestPath;
  env.LESSONS_DISABLE_SCAN = '1';

  return env;
}

// ── Cache key computation ──────────────────────────────────────────────────────

/** sha256(prompt + ':' + model) — stable key for control transcript reuse across lessons */
function computeControlHash(prompt, model) {
  return createHash('sha256').update(prompt).update(':').update(model).digest('hex');
}

/** sha256(problem + ':' + solution) — changes when lesson content is edited */
function computeLessonContentHash(lesson) {
  return createHash('sha256')
    .update(lesson.problem ?? '')
    .update(':')
    .update(lesson.solution ?? '')
    .digest('hex');
}

/**
 * sha256(scenarioContentHash : model : interventionJson [: lessonContentHash])
 * Intervention ids are sorted so order doesn't affect the key.
 * lessonContentHash is included for treatment arms so edits invalidate the cache.
 */
function computeCacheKey(scenarioDir, intervention, model, lessonContentHash = null) {
  const sortedIntervention = {
    type: intervention.type ?? 'none',
    ids: [...(intervention.ids ?? [])].sort((a, b) => a.localeCompare(b)),
  };
  const hash = createHash('sha256')
    .update(hashDir(scenarioDir))
    .update(':')
    .update(model)
    .update(':')
    .update(JSON.stringify(sortedIntervention));
  if (lessonContentHash) hash.update(':').update(lessonContentHash);
  return hash.digest('hex');
}

function hashDir(dir) {
  const hash = createHash('sha256');
  for (const relPath of collectFiles(dir).sort()) {
    hash.update(relPath);
    hash.update(readFileSync(join(dir, relPath)));
  }
  return hash.digest('hex');
}

function collectFiles(dir, base = '') {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectFiles(join(dir, entry.name), rel));
    } else if (entry.isFile() && !rel.startsWith('node_modules/') && !rel.startsWith('.git/')) {
      results.push(rel);
    }
  }
  return results;
}
