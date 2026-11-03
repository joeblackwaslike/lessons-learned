/**
 * Per-trial sandbox for agent arms that run with permissions skipped (ll-jfh).
 *
 * Each trial gets a temp root holding the workspace, a throwaway HOME and TMPDIR, a log
 * dir outside the workspace, and a stub bin dir whose `gh` and `git` network commands are
 * refused (or, for scenarios that opt in, simulated) and logged. The stub dir is first on
 * PATH in the spawn env, in `CLAUDE_ENV_FILE` (sourced before every Bash tool command),
 * and in the temp home's shell startup files, so shells that reset PATH (nix-darwin's
 * /etc/zshenv, path_helper in login shells) still find the stubs first. On macOS the
 * agent also runs under `sandbox-exec`: no writes under the real home, no reads of its
 * credential files, no connections to unix sockets under it, Docker's socket, localhost,
 * or ports 22 and 9418. A before/after snapshot of watched real-home paths catches
 * anything that still gets through. The agent authenticates with
 * `CLAUDE_CODE_OAUTH_TOKEN`, read from the real login, so nothing is written into the
 * real `~/.claude`.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

const WATCH_FILES = [
  '.claude/settings.json',
  '.claude/CLAUDE.md',
  'Library/Application Support/Claude/claude_desktop_config.json',
  '.codex/config.toml',
];
const WATCH_LISTINGS = ['github'];
const SECRET_SUBPATHS = ['.ssh', '.config/gh', '.aws', 'Library/Keychains'];
const SECRET_FILES = [
  '.git-credentials',
  '.claude/.credentials.json',
  '.codex/auth.json',
  '.netrc',
  '.npmrc',
];
const SHELL_STARTUP_FILES = [
  '.zshenv',
  '.zprofile',
  '.zshrc',
  '.zlogin',
  '.bashrc',
  '.bash_profile',
  '.profile',
];
const FORBIDDEN_EXIT = 97;
const FAKE_PR_URL = 'https://github.com/eval-sandbox/simulated/pull/1';

/** The real home whose paths are watched and protected (`EVAL_WATCH_HOME` in tests). */
export function watchHome() {
  return process.env.EVAL_WATCH_HOME ?? userInfo().homedir;
}

/**
 * Create the trial root: `workspace/`, `home/` (with shell startup files), `tmp/`,
 * `bin/` (stubs), `eval-log/` (hook logs), `claude-env.sh`, and `stub-calls.log`.
 * With `simulateRemote`, the stubs answer like a remote that accepted the call instead of
 * refusing it.
 * @returns {{ root: string, workspace: string, home: string, tmp: string, bin: string,
 *   logDir: string, envFile: string, log: string, path: string, simulateRemote: boolean }}
 */
export function createTrialSandbox(label, { simulateRemote = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `eval-${label}-`)));
  const bin = join(root, 'bin');
  const sb = {
    root,
    workspace: join(root, 'workspace'),
    home: join(root, 'home'),
    tmp: join(root, 'tmp'),
    bin,
    logDir: join(root, 'eval-log'),
    envFile: join(root, 'claude-env.sh'),
    log: join(root, 'stub-calls.log'),
    path: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    simulateRemote,
  };
  for (const dir of [sb.workspace, sb.home, sb.tmp, sb.bin, sb.logDir]) mkdirSync(dir);
  writeStubs(sb);
  const exportPath = `export PATH=${shellQuote(sb.path)}\n`;
  writeFileSync(sb.envFile, exportPath);
  for (const name of SHELL_STARTUP_FILES) writeFileSync(join(sb.home, name), exportPath);
  return sb;
}

