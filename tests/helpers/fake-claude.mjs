import { beforeEach, afterEach } from 'node:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ClaudeAgentProvider from '../../evals/providers/claude-agent.mjs';

const FAKE_CLAUDE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'evals',
  'fake-claude.sh'
);
const ENV_KEYS = [
  'PATH',
  'CLAUDE_BIN',
  'EVAL_CACHE_DIR',
  'EVAL_WATCH_HOME',
  'EVAL_NO_CACHE',
  'EVAL_SANDBOX_EXEC',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'LESSONS_DATA_DIR',
];

/**
 * Write an executable `claude` into `dir` that exports `env` and runs the fake-claude
 * fixture. The provider passes the agent only an allowlisted env, so the fixture's
 * FAKE_CLAUDE_* settings travel inside the wrapper instead.
 */
export function makeFakeClaude(dir, env = {}) {
  const bin = join(dir, 'claude');
  const exports = Object.entries(env).map(([k, v]) => `export ${k}='${v}'`);
  writeFileSync(bin, ['#!/bin/sh', ...exports, `exec '${FAKE_CLAUDE}' "$@"`, ''].join('\n'));
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
    Object.assign(h, {
      base,
      log: join(base, 'claude-runs.log'),
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
    writeFile(join(h.scenarioDir, 'scenario.json'), '{}');
    writeFile(join(h.scenarioDir, 'seed-workspace', 'app.txt'), 'seed');
    mkdirSync(h.bins);
    const emptyData = join(base, 'empty-data');
    mkdirSync(emptyData);

    process.env.EVAL_CACHE_DIR = join(base, 'cache');
    process.env.EVAL_WATCH_HOME = h.fakeHome;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token';
    process.env.LESSONS_DATA_DIR = emptyData;
    delete process.env.EVAL_NO_CACHE;
    delete process.env.EVAL_SANDBOX_EXEC;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
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

  h.call = (vars = {}, config = {}) => {
    const provider = new ClaudeAgentProvider({ config: { model: 'sonnet' } });
    return provider.callApi(
      'do the task',
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
