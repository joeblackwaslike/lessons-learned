/**
 * Promptfoo custom provider: runs the Codex CLI (`codex exec --json`) non-interactively in
 * a materialized scenario workspace, inside the same per-trial sandbox as claude-agent.mjs
 * (evals/lib/trial-sandbox.mjs).
 *
 * callApi contract (as claude-agent.mjs):
 *   prompt  — task text
 *   context — { vars: { scenarioId, intervention, trialId?, noCache?, scenarioDir? } }
 *   options — { config: { model, timeout } }
 *
 *   model        — options.config.model, else EVAL_CODEX_MODEL; with neither, callApi throws
 *   intervention — { type: "none" } or { type: "overlay", dir }; Codex has no lesson hooks
 *
 * Codex runs with CODEX_HOME set to a temp dir holding only a 0600 copy of the real
 * `~/.codex/auth.json`, so no user config, history, sessions, rules, skills, or MCP servers
 * load. Account-level features (ChatGPT apps, remote plugins, computer and browser use,
 * memories) are disabled with `--disable`. If Codex refreshes its token during the trial,
 * the new auth.json is written back to the real one (atomic rename), unless the real one
 * changed meanwhile or the copy is not JSON with a refresh token; old and new tokens are
 * both redacted. The cache key includes which sandbox Codex ran under.
 *
 * On macOS the run is wrapped in the trial's sandbox-exec profile. macOS refuses to apply
 * a second seatbelt inside one that has any deny rule (`sandbox_apply: Operation not
 * permitted`), so under sandbox-exec Codex runs with its own sandbox bypassed; without
 * sandbox-exec (other platforms, EVAL_SANDBOX_EXEC=0) Codex uses `--sandbox
 * workspace-write`, which also makes `.git` read-only.
 *
 * Codex has no PreToolUse hooks: the provider turns the `--json` event stream into
 * `hook-events.ndjson` (what collect-artifacts and assert-trajectory read) and
 * `tool-calls.jsonl`, written to the trial's log dir outside the workspace.
 *
 * Returns { output, error?, metadata }: output is the last agent message. `error` is set
 * for a non-zero or null exit, an `error`/`turn.failed` event, a usage-limit banner, zero
 * tool calls (unless scenario.json has `allowNoToolCalls: true`), changes outside the
 * sandbox, or forbidden calls; such results are never cached.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  lstatSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheDir, cliVersion, computeCacheKey, tryArmCache } from '../lib/arm-cache.mjs';
import {
  createTrialSandbox,
  diffSnapshots,
  readStubCalls,
  redact,
  sandboxCommand,
  sandboxEnv,
  sandboxExecEnabled,
  snapshotWatchPaths,
  trialErrorReason,
  watchHome,
} from '../lib/trial-sandbox.mjs';
import { runProcessGroup } from '../lib/process-group.mjs';
import {
  assertRealDir,
  buildEnv,
  collectArtifacts,
  ensureRealDir,
  materializeWorkspace,
  restoreHookLogs,
  tryVerify,
  writeRegularFile,
} from '../lib/agent-workspace.mjs';

const EVALS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DISABLED_FEATURES = [
  'apps',
  'plugins',
  'remote_plugin',
  'computer_use',
  'browser_use',
  'browser_use_external',
  'memories',
  'daemon_auto_start',
  'in_app_local_automation',
  'image_generation',
  'skill_mcp_dependency_install',
];
const SECRET_KEY = /token|key|account|secret/i;

export default class CodexAgentProvider {
  constructor(options = {}) {
    this.model = options.config?.model ?? options.model;
    this.timeout = options.config?.timeout ?? options.timeout ?? 300_000;
  }

  id() {
    return 'codex-agent';
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
    const model = options?.config?.model ?? this.model ?? process.env.EVAL_CODEX_MODEL;
    if (!model) {
      throw new Error('codex-agent needs a model: set config.model or EVAL_CODEX_MODEL');
    }
    const intervention = /** @type {{ type?: string; ids?: string[]; dir?: string }} */ (
      vars.intervention ?? { type: 'none', ids: [] }
    );
    if (!['none', 'overlay'].includes(intervention.type ?? 'none')) {
      throw new Error(
        `codex-agent supports interventions none and overlay, not ${intervention.type}`
      );
    }
    const timeout = options?.config?.timeout ?? this.timeout;
    const trialId = typeof vars.trialId === 'string' && vars.trialId ? vars.trialId : null;
    const noCache = vars.noCache === true || process.env.EVAL_NO_CACHE === '1';

    const scenarioDir =
      typeof vars.scenarioDir === 'string' && vars.scenarioDir
        ? vars.scenarioDir
        : join(EVALS_ROOT, 'scenarios', scenarioId);
    if (!existsSync(scenarioDir)) {
      throw new Error(`Scenario directory not found: ${scenarioDir}`);
    }
    const scenario = JSON.parse(readFileSync(join(scenarioDir, 'scenario.json'), 'utf8'));
    const codexBin = findCodexBin();
    const trial = { trialId, cliVersion: cliVersion(codexBin) };
    const outerSandbox = sandboxExecEnabled();
    const signature = `agent=codex;sandbox=${outerSandbox ? 'bypassed' : 'workspace-write'}`;
    const cacheKey = computeCacheKey(
      scenarioDir,
      intervention,
      model,
      null,
      signature,
      trial,
      prompt
    );
    const cacheFile = join(cacheDir(), `${cacheKey}.json`);

    if (!noCache) {
      const cached = tryArmCache(cacheFile, false, null);
      if (cached) return cached;
    }

    const result = await runArm({
      prompt,
      scenarioDir,
      scenario,
      scenarioId,
      intervention,
      model,
      timeout,
      codexBin,
      outerSandbox,
      trial,
      cacheKey,
      startMs: Date.now(),
    });

    if (!noCache && !result.error) {
      mkdirSync(cacheDir(), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(result, null, 2));
    }
    return result;
  }
}