function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function writeStubs(sb) {
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const record = name => `printf '%s\\n' "${name} $*" >> ${shellQuote(sb.log)}`;
  const refuse = name =>
    `${record(name)}; echo "eval sandbox: ${name} $1 is disabled in eval trials" >&2; exit ${FORBIDDEN_EXIT}`;
  const gh = sb.simulateRemote
    ? [record('gh'), `case "$1 $2" in "pr create") echo '${FAKE_PR_URL}';; esac`, 'exit 0']
    : [refuse('gh')];
  const gitNetwork = sb.simulateRemote
    ? `${record('git')}; case "$sub" in push) echo 'Everything up-to-date' >&2;; pull) echo 'Already up to date.';; esac; exit 0`
    : refuse('git');
  const stubs = {
    gh: ['#!/bin/sh', ...gh],
    git: [
      '#!/bin/sh',
      'sub=""; next=""; skip=""',
      'for a in "$@"; do',
      '  if [ -n "$skip" ]; then skip=""; continue; fi',
      '  if [ -z "$sub" ]; then',
      '    case "$a" in -C|-c|--git-dir|--work-tree|--namespace) skip=1; continue;; -*) continue;; esac',
      '    sub="$a"; continue',
      '  fi',
      '  next="$a"; break',
      'done',
      'case "$sub" in',
      `  push|pull|fetch|clone|ls-remote) ${gitNetwork};;`,
      `  remote) case "$next" in add|set-url) ${gitNetwork};; esac;;`,
      'esac',
      realGit
        ? `exec ${shellQuote(realGit)} "$@"`
        : 'echo "eval sandbox: git not found" >&2; exit 127',
    ],
  };
  for (const [name, lines] of Object.entries(stubs)) {
    const path = join(sb.bin, name);
    writeFileSync(path, lines.join('\n') + '\n');
    chmodSync(path, 0o755);
  }
}

/** Env keys the sandbox owns. Applied last so scenario env can never override them. */
export function sandboxEnv(sb, token) {
  return {
    HOME: sb.home,
    TMPDIR: sb.tmp,
    TMP: sb.tmp,
    TEMP: sb.tmp,
    XDG_CONFIG_HOME: join(sb.home, '.config'),
    XDG_DATA_HOME: join(sb.home, '.local', 'share'),
    XDG_CACHE_HOME: join(sb.home, '.cache'),
    XDG_STATE_HOME: join(sb.home, '.local', 'state'),
    PATH: sb.path,
    BASH_ENV: join(sb.home, '.bashrc'),
    ENV: join(sb.home, '.profile'),
    CLAUDE_ENV_FILE: sb.envFile,
    EVAL_LOG_DIR: sb.logDir,
    CLAUDE_CODE_OAUTH_TOKEN: token,
  };
}

/**
 * The command and args to spawn `bin args` with. On macOS (unless `EVAL_SANDBOX_EXEC=0`)
 * this wraps it in `sandbox-exec` with the profile from `sandboxProfile`.
 */
export function sandboxCommand(sb, bin, args, extraWritable = []) {
  const enabled = process.platform === 'darwin' && process.env.EVAL_SANDBOX_EXEC !== '0';
  if (!enabled || !existsSync('/usr/bin/sandbox-exec')) return { command: bin, args };
  return {
    command: '/usr/bin/sandbox-exec',
    args: ['-p', sandboxProfile(sb, extraWritable), bin, ...args],
  };
}

/**
 * sandbox-exec profile: allow by default, then deny writes under the real home (except
 * the trial root and `extraWritable`), reads of credential paths under it, and outbound
 * connections to unix sockets under it or in /var/run, to localhost, and to TCP ports
 * 22 (SSH) and 9418 (git://).
 */
export function sandboxProfile(sb, extraWritable = []) {
  const quote = p => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const home = realpathSync(watchHome());
  const writable = [sb.root, ...extraWritable].map(p => {
    mkdirSync(p, { recursive: true });
    return `(allow file-write* (subpath ${quote(realpathSync(p))}))`;
  });
  const secrets = [
    ...SECRET_SUBPATHS.map(rel => `(subpath ${quote(join(home, rel))})`),
    ...SECRET_FILES.map(rel => `(literal ${quote(join(home, rel))})`),
  ];
  return [
    '(version 1)',
    '(allow default)',
    `(deny file-write* (subpath ${quote(home)}))`,
    ...writable,
    `(deny file-read* ${secrets.join(' ')})`,
    '(deny network-outbound',
    `  (remote unix-socket (subpath ${quote(home)}))`,
    '  (remote unix-socket (regex #"^/private/var/run/.*[.]sock$"))',
    '  (remote ip "localhost:*")',
    '  (remote tcp "*:22")',
    '  (remote tcp "*:9418"))',
  ].join('\n');
}

