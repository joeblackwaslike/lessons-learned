import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assertTrajectory from '../../../evals/scripts/assert-trajectory.mjs';
import { useTrialHarness } from '../../helpers/fake-claude.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MATERIALIZE = join(root, 'evals', 'scripts', 'materialize-workspace.mjs');
const h = useTrialHarness();

describe('independent trials', () => {
  it('30 calls with distinct trialIds and noCache run claude 30 times', async () => {
    h.useFakeClaude();
    const results = [];
    for (let i = 0; i < 30; i++)
      results.push(await h.call({ trialId: `trial-${i}`, noCache: true }));
    assert.equal(h.runs().length, 30);
    assert.ok(results.every(r => r.metadata.cacheHit === false));
    assert.equal(new Set(results.map(r => r.metadata.cacheKey)).size, 30);
    assert.ok(
      results.every(r => !r.error),
      results.find(r => r.error)?.error
    );
  });

  it('same trialId without noCache: the second call is a cache hit', async () => {
    h.useFakeClaude();
    const first = await h.call({ trialId: 'trial-a' });
    assert.equal(first.metadata.cacheHit, false, first.error);
    const second = await h.call({ trialId: 'trial-a' });
    assert.equal(second.metadata.cacheHit, true);
    assert.equal(h.runs().length, 1);
  });

  it('EVAL_NO_CACHE=1 skips the cache', async () => {
    h.useFakeClaude();
    process.env.EVAL_NO_CACHE = '1';
    await h.call({ trialId: 'trial-b' });
    await h.call({ trialId: 'trial-b' });
    assert.equal(h.runs().length, 2);
  });

  it('metadata carries trialId and cliVersion', async () => {
    h.useFakeClaude({ FAKE_CLAUDE_VERSION: '7.7.7' });
    const r = await h.call({ trialId: 'trial-c', noCache: true });
    assert.equal(r.metadata.trialId, 'trial-c');
    assert.equal(r.metadata.cliVersion, '7.7.7 (Fake)');
  });

  it('scenario without lessonId runs without opening lessons.db', async () => {
    h.useFakeClaude();
    const r = await h.call({ trialId: 'trial-d', noCache: true });
    assert.equal(r.metadata.exitCode, 0);
  });

  it('passes --no-session-persistence', async () => {
    h.useFakeClaude();
    await h.call({ trialId: 'trial-e', noCache: true });
    assert.match(h.runs()[0].args, /--no-session-persistence/);
  });

  it('vars.mcp "none" forces the empty strict MCP config on a treatment arm', async () => {
    h.useFakeClaude();
    const overlay = join(h.base, 'overlay');
    h.writeFile(join(overlay, 'CLAUDE.md'), 'rule');
    await h.call({
      trialId: 'trial-f',
      noCache: true,
      mcp: 'none',
      intervention: { type: 'overlay', dir: overlay },
    });
    assert.match(h.runs()[0].args, /--mcp-config \{"mcpServers":\{\}\} --strict-mcp-config/);
  });
});

describe('mcp cache separation', () => {
  it('a treatment arm with vars.mcp "none" does not reuse the Serena arm cache entry', async () => {
    h.useFakeClaude();
    const overlay = join(h.base, 'overlay');
    h.writeFile(join(overlay, 'CLAUDE.md'), 'rule');
    const intervention = { type: 'overlay', dir: overlay };
    await h.call({ trialId: 'trial-o', intervention });
    const r = await h.call({ trialId: 'trial-o', intervention, mcp: 'none' });
    assert.equal(r.metadata.cacheHit, false);
  });
});

describe('trial sandbox', () => {
  it('runs claude with a per-trial HOME and TMPDIR, the stub bin first on PATH, and a token', async () => {
    h.useFakeClaude();
    await h.call({ trialId: 'trial-g', noCache: true });
    const [run] = h.runs();
    assert.notEqual(run.home, process.env.HOME);
    assert.ok(!run.home.startsWith(h.fakeHome), run.home);
    assert.equal(dirname(run.tmpdir), dirname(run.home));
    assert.equal(dirname(run.path0), dirname(run.home));
    assert.ok(existsSync(join(dirname(run.home))) === false, 'trial root is removed afterwards');
    assert.equal(run.token, 'set');
  });

  it('gh and git network calls fail, are logged, and fail the trial; local git works', async () => {
    h.useFakeClaude({
      FAKE_CLAUDE_RUN:
        'git --version; gh pr create --fill; git -C . push origin main; git remote add o https://x',
    });
    const r = await h.call({ trialId: 'trial-h', noCache: true });
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
    h.useFakeClaude({
      FAKE_CLAUDE_RUN:
        'mkdir "$FAKE_REAL_HOME/github/cloned"; echo hacked >> "$FAKE_REAL_HOME/Library/Application Support/Claude/claude_desktop_config.json"',
    });
    const r = await h.call({ trialId: 'trial-i' });
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
      h.useFakeClaude({ FAKE_CLAUDE_RUN: 'touch "$FAKE_REAL_HOME/.claude/settings.json.new"' });
      const r = await h.call({ trialId: 'trial-j', noCache: true });
      assert.equal(existsSync(join(h.fakeHome, '.claude', 'settings.json.new')), false);
      assert.match(r.output, /Operation not permitted/);
    }
  );
});

