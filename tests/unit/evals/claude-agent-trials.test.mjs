import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ClaudeAgentProvider from '../../../evals/providers/claude-agent.mjs';
import assertTrajectory from '../../../evals/scripts/assert-trajectory.mjs';
import { makeFakeClaude } from '../../helpers/fake-claude.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MATERIALIZE = join(root, 'evals', 'scripts', 'materialize-workspace.mjs');
const ENV_KEYS = [
  'CLAUDE_BIN',
  'EVAL_CACHE_DIR',
  'EVAL_WATCH_HOME',
  'EVAL_NO_CACHE',
  'EVAL_SANDBOX_EXEC',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'LESSONS_DATA_DIR',
];

let t;
let savedEnv;

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  const base = mkdtempSync(join(tmpdir(), 'trials-'));
  t = {
    base,
    log: join(base, 'claude-runs.log'),
    fakeHome: join(base, 'fake-real-home'),
    scenarioDir: join(base, 'scenario'),
    bins: join(base, 'bins'),
  };
  writeFile(join(t.fakeHome, 'github', 'existing-repo', 'README.md'), 'x');
  writeFile(join(t.fakeHome, '.claude', 'settings.json'), '{}');
  writeFile(join(t.fakeHome, '.claude', 'CLAUDE.md'), '# user rules');
  writeFile(
    join(t.fakeHome, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    '{}'
  );
  writeFile(join(t.fakeHome, '.codex', 'config.toml'), '');
  writeFile(join(t.scenarioDir, 'scenario.json'), '{}');
  writeFile(join(t.scenarioDir, 'seed-workspace', 'app.txt'), 'seed');
  mkdirSync(t.bins);
  const emptyData = join(base, 'empty-data');
  mkdirSync(emptyData);

  process.env.EVAL_CACHE_DIR = join(base, 'cache');
  process.env.EVAL_WATCH_HOME = t.fakeHome;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token';
  process.env.LESSONS_DATA_DIR = emptyData;
  delete process.env.EVAL_NO_CACHE;
  delete process.env.EVAL_SANDBOX_EXEC;
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

let binCount = 0;
function useFakeClaude(env = {}) {
  const dir = join(t.bins, String(binCount++));
  mkdirSync(dir);
  process.env.CLAUDE_BIN = makeFakeClaude(dir, {
    FAKE_CLAUDE_LOG: t.log,
    FAKE_REAL_HOME: t.fakeHome,
    ...env,
  });
}

function call(vars = {}, options = {}) {
  const provider = new ClaudeAgentProvider({ config: { model: 'sonnet' } });
  return provider.callApi(
    'do the task',
    { vars: { scenarioId: 'TC-test', scenarioDir: t.scenarioDir, ...vars } },
    { config: { timeout: 20_000, ...options } }
  );
}

function runs() {
  if (!existsSync(t.log)) return [];
  return readFileSync(t.log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line =>
      Object.fromEntries(line.split('\t').map(f => [f.split('=')[0], f.slice(f.indexOf('=') + 1)]))
    );
}

describe('independent trials', () => {
  it('30 calls with distinct trialIds and noCache run claude 30 times', async () => {
    useFakeClaude();
    const results = [];
    for (let i = 0; i < 30; i++) results.push(await call({ trialId: `trial-${i}`, noCache: true }));
    assert.equal(runs().length, 30);
    assert.ok(results.every(r => r.metadata.cacheHit === false));
    assert.equal(new Set(results.map(r => r.metadata.cacheKey)).size, 30);
    assert.ok(
      results.every(r => !r.error),
      results.find(r => r.error)?.error
    );
  });

  it('same trialId without noCache: the second call is a cache hit', async () => {
    useFakeClaude();
    const first = await call({ trialId: 'trial-a' });
    assert.equal(first.metadata.cacheHit, false, first.error);
    const second = await call({ trialId: 'trial-a' });
    assert.equal(second.metadata.cacheHit, true);
    assert.equal(runs().length, 1);
  });

  it('EVAL_NO_CACHE=1 skips the cache', async () => {
    useFakeClaude();
    process.env.EVAL_NO_CACHE = '1';
    await call({ trialId: 'trial-b' });
    await call({ trialId: 'trial-b' });
    assert.equal(runs().length, 2);
  });

  it('metadata carries trialId and cliVersion', async () => {
    useFakeClaude({ FAKE_CLAUDE_VERSION: '7.7.7' });
    const r = await call({ trialId: 'trial-c', noCache: true });
    assert.equal(r.metadata.trialId, 'trial-c');
    assert.equal(r.metadata.cliVersion, '7.7.7 (Fake)');
  });

  it('scenario without lessonId runs without opening lessons.db', async () => {
    useFakeClaude();
    const r = await call({ trialId: 'trial-d', noCache: true });
    assert.equal(r.metadata.exitCode, 0);
  });

  it('passes --no-session-persistence', async () => {
    useFakeClaude();
    await call({ trialId: 'trial-e', noCache: true });
    assert.match(runs()[0].args, /--no-session-persistence/);
  });

  it('vars.mcp "none" forces the empty strict MCP config on a treatment arm', async () => {
    useFakeClaude();
    const overlay = join(t.base, 'overlay');
    writeFile(join(overlay, 'CLAUDE.md'), 'rule');
    await call({
      trialId: 'trial-f',
      noCache: true,
      mcp: 'none',
      intervention: { type: 'overlay', dir: overlay },
    });
    assert.match(runs()[0].args, /--mcp-config \{"mcpServers":\{\}\} --strict-mcp-config/);
  });
});

describe('mcp cache separation', () => {
  it('a treatment arm with vars.mcp "none" does not reuse the Serena arm cache entry', async () => {
    useFakeClaude();
    const overlay = join(t.base, 'overlay');
    writeFile(join(overlay, 'CLAUDE.md'), 'rule');
    const intervention = { type: 'overlay', dir: overlay };
    await call({ trialId: 'trial-o', intervention });
    const r = await call({ trialId: 'trial-o', intervention, mcp: 'none' });
    assert.equal(r.metadata.cacheHit, false);
  });
});

describe('trial sandbox', () => {
  it('runs claude with a per-trial HOME and TMPDIR, the stub bin first on PATH, and a token', async () => {
    useFakeClaude();
    await call({ trialId: 'trial-g', noCache: true });
    const [run] = runs();
    assert.notEqual(run.home, process.env.HOME);
    assert.ok(!run.home.startsWith(t.fakeHome), run.home);
    assert.equal(dirname(run.tmpdir), dirname(run.home));
    assert.equal(dirname(run.path0), dirname(run.home));
    assert.ok(existsSync(join(dirname(run.home))) === false, 'trial root is removed afterwards');
    assert.equal(run.token, 'set');
  });

  it('gh and git network calls fail, are logged, and fail the trial; local git works', async () => {
    useFakeClaude({
      FAKE_CLAUDE_RUN:
        'git --version; gh pr create --fill; git -C . push origin main; git remote add o https://x',
    });
    const r = await call({ trialId: 'trial-h', noCache: true });
    assert.match(r.output, /git version/);
    assert.deepEqual(r.metadata.sandbox.forbiddenCalls, [
      'gh pr create --fill',
      'git -C . push origin main',
      'git remote add o https://x',
    ]);
    assert.match(r.error, /forbidden/);
  });

  it('a write outside the workspace is detected and fails the trial', async () => {
    process.env.EVAL_SANDBOX_EXEC = '0';
    useFakeClaude({
      FAKE_CLAUDE_RUN:
        'mkdir "$FAKE_REAL_HOME/github/cloned"; echo hacked >> "$FAKE_REAL_HOME/Library/Application Support/Claude/claude_desktop_config.json"',
    });
    const r = await call({ trialId: 'trial-i' });
    assert.deepEqual(r.metadata.sandbox.outsideChanges, [
      'Library/Application Support/Claude/claude_desktop_config.json',
      'github/',
    ]);
    assert.match(r.error, /outside/);
    assert.equal(r.metadata.cacheHit, false);
    assert.equal(
      existsSync(join(process.env.EVAL_CACHE_DIR, `${r.metadata.cacheKey}.json`)),
      false
    );
  });

  it(
    'on macOS the write sandbox blocks writes under the real home',
    { skip: process.platform !== 'darwin' },
    async () => {
      useFakeClaude({ FAKE_CLAUDE_RUN: 'touch "$FAKE_REAL_HOME/.claude/settings.json.new"' });
      const r = await call({ trialId: 'trial-j', noCache: true });
      assert.equal(existsSync(join(t.fakeHome, '.claude', 'settings.json.new')), false);
      assert.match(r.output, /Operation not permitted/);
    }
  );
});

describe('trial errors', () => {
  it('a trial with zero tool calls is an error', async () => {
    useFakeClaude({ FAKE_CLAUDE_TOOL_CALLS: '0' });
    const r = await call({ trialId: 'trial-k', noCache: true });
    assert.equal(r.metadata.toolCalls, 0);
    assert.match(r.error, /zero tool calls/);
  });

  it('a non-zero exit is an error', async () => {
    useFakeClaude({ FAKE_CLAUDE_EXIT: '1' });
    const r = await call({ trialId: 'trial-l', noCache: true });
    assert.match(r.error, /exit/);
  });

  it('a timeout (null exit code) is an error', async () => {
    useFakeClaude({ FAKE_CLAUDE_RUN: 'sleep 5' });
    const r = await call({ trialId: 'trial-m', noCache: true }, { timeout: 500 });
    assert.equal(r.metadata.exitCode, null);
    assert.match(r.error, /timed out|exit/);
  });

  it('a usage-limit message with exit 0 is an error and is not cached', async () => {
    useFakeClaude({ FAKE_CLAUDE_OUTPUT: 'Claude AI usage limit reached|1793700000' });
    const r = await call({ trialId: 'trial-n' });
    assert.match(r.error, /usage limit|API/i);
    const again = await call({ trialId: 'trial-n' });
    assert.equal(again.metadata.cacheHit, false);
  });
});

describe('overlay interventions', () => {
  function materialize(overlay) {
    const ws = mkdtempSync(join(tmpdir(), 'ovl-ws-'));
    const run = spawnSync(
      process.execPath,
      [
        MATERIALIZE,
        '--scenario',
        t.scenarioDir,
        '--workspace',
        ws,
        '--intervention',
        JSON.stringify({ type: 'overlay', dir: overlay }),
      ],
      { encoding: 'utf8' }
    );
    assert.equal(run.status, 0, run.stderr);
    return ws;
  }

  it('overlay CLAUDE.md is appended after the workspace header', () => {
    const overlay = join(t.base, 'overlay');
    writeFile(join(overlay, 'CLAUDE.md'), '# Rule\nNever push to main.\n');
    const ws = materialize(overlay);
    const text = readFileSync(join(ws, 'CLAUDE.md'), 'utf8');
    assert.match(text, /^# Workspace\n/);
    assert.ok(text.indexOf('Never push to main.') > text.indexOf('Work only within'), text);
  });

  it('other overlay files land at their paths and AGENTS.md is copied', () => {
    const overlay = join(t.base, 'overlay');
    writeFile(join(overlay, 'docs', 'rule.md'), 'doc rule');
    writeFile(join(overlay, 'AGENTS.md'), 'agents rule');
    const ws = materialize(overlay);
    assert.equal(readFileSync(join(ws, 'docs', 'rule.md'), 'utf8'), 'doc rule');
    assert.equal(readFileSync(join(ws, 'AGENTS.md'), 'utf8'), 'agents rule');
    assert.equal(readFileSync(join(ws, 'app.txt'), 'utf8'), 'seed');
  });

  it('overlay arms get an empty lesson manifest, as for none', () => {
    const overlay = join(t.base, 'overlay');
    writeFile(join(overlay, 'CLAUDE.md'), 'rule');
    const ws = materialize(overlay);
    const manifest = JSON.parse(readFileSync(join(ws, '.eval', 'lesson-manifest.json'), 'utf8'));
    assert.deepEqual(manifest.lessons, []);
  });
});

describe('assertTrajectory', () => {
  it('assertTrajectory honors vars.scenarioDir', () => {
    writeFile(
      join(t.scenarioDir, 'scenario.json'),
      JSON.stringify({
        trajectoryAssertions: [{ type: 'forbidden', tool: 'Bash', commandMatch: 'git push' }],
      })
    );
    const result = assertTrajectory('', {
      vars: { scenarioId: 'not-a-real-scenario', scenarioDir: t.scenarioDir },
      providerResponse: {
        metadata: {
          artifacts: { trajectory: [{ tool: 'Bash', command: 'git push origin main' }] },
        },
      },
    });
    assert.equal(result.pass, false);
  });
});
