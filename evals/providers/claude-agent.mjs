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
 *   - controlHash = sha256(scenario content + scenarioId + model + requires + prompt + cliVersion[+trialId])
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
  hashDir,
  isCacheableArmResult,
  tryArmCache,
  writeControlTranscript,
} from '../lib/arm-cache.mjs';
import {
  createTrialSandbox,
  diffSnapshots,
  readOAuthToken,
  readStubCalls,
  redact,
  sandboxCommand,
  sandboxEnv,
  snapshotWatchPaths,
  trialErrorReason,
} from '../lib/trial-sandbox.mjs';
import { runProcessGroup } from '../lib/process-group.mjs';
import {
  assertRealDir,
  buildEnv,
  collectArtifacts,
  ensureRealDir,
  materializeWorkspace,
  readToolCallLog,
  restoreHookLogs,
  tryVerify,
  writeRegularFile,
} from '../lib/agent-workspace.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVALS_ROOT = resolve(__dirname, '..');

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
    // Derived from scenario content + trialId, not the arm's own cacheKey, so a control
    // and its treatment (which differ in intervention) still land on the same transcript.
    const controlHash = computeControlHash(
      scenarioDir,
      scenarioId,
      model,
      requiresSignature,
      trial.cliVersion,
      trial.trialId,
      prompt
    );
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
      trial,
      prompt
    );
    const cacheFile = join(cacheDir(), `${cacheKey}.json`);

    if (!noCache) {
      const cached = tryArmCache(cacheFile, isControl, controlTranscriptFile);
      if (cached) return cached;
    }

    const armResult = await runArm({
      prompt,
      scenarioDir,
      scenario,
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

    if (!noCache && isCacheableArmResult(armResult)) {
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
  scenario,
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
  const token = readOAuthToken({ minValidMs: Math.max(5 * 60_000, timeout + 2 * 60_000) });
  const simulateRemote = scenario.sandbox?.simulateRemote === true;
  const sandbox = createTrialSandbox(scenarioId, { simulateRemote });
  const workspaceDir = sandbox.workspace;
  try {
    materializeWorkspace(scenarioDir, workspaceDir, intervention);

    const env = buildEnv(workspaceDir, scenario.env ?? {}, sandboxEnv(sandbox, token));
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
    const claudeResult = await runProcessGroup(spawn.command, spawn.args, {
      cwd: workspaceDir,
      env,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    const outsideChanges = diffSnapshots(before, snapshotWatchPaths());
    const stubCalls = readStubCalls(sandbox);
    const forbiddenCalls = simulateRemote ? [] : stubCalls;
    const simulatedCalls = simulateRemote ? stubCalls : [];

    const output = redact(claudeResult.stdout, token);
    // The agent could replace workspace/ itself with a symlink; every path built under
    // it below (including .eval) must not follow that ancestor link. Unlike .eval or the
    // log dir, workspace/ holds nothing the parent can safely regenerate, so fail hard
    // instead of repairing.
    assertRealDir(workspaceDir);
    // The agent could also replace the log dir with a symlink; repair it like .eval below,
    // so a forged log dir cannot smuggle outside content into the collected hook logs.
    ensureRealDir(sandbox.logDir);
    const evalMetaDir = join(workspaceDir, '.eval');
    ensureRealDir(evalMetaDir);
    writeRegularFile(join(evalMetaDir, 'agent-output.txt'), output);
    restoreHookLogs(sandbox.logDir, evalMetaDir);

    const { hiddenCheck, verifyError } = tryVerify(scenarioDir, workspaceDir);
    let artifacts = {};
    let collectionError = null;
    try {
      artifacts = collectArtifacts(workspaceDir, scenarioDir);
    } catch (err) {
      collectionError = err.message;
    }
    const toolCalls = (artifacts.trajectory ?? []).filter(e => e.type === 'PreToolUse').length;
    const telemetryError =
      artifacts.parseErrors > 0
        ? `${artifacts.parseErrors} hook event(s) could not be parsed — trajectory evidence is incomplete`
        : null;
    const error =
      verifyError ??
      collectionError ??
      telemetryError ??
      trialErrorReason({
        exitCode: claudeResult.status,
        signal: claudeResult.signal,
        timedOut: claudeResult.timedOut,
        overflow: claudeResult.overflow,
        output,
        toolCalls,
        requireToolCalls: trial.trialId !== null && scenario.allowNoToolCalls !== true,
        outsideChanges,
        forbiddenCalls,
      });
    const toolCallLog = readToolCallLog(workspaceDir);
    const enrichedOutput = redact(toolCallLog ? `${output}\n\n${toolCallLog}` : output, token);

    // Not gated on noCache: a control run with noCache must still leave a transcript for
    // its treatment to judge against, independent of whether the arm result itself is cached.
    if (isControl && !error) {
      writeControlTranscript(controlTranscriptFile, enrichedOutput);
    }

    // Judge uses an isolated `claude -p` subprocess (evals/lib/claude-spawn.mjs) —
    // OAuth via the default ~/.claude/ config dir, no ANTHROPIC_API_KEY required.
    const judgeResult =
      !isControl && lesson && !error
        ? await runJudge({ lesson, controlTranscriptFile, output: enrichedOutput })
        : null;

    return redact(
      {
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
          // Redact before truncating so a token cut at the boundary cannot survive.
          stderr: redact(claudeResult.stderr, token).slice(0, 2000),
          toolCalls,
          sandbox: { outsideChanges, forbiddenCalls, simulatedCalls },
          hiddenCheck,
          artifacts,
          cacheHit: false,
          cacheKey,
          controlHash,
          // Enriched output (with the tool-call log) so a cache hit can rebuild the control
          // transcript if the side-channel file was deleted after this run was cached.
          transcript: enrichedOutput,
          ...(judgeResult !== null && { judgeResult }),
        },
      },
      token
    );
  } finally {
    try {
      rmSync(sandbox.root, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
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

// ── Cache key computation ──────────────────────────────────────────────────────

/**
 * sha256(scenario content : scenarioId : model : requires : cliVersion[:trial=trialId]).
 * Hashing the scenario's own content (not just its id) and the trial id keeps independent
 * statistical trials and edited scenario revisions from sharing one control transcript,
 * while leaving out the intervention so a control and its treatment — which differ only in
 * intervention — land on the same transcript.
 */
function computeControlHash(
  scenarioDir,
  scenarioId,
  model,
  requiresSignature,
  cliVersion,
  trialId,
  prompt
) {
  const hash = createHash('sha256')
    .update(hashDir(scenarioDir))
    .update(':')
    .update(scenarioId)
    .update(':')
    .update(model)
    .update(':')
    .update(requiresSignature)
    .update(':prompt=')
    .update(prompt ?? '')
    .update(':cli=')
    .update(cliVersion);
  if (trialId) hash.update(':trial=').update(String(trialId));
  return hash.digest('hex');
}

/** sha256(problem + ':' + solution) — changes when lesson content is edited */
function computeLessonContentHash(lesson) {
  return createHash('sha256')
    .update(lesson.problem ?? '')
    .update(':')
    .update(lesson.solution ?? '')
    .digest('hex');
}
