/**
 * Promptfoo custom provider: runs Claude Code CLI non-interactively in a
 * materialized scenario workspace. Returns structured output for grading.
 *
 * Promptfoo file:// providers must export a class; the runner calls new Provider(options).
 *
 * callApi contract:
 *   prompt  — task text (contents of scenario PROMPT.md)
 *   context — { vars: { scenarioId, intervention, lessonSnapshot?, dialogFile?,
 *                       trialId?, noCache?, scenarioDir?, mcp? } }
 *   options — { config: { model, timeout } }
 *
 *   trialId     — statistical trial id; part of the cache key, and a trial with zero
 *                 tool calls becomes an error
 *   noCache     — skip the arm cache read and write (also EVAL_NO_CACHE=1)
 *   scenarioDir — absolute scenario dir, overriding evals/scenarios/<scenarioId>
 *   mcp         — "none" forces the empty strict MCP config on every arm
 *   intervention may be { type: "overlay", dir } (files copied into the workspace)
 *
 * Returns: { output: string, error?: string, metadata: EvalArmMetadata }. `error` is set
 * when the run failed, timed out, hit a usage limit, touched files outside its sandbox,
 * or made a forbidden network call (see evals/lib/trial-sandbox.mjs); such results are
 * never cached.
 *
 * Tier 3 judge integration:
 *   - Control arms write transcript to results/cache/control-{controlHash}.json
 *   - Treatment arms read control transcript and call judge.mjs → judgeResult in metadata
 *   - controlHash = sha256(prompt + model)
 *   - lessonContentHash = sha256(lesson.problem + lesson.solution) → included in cacheKey
 */

import { spawnSync } from 'node:child_process';
import { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLessonRequires } from '../lib/requires.mjs';
import {
  cacheDir,
  cliVersion,
  computeCacheKey,
  tryArmCache,
  writeControlTranscript,
} from '../lib/arm-cache.mjs';
import {
  createTrialSandbox,
  diffSnapshots,
  readForbiddenCalls,
  readOAuthToken,
  sandboxCommand,
  sandboxEnv,
  snapshotWatchPaths,
  trialErrorReason,
} from '../lib/trial-sandbox.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVALS_ROOT = resolve(__dirname, '..');

const MATERIALIZE_SCRIPT = join(EVALS_ROOT, 'scripts', 'materialize-workspace.mjs');
const COLLECT_SCRIPT = join(EVALS_ROOT, 'scripts', 'collect-artifacts.mjs');
const JUDGE_SCRIPT = join(EVALS_ROOT, 'scripts', 'judge.mjs');

export default class ClaudeAgentProvider {
  constructor(options = {}) {
    this.model = options.config?.model ?? options.model ?? 'claude-sonnet-4-6';
    this.timeout = options.config?.timeout ?? options.timeout ?? 300_000;
  }

  id() {
    return 'claude-agent';
  }

  /**
   * @param {string} prompt
   * @param {{ vars: Record<string, unknown> }} context
   * @param {{ config?: { model?: string; timeout?: number } }} options
   * @returns {Promise<{ output: string; error?: string; metadata?: Record<string, any> }>}
   */
  async callApi(prompt, context, options) {
    const { vars = {} } = context;
    if (typeof vars.scenarioId !== 'string' || !vars.scenarioId) {
      throw new Error('Provider requires vars.scenarioId (non-empty string)');
    }
    const scenarioId = vars.scenarioId;
    const intervention = /** @type {{ type?: string; ids?: string[]; dir?: string }} */ (
      vars.intervention ?? { type: 'none', ids: [] }
    );
    const model = process.env.EVAL_AGENT_MODEL ?? options?.config?.model ?? this.model;
    const timeout = options?.config?.timeout ?? this.timeout;
    const isControl = (intervention.type ?? 'none') === 'none';
    const trialId = typeof vars.trialId === 'string' && vars.trialId ? vars.trialId : null;
    const noCache = vars.noCache === true || process.env.EVAL_NO_CACHE === '1';

    const scenarioDir =
      typeof vars.scenarioDir === 'string' && vars.scenarioDir
        ? vars.scenarioDir
        : join(EVALS_ROOT, 'scenarios', scenarioId);
    if (!existsSync(scenarioDir)) {
      throw new Error(`Scenario directory not found: ${scenarioDir}`);
    }

    const lesson = parseLessonSnapshot(vars, isControl);
    const scenario = JSON.parse(readFileSync(join(scenarioDir, 'scenario.json'), 'utf8'));
    const { pluginDirs, signature: requiresSignature } = scenario.lessonId
      ? resolveLessonRequires(scenario.lessonId)
      : { pluginDirs: [], signature: '' };
    const claudeBin = findClaudeBin();
    const trial = { trialId, cliVersion: cliVersion(claudeBin) };
    const controlHash = computeControlHash(scenarioId, model, requiresSignature);
    const controlTranscriptFile = join(cacheDir(), `control-${controlHash}.json`);
    const lessonContentHash = lesson ? computeLessonContentHash(lesson) : null;
    const useSerena = !isControl && vars.mcp !== 'none';
    // A treatment arm without Serena is a different arm, so it must not share a cache entry.
    const keySignature =
      !isControl && !useSerena ? `${requiresSignature}:mcp=none` : requiresSignature;
    const cacheKey = computeCacheKey(
      scenarioDir,
      intervention,
      model,
      lessonContentHash,
      keySignature,
      trial
    );
    const cacheFile = join(cacheDir(), `${cacheKey}.json`);

    if (!noCache) {
      const cached = tryArmCache(cacheFile, isControl, controlTranscriptFile);
      if (cached) return cached;
    }

    const armResult = await runArm({
      prompt,
      scenarioDir,
      scenarioEnv: scenario.env ?? {},
      intervention,
      model,
      timeout,
      isControl,
      lesson,
      controlTranscriptFile,
      scenarioId,
      cacheKey,
      controlHash,
      pluginDirs,
      claudeBin,
      trial,
      useSerena,
      startMs: Date.now(),
    });

    if (!noCache && !armResult.error) {
      mkdirSync(cacheDir(), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(armResult, null, 2));
    }

    return armResult;
  }
}

