/**
 * Per-trial sandbox for agent arms that run with permissions skipped (ll-jfh).
 *
 * Each trial gets a temp root holding the workspace, a throwaway HOME and TMPDIR, and a
 * stub bin dir first on PATH whose `gh` and `git` network commands fail and are logged.
 * On macOS the agent also runs under `sandbox-exec` with writes under the real home
 * denied. A before/after snapshot of watched real-home paths catches anything that still
 * gets through. The agent authenticates with `CLAUDE_CODE_OAUTH_TOKEN`, read from the
 * real login, so nothing is written into the real `~/.claude`.
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
const FORBIDDEN_EXIT = 97;
const TOKEN_MIN_VALID_MS = 5 * 60_000;

/** The real home whose paths are watched and write-protected (`EVAL_WATCH_HOME` in tests). */
export function watchHome() {
  return process.env.EVAL_WATCH_HOME ?? userInfo().homedir;
}

/**
 * Create the trial root: `workspace/`, `home/`, `tmp/`, `bin/` (stubs), `forbidden.log`.
 * @returns {{ root: string, workspace: string, home: string, tmp: string, bin: string, log: string }}
 */
export function createTrialSandbox(label) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `eval-${label}-`)));
  const sb = {
    root,
    workspace: join(root, 'workspace'),
    home: join(root, 'home'),
    tmp: join(root, 'tmp'),
    bin: join(root, 'bin'),
    log: join(root, 'forbidden.log'),
  };
  for (const dir of [sb.workspace, sb.home, sb.tmp, sb.bin]) mkdirSync(dir);
  writeStubs(sb);
  return sb;
}

function writeStubs(sb) {
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const refuse = name =>
    `printf '%s\\n' "${name} $*" >> '${sb.log}'; echo "eval sandbox: ${name} $1 is disabled in eval trials" >&2; exit ${FORBIDDEN_EXIT}`;
  const stubs = {
    gh: ['#!/bin/sh', refuse('gh')],
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
      `  push|pull|fetch|clone|ls-remote) ${refuse('git')};;`,
      `  remote) case "$next" in add|set-url) ${refuse('git')};; esac;;`,
      'esac',
      realGit ? `exec '${realGit}' "$@"` : 'echo "eval sandbox: git not found" >&2; exit 127',
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
    PATH: `${sb.bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    CLAUDE_CODE_OAUTH_TOKEN: token,
  };
}

/**
 * The command and args to spawn `bin args` with. On macOS (unless `EVAL_SANDBOX_EXEC=0`)
 * this wraps it in `sandbox-exec`, denying writes under the real home except the trial
 * root and `extraWritable` paths.
 */
export function sandboxCommand(sb, bin, args, extraWritable = []) {
  const enabled = process.platform === 'darwin' && process.env.EVAL_SANDBOX_EXEC !== '0';
  if (!enabled || !existsSync('/usr/bin/sandbox-exec')) return { command: bin, args };
  const quote = p => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const writable = [sb.root, ...extraWritable].map(p => {
    mkdirSync(p, { recursive: true });
    return `(allow file-write* (subpath ${quote(realpathSync(p))}))`;
  });
  const profile = [
    '(version 1)',
    '(allow default)',
    `(deny file-write* (subpath ${quote(realpathSync(watchHome()))}))`,
    ...writable,
  ].join('\n');
  return { command: '/usr/bin/sandbox-exec', args: ['-p', profile, bin, ...args] };
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

/** Calls the stubs refused during the trial, one string per call. */
export function readForbiddenCalls(sb) {
  if (!existsSync(sb.log)) return [];
  return readFileSync(sb.log, 'utf8').split('\n').filter(Boolean);
}

/**
 * OAuth token for the agent: `CLAUDE_CODE_OAUTH_TOKEN` if set (e.g. from
 * `claude setup-token`), else the access token of the real login (macOS Keychain entry
 * `Claude Code-credentials`, or `~/.claude/.credentials.json`). The refresh token is never
 * handed to the trial, so a trial cannot rotate the real login. Throws when the token is
 * missing or expires within five minutes.
 */
export function readOAuthToken() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  let raw = '';
  if (process.platform === 'darwin') {
    const r = spawnSync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf8', timeout: 15_000 }
    );
    if (r.status === 0) raw = r.stdout;
  }
  const file = join(userInfo().homedir, '.claude', '.credentials.json');
  if (!raw && existsSync(file)) raw = readFileSync(file, 'utf8');
  const oauth = raw ? JSON.parse(raw).claudeAiOauth : null;
  if (!oauth?.accessToken) {
    throw new Error('no Claude login found for eval trials: run `claude` and /login first');
  }
  if (oauth.expiresAt && oauth.expiresAt < Date.now() + TOKEN_MIN_VALID_MS) {
    throw new Error(
      'Claude access token expires within 5 minutes: start any claude session to refresh it, ' +
        'or set CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`'
    );
  }
  return oauth.accessToken;
}

const CLI_ERROR =
  /^(API Error|Claude AI usage limit reached|You've hit your|You're out of|Not logged in|Invalid API key|OAuth token|Credit balance is too low|Execution error)/i;

/**
 * Why a trial is an error rather than a result, or null. A run that failed, hit a usage
 * limit, touched the real machine, or (for statistical trials) made no tool calls must
 * never count as "mistake avoided". CLI error banners are matched on the first and last
 * output lines only, so an answer that quotes one mid-text is not an error.
 */
export function trialErrorReason({
  exitCode,
  output,
  toolCalls,
  requireToolCalls,
  outsideChanges,
  forbiddenCalls,
}) {
  if (outsideChanges.length > 0) {
    return `trial changed files outside its sandbox: ${outsideChanges.join(', ')}`;
  }
  if (forbiddenCalls.length > 0) {
    return `trial made forbidden calls: ${forbiddenCalls.join('; ')}`;
  }
  if (exitCode === null) return 'claude timed out (no exit code)';
  if (exitCode !== 0) return `claude exited with code ${exitCode}`;
  const lines = (output ?? '').trim().split('\n');
  const cliError = [lines[0], lines.at(-1)].find(line => CLI_ERROR.test(line));
  if (cliError) return `claude reported an API or usage-limit error: ${cliError.slice(0, 200)}`;
  if (requireToolCalls && toolCalls === 0) return 'trial made zero tool calls';
  return null;
}