/** Signature of every watched real-home path: file hashes and mtimes, listing names. */
export function snapshotWatchPaths(home = watchHome()) {
  const snap = {};
  for (const rel of WATCH_FILES) {
    const path = join(home, rel);
    if (!existsSync(path)) {
      snap[rel] = 'absent';
      continue;
    }
    const content = readFileSync(path);
    snap[rel] = `${lstatSync(path).mtimeMs}:${createHash('sha256').update(content).digest('hex')}`;
  }
  for (const rel of WATCH_LISTINGS) {
    const path = join(home, rel);
    snap[`${rel}/`] = existsSync(path) ? readdirSync(path).sort().join('\n') : 'absent';
  }
  return snap;
}

/** Watched paths whose signature differs between two snapshots, sorted. */
export function diffSnapshots(before, after) {
  return Object.keys({ ...before, ...after })
    .filter(k => before[k] !== after[k])
    .sort();
}

/** Calls the `gh`/`git` stubs intercepted during the trial, one string per call. */
export function readStubCalls(sb) {
  if (!existsSync(sb.log)) return [];
  return readFileSync(sb.log, 'utf8').split('\n').filter(Boolean);
}

/**
 * OAuth token for the agent: `CLAUDE_CODE_OAUTH_TOKEN` if set (e.g. from
 * `claude setup-token`), else the access token of the real login (macOS Keychain entry
 * `Claude Code-credentials`, or `~/.claude/.credentials.json`). The refresh token is never
 * handed to the trial, so a trial cannot rotate the real login. Throws when the token is
 * missing or expires within `minValidMs`.
 */
export function readOAuthToken({ minValidMs = 5 * 60_000 } = {}) {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  let raw = '';
  if (process.platform === 'darwin') {
    const r = spawnSync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      {
        encoding: 'utf8',
        timeout: 15_000,
      }
    );
    if (r.status === 0) raw = r.stdout;
  }
  const file = join(watchHome(), '.claude', '.credentials.json');
  if (!raw && existsSync(file)) raw = readFileSync(file, 'utf8');
  const oauth = raw ? JSON.parse(raw).claudeAiOauth : null;
  if (!oauth?.accessToken) {
    throw new Error('no Claude login found for eval trials: run `claude` and /login first');
  }
  if (oauth.expiresAt && oauth.expiresAt < Date.now() + minValidMs) {
    throw new Error(
      `Claude access token expires within ${Math.round(minValidMs / 60_000)} minutes: start ` +
        'any claude session to refresh it, or set CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`'
    );
  }
  return oauth.accessToken;
}

/** Replace every occurrence of `secret` in any string inside `value` (JSON round-trip). */
export function redact(value, secret) {
  if (!secret) return value;
  const json = JSON.stringify(value);
  return json === undefined ? value : JSON.parse(json.split(secret).join('[REDACTED]'));
}

const CLI_ERROR =
  /^(API Error|Claude AI usage limit reached|You've hit your|You're out of|Not logged in|Invalid API key|OAuth token|Credit balance is too low|Execution error)/i;

/**
 * Why a trial is an error rather than a result, or null. A run that failed, hit a usage
 * limit, touched the real machine, produced nothing, or (for statistical trials) made no
 * tool calls must never count as "mistake avoided". CLI error banners are matched on the
 * first and last output lines only, so an answer that quotes one mid-text is not an error.
 * `agent` names the CLI in the messages.
 */
export function trialErrorReason({
  exitCode,
  signal = null,
  timedOut = false,
  overflow = false,
  output,
  toolCalls,
  requireToolCalls,
  outsideChanges,
  forbiddenCalls,
  agent = 'claude',
}) {
  if (outsideChanges.length > 0) {
    return `trial changed files outside its sandbox: ${outsideChanges.join(', ')}`;
  }
  if (forbiddenCalls.length > 0) {
    return `trial made forbidden calls: ${forbiddenCalls.join('; ')}`;
  }
  if (overflow) return `${agent} output exceeded the output buffer; the run was killed`;
  if (timedOut) return `${agent} timed out; the run was killed`;
  if (exitCode === null) return `${agent} was killed by ${signal ?? 'a signal'}`;
  if (exitCode !== 0) return `${agent} exited with code ${exitCode}`;
  const text = (output ?? '').trim();
  const lines = text.split('\n');
  const cliError = [lines[0], lines.at(-1)].find(line => CLI_ERROR.test(line));
  if (cliError) return `${agent} reported an API or usage-limit error: ${cliError.slice(0, 200)}`;
  if (!text && toolCalls === 0) return 'trial produced no output and no tool calls';
  if (requireToolCalls && toolCalls === 0) return 'trial made zero tool calls';
  return null;
}