// ── Arm execution ──────────────────────────────────────────────────────────────

async function runArm({
  prompt,
  scenarioDir,
  scenarioEnv,
  intervention,
  model,
  timeout,
  isControl,
  lesson,
  controlTranscriptFile,
  scenarioId,
  cacheKey,
  controlHash,
  pluginDirs,
  claudeBin,
  trial,
  useSerena,
  startMs,
}) {
  const token = readOAuthToken();
  const sandbox = createTrialSandbox(scenarioId);
  const workspaceDir = sandbox.workspace;
  try {
    materializeWorkspace(scenarioDir, workspaceDir, intervention);

    const env = buildEnv(workspaceDir, scenarioEnv, sandboxEnv(sandbox, token));
    // Pin the agent model explicitly. Without --model, `claude --print` uses the
    // OAuth session's default model (which silently changed to Opus over this
    // project's life and confounded earlier CONTROL_CORRECT results), while the
    // cache key and judge assumed Sonnet. Resolved `model` defaults to
    // claude-sonnet-4-6 (override via EVAL_AGENT_MODEL).
    const claudeArgs = [
      '--print',
      '--dangerously-skip-permissions',
      '--setting-sources=project',
      '--no-session-persistence',
      '--model',
      model,
    ];
    // Pass explicit MCP config for treatment arms so Serena loads in --print mode.
    // Project-level mcpServers in settings.json are not loaded by CC in --print mode.
    // --strict-mcp-config ensures only this explicit config is used, in case the
    // workspace's own settings.json also defines mcpServers. vars.mcp "none" turns
    // Serena off so a treatment arm differs from its control only in the intervention.
    const mcpConfigPath = join(workspaceDir, '.eval', 'mcp-config.json');
    const loadSerena = useSerena && existsSync(mcpConfigPath);
    if (loadSerena) {
      claudeArgs.push('--mcp-config', mcpConfigPath, '--strict-mcp-config');
    } else {
      // Control arm: an empty strict config keeps account-level connectors (Supabase,
      // GitHub, ...) out of the sandbox. Without it they load despite --setting-sources=project.
      claudeArgs.push('--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config');
    }
    for (const dir of pluginDirs) claudeArgs.push('--plugin-dir', dir);
    claudeArgs.push('-p', prompt);
    const spawn = sandboxCommand(
      sandbox,
      claudeBin,
      claudeArgs,
      loadSerena ? [join(EVALS_ROOT, '.uv-cache')] : []
    );
    const before = snapshotWatchPaths();
    const claudeResult = spawnSync(spawn.command, spawn.args, {
      cwd: workspaceDir,
      env,
      encoding: 'utf8',
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    const outsideChanges = diffSnapshots(before, snapshotWatchPaths());
    const forbiddenCalls = readForbiddenCalls(sandbox);

    const output = claudeResult.stdout ?? '';
    const evalMetaDir = join(workspaceDir, '.eval');
    mkdirSync(evalMetaDir, { recursive: true });
    writeFileSync(join(evalMetaDir, 'agent-output.txt'), output);

    const hiddenCheck = runVerify(scenarioDir, workspaceDir);
    const artifacts = collectArtifacts(workspaceDir, scenarioDir);
    const toolCalls = (artifacts.trajectory ?? []).filter(e => e.type === 'PreToolUse').length;
    const error = trialErrorReason({
      exitCode: claudeResult.status,
      output,
      toolCalls,
      requireToolCalls: trial.trialId !== null,
      outsideChanges,
      forbiddenCalls,
    });
    const toolCallLog = readToolCallLog(workspaceDir);
    const enrichedOutput = toolCallLog ? `${output}\n\n${toolCallLog}` : output;

    if (isControl && !error) {
      writeControlTranscript(controlTranscriptFile, enrichedOutput);
    }

    // Judge uses an isolated `claude -p` subprocess (evals/lib/claude-spawn.mjs) —
    // OAuth via the default ~/.claude/ config dir, no ANTHROPIC_API_KEY required.
    const judgeResult =
      !isControl && lesson && !error
        ? await runJudge({ lesson, controlTranscriptFile, output: enrichedOutput })
        : null;

    return {
      output,
      ...(error && { error }),
      metadata: {
        scenarioId,
        intervention,
        model,
        trialId: trial.trialId,
        cliVersion: trial.cliVersion,
        durationMs: Date.now() - startMs,
        exitCode: claudeResult.status,
        stderr: (claudeResult.stderr ?? '').slice(0, 2000),
        toolCalls,
        sandbox: { outsideChanges, forbiddenCalls },
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
      rmSync(sandbox.root, { recursive: true, force: true });
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

function readToolCallLog(workspaceDir) {
  const logPath = join(workspaceDir, '.eval', 'tool-calls.jsonl');
  if (!existsSync(logPath)) return null;
  try {
    const lines = readFileSync(logPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const rec = JSON.parse(line);
        const input = rec.tool_input ?? {};
        const summary =
          rec.tool_name === 'Bash'
            ? (input.command ?? '').slice(0, 200)
            : JSON.stringify(input).slice(0, 200);
        return `  [${rec.tool_name}] ${summary}`;
      });
    if (lines.length === 0) return null;
    return `## TOOL CALL LOG\n${lines.join('\n')}`;
  } catch {
    return null;
  }
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
  const controlTranscript = readControlTranscript(controlTranscriptFile);
  if (controlTranscript === null) {
    return skipResult('Control transcript not found — control arm must run before treatment arm.');
  }

  try {
    const { judge } = await import(JUDGE_SCRIPT);
    return await judge({ lesson, controlTranscript, treatmentTranscript, form: 'A' });
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

function buildEnv(workspaceDir, scenarioEnv, sandboxKeys) {
  // ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL are intentionally excluded so the eval
  // agent bypasses Meridian (which spawns a CC worker with full user settings and
  // opus[1m], causing 20-minute timeouts). Without these vars, CC uses direct OAuth
  // authentication against Anthropic, which respects --setting-sources=project and
  // gives a small-context fast response via the user's subscription.
  const allowed = ['USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'NODE_PATH'];

  const env = Object.fromEntries(
    allowed.filter(k => process.env[k] != null).map(k => [k, process.env[k]])
  );

  const manifestPath = join(workspaceDir, '.eval', 'lesson-manifest.json');
  if (existsSync(manifestPath)) env.LESSONS_MANIFEST_PATH = manifestPath;
  env.LESSONS_DISABLE_SCAN = '1';

  // Per-scenario overrides (VIRTUAL_ENV, custom flags, ...) apply next. The sandbox's
  // HOME, TMPDIR, XDG dirs, PATH, and auth token apply last so no scenario can undo them.
  for (const [k, v] of Object.entries(scenarioEnv)) env[k] = String(v);
  return { ...env, ...sandboxKeys };
}

// ── Cache key computation ──────────────────────────────────────────────────────

/** sha256(prompt + ':' + model) — stable key for control transcript reuse across lessons */
function computeControlHash(scenarioId, model, requiresSignature = '') {
  return createHash('sha256')
    .update(scenarioId)
    .update(':')
    .update(model)
    .update(':')
    .update(requiresSignature)
    .digest('hex');
}

/** sha256(problem + ':' + solution) — changes when lesson content is edited */
function computeLessonContentHash(lesson) {
  return createHash('sha256')
    .update(lesson.problem ?? '')
    .update(':')
    .update(lesson.solution ?? '')
    .digest('hex');
}