describe('trial errors', () => {
  it('a trial with zero tool calls is an error', async () => {
    h.useFakeClaude({ FAKE_CLAUDE_TOOL_CALLS: '0' });
    const r = await h.call({ trialId: 'trial-k', noCache: true });
    assert.equal(r.metadata.toolCalls, 0);
    assert.match(r.error, /zero tool calls/);
  });

  it('a non-zero exit is an error', async () => {
    h.useFakeClaude({ FAKE_CLAUDE_EXIT: '1' });
    const r = await h.call({ trialId: 'trial-l', noCache: true });
    assert.match(r.error, /exit/);
  });

  it('a timeout (null exit code) is an error', async () => {
    h.useFakeClaude({ FAKE_CLAUDE_RUN: 'sleep 5' });
    const r = await h.call({ trialId: 'trial-m', noCache: true }, { timeout: 500 });
    assert.equal(r.metadata.exitCode, null);
    assert.match(r.error, /timed out|exit/);
  });

  it('a usage-limit message with exit 0 is an error and is not cached', async () => {
    h.useFakeClaude({ FAKE_CLAUDE_OUTPUT: 'Claude AI usage limit reached|1793700000' });
    const r = await h.call({ trialId: 'trial-n' });
    assert.match(r.error, /usage limit|API/i);
    const again = await h.call({ trialId: 'trial-n' });
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
        h.scenarioDir,
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
    const overlay = join(h.base, 'overlay');
    h.writeFile(join(overlay, 'CLAUDE.md'), '# Rule\nNever push to main.\n');
    const ws = materialize(overlay);
    const text = readFileSync(join(ws, 'CLAUDE.md'), 'utf8');
    assert.match(text, /^# Workspace\n/);
    assert.ok(text.indexOf('Never push to main.') > text.indexOf('Work only within'), text);
  });

  it('other overlay files land at their paths and AGENTS.md is copied', () => {
    const overlay = join(h.base, 'overlay');
    h.writeFile(join(overlay, 'docs', 'rule.md'), 'doc rule');
    h.writeFile(join(overlay, 'AGENTS.md'), 'agents rule');
    const ws = materialize(overlay);
    assert.equal(readFileSync(join(ws, 'docs', 'rule.md'), 'utf8'), 'doc rule');
    assert.equal(readFileSync(join(ws, 'AGENTS.md'), 'utf8'), 'agents rule');
    assert.equal(readFileSync(join(ws, 'app.txt'), 'utf8'), 'seed');
  });

  it('overlay arms get an empty lesson manifest, as for none', () => {
    const overlay = join(h.base, 'overlay');
    h.writeFile(join(overlay, 'CLAUDE.md'), 'rule');
    const ws = materialize(overlay);
    const manifest = JSON.parse(readFileSync(join(ws, '.eval', 'lesson-manifest.json'), 'utf8'));
    assert.deepEqual(manifest.lessons, []);
  });
});

describe('assertTrajectory', () => {
  it('assertTrajectory honors vars.scenarioDir', () => {
    h.writeFile(
      join(h.scenarioDir, 'scenario.json'),
      JSON.stringify({
        trajectoryAssertions: [{ type: 'forbidden', tool: 'Bash', commandMatch: 'git push' }],
      })
    );
    const result = assertTrajectory('', {
      vars: { scenarioId: 'not-a-real-scenario', scenarioDir: h.scenarioDir },
      providerResponse: {
        metadata: {
          artifacts: { trajectory: [{ tool: 'Bash', command: 'git push origin main' }] },
        },
      },
    });
    assert.equal(result.pass, false);
  });
});
