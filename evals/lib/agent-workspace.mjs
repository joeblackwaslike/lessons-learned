/**
 * Workspace steps shared by the agent providers: materialize the scenario, build the
 * agent's env, restore hook logs from outside the workspace, run the hidden check, and
 * collect artifacts.
 */

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EVALS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MATERIALIZE_SCRIPT = join(EVALS_ROOT, 'scripts', 'materialize-workspace.mjs');
const COLLECT_SCRIPT = join(EVALS_ROOT, 'scripts', 'collect-artifacts.mjs');

/**
 * Refuse to proceed if `dir` (the trial's workspace or log directory) is not a real
 * directory — an agent can remove it and plant a symlink to somewhere outside the trial
 * root, and every later `ensureRealDir`/`restoreHookLogs` call that builds a path *under*
 * `dir` would otherwise follow that ancestor link in the unsandboxed parent process.
 * Throws rather than repairing, since repairing would silently discard the agent's real
 * output.
 */
export function assertRealDir(dir) {
  let stat;
  try {
    stat = lstatSync(dir);
  } catch {
    throw new Error(`${dir} does not exist (expected a real directory)`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${dir} is not a real directory — the agent may have replaced it with a symlink`);
  }
}

/**
 * Create `dir` as a real directory, removing any symlink (or other non-directory entry) an
 * agent planted there first — the agent-controlled workspace is restored into after the agent
 * exits, in the unsandboxed parent, so a planted `.eval` symlink must never be followed. An
 * existing real directory (and its contents, e.g. materialized `.eval` metadata) is preserved.
 */
export function ensureRealDir(dir) {
  let stat;
  try {
    stat = lstatSync(dir);
  } catch {
    stat = null;
  }
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) {
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
}

/**
 * Remove any existing entry at `path` without following a symlink and without trusting
 * `lstat`'s regular-file report — a hard link also reports as a regular file, but writing
 * through it would truncate the shared inode, and an agent may have planted a directory
 * there instead. Unlinking (recursively, if a directory) and then creating fresh is safe
 * for all three cases.
 */
function clearDestination(path) {
  rmSync(path, { recursive: true, force: true });
}

/** Write `content` to `path`, refusing to follow an existing symlink or hard link there. */
export function writeRegularFile(path, content) {
  clearDestination(path);
  writeFileSync(path, content);
}

export function materializeWorkspace(scenarioDir, workspaceDir, intervention) {
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

/**
 * The agent's env: an allowlist of the parent env, the lesson manifest path, scenario
 * overrides, then `sandboxKeys` last so no scenario can undo the sandbox.
 */
export function buildEnv(workspaceDir, scenarioEnv, sandboxKeys) {
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
  // HOME, TMPDIR, XDG dirs, PATH, and auth apply last so no scenario can undo them.
  for (const [k, v] of Object.entries(scenarioEnv)) env[k] = String(v);
  return { ...env, ...sandboxKeys };
}

/**
 * Hook logs are written to the trial's eval-log dir, outside the workspace, so clearing or
 * forging the workspace's .eval (`git clean -fdx`) does not change them. Copy those logs
 * over whatever the workspace's .eval holds before artifacts are collected. The eval-log dir
 * is agent-writable too, so this is not tamper-proof against a hostile agent.
 */
export function restoreHookLogs(logDir, evalMetaDir) {
  for (const name of ['hook-events.ndjson', 'tool-calls.jsonl']) {
    const src = join(logDir, name);
    const dest = join(evalMetaDir, name);
    clearDestination(dest);
    if (existsSync(src) && lstatSync(src).isFile()) copyFileSync(src, dest);
  }
}

export function runVerify(scenarioDir, workspaceDir) {
  const verifyScriptPath = join(scenarioDir, 'hidden-checks', 'verify.mjs');
  if (!existsSync(verifyScriptPath)) {
    return { pass: true, details: 'no verify script', skipped: true };
  }
  const result = spawnSync(process.execPath, ['--no-warnings', verifyScriptPath, workspaceDir], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error) {
    throw new Error(`verify (${verifyScriptPath}) failed to spawn: ${result.error.message}`);
  }
  return {
    pass: result.status === 0,
    details: (result.stdout + result.stderr).trim(),
    exitCode: result.status,
    skipped: false,
  };
}

/**
 * `runVerify`, with an infrastructure failure (the check could not run) returned as
 * `verifyError` so the caller marks the trial an error, never cached, instead of throwing.
 */
export function tryVerify(scenarioDir, workspaceDir) {
  try {
    return { hiddenCheck: runVerify(scenarioDir, workspaceDir), verifyError: null };
  } catch (err) {
    return {
      hiddenCheck: { pass: false, details: err.message, skipped: false },
      verifyError: err.message,
    };
  }
}

/**
 * Runs collect-artifacts.mjs. Throws rather than returning `{}` on any failure — a
 * silent empty result would make a missing trajectory look like an absence of
 * prohibited behavior instead of a broken collector. Callers must treat a thrown error
 * as an infrastructure failure: mark the trial as an error and never cache it.
 */
export function collectArtifacts(workspaceDir, scenarioDir) {
  const result = spawnSync(
    process.execPath,
    ['--no-warnings', COLLECT_SCRIPT, '--workspace', workspaceDir, '--scenario', scenarioDir],
    { encoding: 'utf8', timeout: 10_000 }
  );
  if (result.error) {
    throw new Error(
      `collect-artifacts (${COLLECT_SCRIPT}) failed to spawn: ${result.error.message}`
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `collect-artifacts (${COLLECT_SCRIPT}) exited ${result.status}: ${(result.stderr ?? '').slice(0, 2000)}`
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`collect-artifacts (${COLLECT_SCRIPT}) returned invalid JSON: ${err.message}`);
  }
}

/**
 * The workspace's `.eval/tool-calls.jsonl` as a `## TOOL CALL LOG` block, or null if the
 * log is absent or empty. Throws if the log exists but can't be read or parsed, so a
 * malformed log is never mistaken for an absent one.
 */
export function readToolCallLog(workspaceDir) {
  const logPath = join(workspaceDir, '.eval', 'tool-calls.jsonl');
  if (!existsSync(logPath)) return null;
  let raw;
  try {
    raw = readFileSync(logPath, 'utf8');
  } catch (err) {
    throw new Error(`tool-call log (${logPath}) could not be read: ${err.message}`);
  }
  let lines;
  try {
    lines = raw
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
  } catch (err) {
    throw new Error(`tool-call log (${logPath}) is malformed: ${err.message}`);
  }
  if (lines.length === 0) return null;
  return `## TOOL CALL LOG\n${lines.join('\n')}`;
}
