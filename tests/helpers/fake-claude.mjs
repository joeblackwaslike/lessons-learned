import { beforeEach, afterEach } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ClaudeAgentProvider from '../../evals/providers/claude-agent.mjs';
import CodexAgentProvider from '../../evals/providers/codex-agent.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'evals');
const FAKE_CLAUDE = join(FIXTURES, 'fake-claude.sh');
const FAKE_CODEX = join(FIXTURES, 'fake-codex.sh');
/** Fake `~/.codex/auth.json` written into every test's fake real home. */
export const FAKE_CODEX_AUTH = {
  auth_mode: 'chatgpt',
  OPENAI_API_KEY: null,
  tokens: {
    id_token: 'idtok-SECRET-111',
    access_token: 'acctok-SECRET-222',
    refresh_token: 'reftok-SECRET-333',
    account_id: 'acct-SECRET-444',
  },
  last_refresh: '2026-11-01T00:00:00Z',
};
const ENV_KEYS = [
  'PATH',
  'CLAUDE_BIN',
  'CODEX_BIN',
  'EVAL_CODEX_MODEL',
  'EVAL_CACHE_DIR',
  'EVAL_WATCH_HOME',
  'EVAL_NO_CACHE',
  'EVAL_SANDBOX_EXEC',
  'EVAL_SANDBOX_WRITABLE',
  'EVAL_ALLOW_UNSANDBOXED',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'LESSONS_DATA_DIR',
];

/** Whether sandbox-exec exists and can apply a profile here (it cannot inside another seatbelt). */
export const sandboxExecUsable =
  process.platform === 'darwin' &&
  spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/true'])
    .status === 0;

/**
 * Write an executable `claude` into `dir` that exports `env` and runs the fake-claude
 * fixture. The provider passes the agent only an allowlisted env, so the fixture's
 * FAKE_CLAUDE_* settings travel inside the wrapper instead.
 */
export function makeFakeClaude(dir, env = {}, { name = 'claude', fixture = FAKE_CLAUDE } = {}) {
  const bin = join(dir, name);
  const exports = Object.entries(env).map(
    ([k, v]) => `export ${k}='${String(v).replace(/'/g, `'\\''`)}'`
  );
  writeFileSync(bin, ['#!/bin/sh', ...exports, `exec '${fixture}' "$@"`, ''].join('\n'));
  chmodSync(bin, 0o755);
  return bin;
}

/** Create `path` (and its parent dirs) with `content`. */
export function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/**
 * Register beforeEach/afterEach hooks that give every test a temp fake real home (the
 * watched paths), a scenario dir without a lessonId, a temp cache and data dir, and a
 * fake token, so no test can reach the real home, Keychain, or lessons.db. Returns the
 * per-test state plus `writeFile`, `useFakeClaude(env)`, `call(vars, config)`, and `runs()` (one
 * parsed fake-claude log line per run).
 */
export function useTrialHarness() {
  const h = {};
  let saved;
  let binCount = 0;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
    const base = mkdtempSync(join(tmpdir(), 'trials-'));
    const writable = join(base, 'agent-writable');
    Object.assign(h, {
      base,
      writable,
      log: join(writable, 'claude-runs.log'),
      fakeHome: join(base, 'fake-real-home'),
      scenarioDir: join(base, 'scenario'),
      bins: join(base, 'bins'),
    });
    writeFile(join(h.fakeHome, 'github', 'existing-repo', 'README.md'), 'x');
    writeFile(join(h.fakeHome, '.claude', 'settings.json'), '{}');
    writeFile(join(h.fakeHome, '.claude', 'CLAUDE.md'), '# user rules');
    writeFile(
      join(h.fakeHome, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      '{}'
    );
    writeFile(join(h.fakeHome, '.codex', 'config.toml'), '');
    writeFile(join(h.fakeHome, '.codex', 'auth.json'), JSON.stringify(FAKE_CODEX_AUTH));
    writeFile(join(h.fakeHome, '.codex', 'history.jsonl'), '{"text":"real history"}\n');
    writeFile(join(h.scenarioDir, 'scenario.json'), '{}');
    writeFile(join(h.scenarioDir, 'seed-workspace', 'app.txt'), 'seed');
    mkdirSync(h.bins);
    mkdirSync(writable);
    const emptyData = join(base, 'empty-data');
    mkdirSync(emptyData);

    process.env.EVAL_CACHE_DIR = join(base, 'cache');
    process.env.EVAL_WATCH_HOME = h.fakeHome;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token';
    process.env.LESSONS_DATA_DIR = emptyData;
    // The fakes log their runs here from inside the sandbox-exec profile.
    process.env.EVAL_SANDBOX_WRITABLE = writable;
    // Off macOS, or with EVAL_SANDBOX_EXEC=0, the fake claude runs unconfined.
    process.env.EVAL_ALLOW_UNSANDBOXED = '1';
    delete process.env.EVAL_NO_CACHE;
    delete process.env.EVAL_CODEX_MODEL;
    delete process.env.EVAL_SANDBOX_EXEC;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(h.base, { recursive: true, force: true });
  });

  h.writeFile = writeFile;

  h.useFakeClaude = (env = {}) => {
    const dir = join(h.bins, String(binCount++));
    mkdirSync(dir);
    process.env.CLAUDE_BIN = makeFakeClaude(dir, {
      FAKE_CLAUDE_LOG: h.log,
      FAKE_REAL_HOME: h.fakeHome,
      ...env,
    });
  };

  h.useFakeCodex = (env = {}) => {
    const dir = join(h.bins, String(binCount++));
    mkdirSync(dir);
    process.env.CODEX_BIN = makeFakeClaude(
      dir,
      { FAKE_CODEX_LOG: h.log, FAKE_REAL_HOME: h.fakeHome, ...env },
      { name: 'codex', fixture: FAKE_CODEX }
    );
  };

  h.callCodex = (vars = {}, config = {}) => {
    const provider = new CodexAgentProvider();
    return provider.callApi(
      'do the task',
      { vars: { scenarioId: 'TC-test', scenarioDir: h.scenarioDir, ...vars } },
      { config: { model: 'gpt-test', timeout: 20_000, ...config } }
    );
  };

  h.call = (vars = {}, config = {}, prompt = 'do the task') => {
    const provider = new ClaudeAgentProvider({ config: { model: 'sonnet' } });
    return provider.callApi(
      prompt,
      { vars: { scenarioId: 'TC-test', scenarioDir: h.scenarioDir, ...vars } },
      { config: { timeout: 20_000, ...config } }
    );
  };

  h.runs = () => {
    if (!existsSync(h.log)) return [];
    return readFileSync(h.log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line =>
        Object.fromEntries(
          line.split('\t').map(f => [f.split('=')[0], f.slice(f.indexOf('=') + 1)])
        )
      );
  };

  return h;
}