async function runArm({
  prompt,
  scenarioDir,
  scenario,
  scenarioId,
  intervention,
  model,
  timeout,
  codexBin,
  outerSandbox,
  trial,
  cacheKey,
  startMs,
}) {
  const simulateRemote = scenario.sandbox?.simulateRemote === true;
  const sandbox = createTrialSandbox(`codex-${scenarioId}`, { simulateRemote });
  const workspaceDir = sandbox.workspace;
  try {
    materializeWorkspace(scenarioDir, workspaceDir, intervention);
    const codexHome = join(sandbox.root, 'codex-home');
    mkdirSync(codexHome, { mode: 0o700 });
    const auth = copyCodexAuth(codexHome);
    let secrets = auth.secrets;
    const scrub = value => secrets.reduce((v, s) => redact(v, s), value);

    const sandboxKeys = { ...sandboxEnv(sandbox, ''), CODEX_HOME: codexHome };
    delete sandboxKeys.CLAUDE_CODE_OAUTH_TOKEN;
    delete sandboxKeys.CLAUDE_ENV_FILE;
    const env = buildEnv(workspaceDir, scenario.env ?? {}, sandboxKeys);

    const codexArgs = [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--ephemeral',
      // Nested seatbelts fail on macOS, so codex's own sandbox is off only when the
      // trial's sandbox-exec profile wraps the whole run.
      ...(outerSandbox
        ? ['--dangerously-bypass-approvals-and-sandbox']
        : ['--sandbox', 'workspace-write']),
      ...DISABLED_FEATURES.flatMap(feature => ['--disable', feature]),
      '-C',
      workspaceDir,
      '-m',
      model,
      '--',
      prompt,
    ];
    const spawn = sandboxCommand(sandbox, codexBin, codexArgs, [], {
      selfConfined: !outerSandbox,
    });
    const before = snapshotWatchPaths();
    let run;
    let authWriteBack;
    try {
      run = await runProcessGroup(spawn.command, spawn.args, {
        cwd: workspaceDir,
        env,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      });
    } finally {
      authWriteBack = writeBackCodexAuth(auth);
      secrets = [...new Set([...auth.secrets, ...authWriteBack.secrets])];
    }
    const outsideChanges = diffSnapshots(before, snapshotWatchPaths());
    const stubCalls = readStubCalls(sandbox);
    const forbiddenCalls = simulateRemote ? [] : stubCalls;
    const simulatedCalls = simulateRemote ? stubCalls : [];

    const { events, droppedLines } = parseEvents(run.stdout);
    const output = scrub(lastAgentMessage(events));
    // The agent could replace workspace/ itself with a symlink; every path built under it
    // below (including .eval) must not follow that ancestor link. Unlike .eval or the log
    // dir, workspace/ holds nothing the parent can safely regenerate.
    assertRealDir(workspaceDir);
    // The agent could write to the log dir, so it may have swapped it or its files for symlinks.
    ensureRealDir(sandbox.logDir);
    writeRegularFile(join(sandbox.logDir, 'hook-events.ndjson'), toHookEvents(events));
    writeRegularFile(join(sandbox.logDir, 'tool-calls.jsonl'), toToolCallLog(events));
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
    const telemetryError =
      droppedLines > 0
        ? `${droppedLines} codex event line(s) could not be parsed — trajectory evidence is incomplete`
        : null;
    const killed = run.timedOut || run.overflow;
    const infraError = verifyError ?? collectionError ?? (killed ? null : telemetryError);
    const toolCalls = (artifacts.trajectory ?? []).filter(e => e.type === 'PreToolUse').length;
    const reason =
      infraError ??
      trialErrorReason({
        agent: 'codex',
        exitCode: run.status,
        signal: run.signal,
        timedOut: run.timedOut,
        overflow: run.overflow,
        output,
        toolCalls,
        requireToolCalls: scenario.allowNoToolCalls !== true,
        outsideChanges,
        forbiddenCalls,
      });
    const eventError = infraError ? null : codexEventError(events);
    const error = reason && eventError ? `${reason} (${eventError})` : (reason ?? eventError);

    return scrub({
      output,
      ...(error && { error }),
      metadata: {
        scenarioId,
        intervention,
        model,
        provider: 'codex',
        trialId: trial.trialId,
        cliVersion: trial.cliVersion,
        durationMs: Date.now() - startMs,
        exitCode: run.status,
        // Redact before truncating so a secret cut at the boundary cannot survive.
        stderr: scrub(run.stderr).slice(0, 2000),
        toolCalls,
        usage: events.filter(e => e.type === 'turn.completed').at(-1)?.usage ?? null,
        sandbox: {
          outsideChanges,
          forbiddenCalls,
          simulatedCalls,
          codexSandbox: outerSandbox ? 'bypassed (sandbox-exec wraps codex)' : 'workspace-write',
          authWriteBack: authWriteBack.status,
        },
        hiddenCheck,
        artifacts,
        cacheHit: false,
        cacheKey,
      },
    });
  } finally {
    try {
      rmSync(sandbox.root, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Tool calls in a `codex exec --json` event stream, in order, one per item id:
 * `command_execution` items become Bash calls (the `/bin/zsh -lc '...'` wrapper removed),
 * `mcp_tool_call` items `mcp__<server>__<tool>` calls, completed `web_search` items
 * WebSearch calls, and completed `file_change` items one Edit call per changed path.
 * @param {any[]} events
 * @returns {{ tool_name: string, tool_input: Record<string, unknown> }[]}
 */
function toolCallsFrom(events) {
  const seen = new Set();
  const calls = [];
  for (const { type, item } of events) {
    if ((type !== 'item.started' && type !== 'item.completed') || !item || seen.has(item.id)) {
      continue;
    }
    if (item.type === 'command_execution') {
      seen.add(item.id);
      calls.push({ tool_name: 'Bash', tool_input: { command: unwrapShell(item.command) } });
    } else if (item.type === 'mcp_tool_call') {
      seen.add(item.id);
      calls.push({
        tool_name: `mcp__${item.server}__${item.tool}`,
        tool_input: item.arguments ?? {},
      });
    } else if (item.type === 'web_search' && type === 'item.completed') {
      seen.add(item.id);
      calls.push({ tool_name: 'WebSearch', tool_input: { query: item.query } });
    } else if (item.type === 'file_change' && type === 'item.completed') {
      seen.add(item.id);
      for (const change of item.changes ?? []) {
        calls.push({ tool_name: 'Edit', tool_input: { file_path: change.path } });
      }
    }
  }
  return calls;
}

/** `tool-calls.jsonl` lines (`{"tool_name":"Bash","tool_input":{"command":...}}`). */
export function toToolCallLog(events) {
  return toolCallsFrom(events)
    .map(call => JSON.stringify(call) + '\n')
    .join('');
}

/** `hook-events.ndjson` lines in the eval hook shim's PreToolUse format. */
export function toHookEvents(events) {
  return toolCallsFrom(events)
    .map(call => JSON.stringify({ type: 'PreToolUse', ...call }) + '\n')
    .join('');
}

export function unwrapShell(command) {
  const text = Array.isArray(command) ? command.join(' ') : String(command ?? '');
  const single = /^(?:\S*\/)?(?:bash|zsh|sh) -l?c '([\s\S]*)'$/.exec(text);
  if (single) return single[1].replaceAll(`'\\''`, `'`);
  const double = /^(?:\S*\/)?(?:bash|zsh|sh) -l?c "([\s\S]*)"$/.exec(text);
  return double ? double[1].replace(/\\([\\"$`])/g, '$1') : text;
}

/** @returns {{ events: any[], droppedLines: number }} */
function parseEvents(stdout) {
  const events = [];
  let droppedLines = 0;
  for (const line of stdout.split('\n').filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      if (typeof event?.type !== 'string') throw new TypeError('not an event');
      events.push(event);
    } catch {
      droppedLines += 1;
    }
  }
  return { events, droppedLines };
}

function lastAgentMessage(events) {
  const message = events
    .filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message')
    .at(-1);
  return message?.item.text ?? '';
}

function codexEventError(events) {
  const failed = events.find(e => e.type === 'error' || e.type === 'turn.failed');
  if (!failed) return null;
  const message = failed.message ?? failed.error?.message ?? 'no message';
  return `codex reported an error: ${String(message).slice(0, 200)}`;
}

/**
 * Copy the real `~/.codex/auth.json` into `codexHome` (mode 0600). Returns the paths, the
 * original bytes (for write-back), and its secret values (for redaction).
 */
function copyCodexAuth(codexHome) {
  const real = join(watchHome(), '.codex', 'auth.json');
  if (!existsSync(real)) {
    throw new Error(`no Codex login for eval trials: ${real} is missing; run \`codex login\``);
  }
  const original = readFileSync(real);
  const parsed = parseAuth(original);
  if (!parsed) throw new Error(`${real} is not valid JSON; run \`codex login\``);
  const copy = join(codexHome, 'auth.json');
  writeFileSync(copy, original, { mode: 0o600 });
  return { real, copy, original, secrets: secretValues(parsed) };
}

/** auth.json bytes parsed, or null when they are not JSON (so errors never quote them). */
function parseAuth(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
}

function secretValues(value, key = '') {
  if (typeof value === 'string') return SECRET_KEY.test(key) && value.length >= 8 ? [value] : [];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => secretValues(v, k));
}

/**
 * C16: Codex may rotate its refresh token inside the temp home, which would invalidate the
 * real login. Write a changed copy back atomically, but only over the bytes that were
 * copied, so a login refreshed by a live session meanwhile is never overwritten, and only
 * when the copy is JSON with a refresh token, so a write cut short by a kill is never kept.
 * Returns the outcome and the copy's secret values (rotated tokens, for redaction).
 */
export function writeBackCodexAuth({ real, copy, original }) {
  if (!existsSync(copy)) return { status: 'copy missing', secrets: [] };
  let current;
  try {
    if (!lstatSync(copy).isFile()) return { status: 'skipped: unreadable copy', secrets: [] };
    current = readFileSync(copy);
  } catch {
    return { status: 'skipped: unreadable copy', secrets: [] };
  }
  const parsed = parseAuth(current);
  const secrets = parsed ? secretValues(parsed) : [];
  if (current.equals(original)) return { status: 'unchanged', secrets };
  const refreshToken = parsed?.tokens?.refresh_token;
  if (typeof refreshToken !== 'string' || !refreshToken) {
    return { status: 'skipped: invalid copy', secrets };
  }
  if (!existsSync(real) || !readFileSync(real).equals(original)) {
    return { status: 'skipped: the real auth.json changed during the trial', secrets };
  }
  const tmp = `${real}.eval-${process.pid}.tmp`;
  writeFileSync(tmp, current, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, real);
  return { status: 'written back', secrets };
}

function findCodexBin() {
  const candidates = [
    process.env.CODEX_BIN,
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  const which = spawnSync('/usr/bin/which', ['codex'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  throw new Error('codex binary not found. Set CODEX_BIN or put codex on PATH.');
}
