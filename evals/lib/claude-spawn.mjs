/**
 * Isolated single-shot `claude -p` helper for eval scripts that need one LLM
 * call without inheriting hooks/plugins/settings and without meridian.
 *
 * Auth: OAuth via the default ~/.claude/ config dir. HOME/CLAUDE_CONFIG_DIR are
 * intentionally left untouched (not faked) so Keychain lookup keeps working —
 * `--setting-sources ""` alone provides the isolation (no hooks/plugins/MCP from
 * settings), per the canonical pattern in
 * agent-skills/skills/working-with-claude-code/references/claude-setting-sources-isolation.md.
 * ANTHROPIC_API_KEY/ANTHROPIC_BASE_URL are excluded from the child env so a
 * meridian proxy export in the caller's shell can't redirect or change auth.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TMP',
  'TEMP',
];

// Generous default: unlike precompact-handoff's conversation-summarization use
// case (~20-40s), some callers here (e.g. probe-scenario.mjs generating full
// code) can legitimately take well over a minute. This is a backstop against
// the documented post-response-cleanup hang, not a generation-time budget, so
// erring high doesn't cost normal-latency calls anything.
const DEFAULT_TIMEOUT_MS = 180_000;

let cachedClaudeBin = null;

export function findClaudeBin() {
  if (cachedClaudeBin) return cachedClaudeBin;
  const candidates = [
    process.env.CLAUDE_BIN,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    join(process.env.HOME ?? '', '.claude', 'bin', 'claude'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedClaudeBin = candidate;
      return candidate;
    }
  }

  const which = spawnSync('which', ['claude'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) {
    cachedClaudeBin = which.stdout.trim();
    return cachedClaudeBin;
  }

  throw new Error('claude binary not found. Set CLAUDE_BIN env var or ensure claude is on PATH.');
}

function buildIsolatedEnv() {
  return Object.fromEntries(
    ENV_ALLOWLIST.filter(k => process.env[k] != null).map(k => [k, process.env[k]])
  );
}

/**
 * Run a single isolated `claude -p` call and return its raw stdout text.
 *
 * @param {{ systemPrompt?: string, userContent: string, model: string, timeoutMs?: number }} params
 * @returns {Promise<string>}
 */
export async function callClaude({
  systemPrompt,
  userContent,
  model,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const claudeBin = findClaudeBin();
  // --tools "" disables all built-in tools (Bash, Read, Edit, ...) — these are
  // single-shot text-generation calls, not agentic sessions. Without this, a
  // model that reaches for a tool blocks on a permission prompt that can never
  // be answered headlessly, hanging until the kill timer below fires.
  const args = [
    '-p',
    '--no-session-persistence',
    '--setting-sources',
    '',
    '--tools',
    '',
    '--model',
    model,
  ];
  if (systemPrompt) args.push('--system-prompt', systemPrompt);

  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin, args, {
      env: buildIsolatedEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    child.stdout.on('data', d => {
      out += d.toString();
    });
    child.stderr.on('data', d => {
      err += d.toString();
    });
    child.stdin.write(userContent);
    child.stdin.end();

    // claude -p hangs after printing output due to post-response cleanup;
    // resolve on 'close' (fires before the hang) rather than waiting for exit.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish();
    }, timeoutMs);

    function finish() {
      clearTimeout(timer);
      const trimmed = out.trim();
      if (!trimmed) {
        reject(new Error(`claude -p produced no output. stderr: ${err.slice(0, 500)}`));
        return;
      }
      resolve(trimmed);
    }

    child.on('close', finish);
    child.on('error', e => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
