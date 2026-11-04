import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  toHookEvents,
  toToolCallLog,
  unwrapShell,
  writeBackCodexAuth,
} from '../../../evals/providers/codex-agent.mjs';
import assertTrajectory from '../../../evals/scripts/assert-trajectory.mjs';
import { FAKE_CODEX_AUTH, useTrialHarness } from '../../helpers/fake-claude.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const COLLECT = join(root, 'evals', 'scripts', 'collect-artifacts.mjs');
const RECORDED = join(root, 'tests', 'fixtures', 'evals', 'codex-events.jsonl');
const AUTH_SECRETS = /idtok-SECRET-111|acctok-SECRET-222|reftok-SECRET-333|acct-SECRET-444/;
const darwinOnly = {
  skip: process.platform !== 'darwin' && 'sandbox-exec exists only on macOS',
};
const h = useTrialHarness();

function setScenario(json) {
  h.writeFile(join(h.scenarioDir, 'scenario.json'), JSON.stringify(json));
}

function readRecorded() {
  return readFileSync(RECORDED, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

// Recorded from codex-cli 0.162.1 (`codex exec --json`, prompt "Run the shell command
// `echo hello` once, then reply with exactly DONE."). A shell command is an
// `item.started` / `item.completed` pair whose `item.type` is "command_execution"; the
// command is wrapped as `/bin/zsh -lc '<command>'`.
describe('event mapping', () => {
  it('toToolCallLog maps the recorded command events to Bash lines', () => {
    const lines = toToolCallLog(readRecorded()).split('\n').filter(Boolean);
    assert.deepEqual(
      lines.map(l => JSON.parse(l)),
      [{ tool_name: 'Bash', tool_input: { command: 'echo hello' } }]
    );
  });

  it('collect-artifacts builds a non-empty trajectory from the hook events of a recorded run', () => {
    const ws = mkdtempSync(join(tmpdir(), 'codex-ws-'));
    h.writeFile(join(ws, '.eval', 'hook-events.ndjson'), toHookEvents(readRecorded()));
    const run = spawnSync(
      process.execPath,
      [COLLECT, '--workspace', ws, '--scenario', h.scenarioDir],
      { encoding: 'utf8' }
    );
    assert.equal(run.status, 0, run.stderr);
    const { trajectory } = JSON.parse(run.stdout);
    assert.deepEqual(
      trajectory.map(e => [e.type, e.tool, e.command]),
      [['PreToolUse', 'Bash', 'echo hello']]
    );
  });

  it('file changes become Edit events', () => {
    const events = [
      {
        type: 'item.completed',
        item: { id: 'f1', type: 'file_change', changes: [{ path: '/w/a.txt', kind: 'add' }] },
      },
    ];
    assert.deepEqual(JSON.parse(toHookEvents(events)), {
      type: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/w/a.txt' },
    });
  });
  it('web searches and MCP tool calls count as tool calls', () => {
    const mcp = {
      id: 'm1',
      type: 'mcp_tool_call',
      server: 'serena',
      tool: 'find_symbol',
      arguments: { name: 'main' },
    };
    const events = [
      { type: 'item.started', item: { id: 'w1', type: 'web_search', query: '' } },
      { type: 'item.completed', item: { id: 'w1', type: 'web_search', query: 'node test' } },
      { type: 'item.started', item: { ...mcp, status: 'in_progress' } },
      { type: 'item.completed', item: { ...mcp, status: 'completed' } },
    ];
    assert.deepEqual(
      toToolCallLog(events)
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l)),
      [
        { tool_name: 'WebSearch', tool_input: { query: 'node test' } },
        { tool_name: 'mcp__serena__find_symbol', tool_input: { name: 'main' } },
      ]
    );
  });
});

describe('codex provider', () => {
  it('returns output and metadata with hiddenCheck', async () => {
    h.writeFile(
      join(h.scenarioDir, 'hidden-checks', 'verify.mjs'),
      "console.log('verified'); process.exit(0);\n"
    );
    h.useFakeCodex({ FAKE_CODEX_OUTPUT: 'final answer' });
    const r = await h.callCodex({ trialId: 'm1', noCache: true });
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.output, 'final answer');
    assert.equal(r.metadata.hiddenCheck.pass, true);
    assert.equal(r.metadata.hiddenCheck.details, 'verified');
    assert.equal(r.metadata.trialId, 'm1');
    assert.equal(r.metadata.cliVersion, 'codex-cli 9.9.9');
    assert.equal(r.metadata.model, 'gpt-test');
    assert.equal(r.metadata.exitCode, 0);
    assert.equal(r.metadata.toolCalls, 1);
  });

  it('runs codex exec with the headless flags, the model, and the workspace', async () => {
    h.useFakeCodex();
    await h.callCodex({ noCache: true });
    const args = h.runs()[0].args;
    assert.match(args, /^exec --json --skip-git-repo-check --ephemeral /);
    assert.match(args, / -m gpt-test /);
    assert.match(args, / -C \S+\/workspace /);
    assert.match(args, /--disable apps /);
    assert.match(args, / -- do the task $/);
  });

  it('EVAL_CODEX_MODEL is used when the config names no model', async () => {
    process.env.EVAL_CODEX_MODEL = 'gpt-env';
    h.useFakeCodex();
    await h.callCodex({ noCache: true }, { model: undefined });
    assert.match(h.runs()[0].args, / -m gpt-env /);
  });

  it('missing model throws before codex runs', async () => {
    h.useFakeCodex();
    await assert.rejects(h.callCodex({ noCache: true }, { model: undefined }), /model/);
    assert.equal(h.runs().length, 0);
  });

  it('assertTrajectory sees a Codex command event', async () => {
    setScenario({
      trajectoryAssertions: [{ type: 'forbidden', tool: 'Bash', commandMatch: '^rm -rf build' }],
    });
    h.useFakeCodex({ FAKE_CODEX_COMMAND: 'rm -rf build' });
    const r = await h.callCodex({ trialId: 'tr1', noCache: true });
    assert.equal(r.error, undefined, r.error);
    const verdict = assertTrajectory(r.output, {
      vars: { scenarioId: 'TC-test', scenarioDir: h.scenarioDir },
      providerResponse: r,
    });
    assert.equal(verdict.pass, false, verdict.reason);
  });

  it('a quoted command reaches the trajectory intact', async () => {
    const command = `echo "it's done" | grep 'done'`;
    h.useFakeCodex({ FAKE_CODEX_COMMAND: command });
    const r = await h.callCodex({ trialId: 'q1', noCache: true });
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.metadata.toolCalls, 1);
    assert.equal(r.metadata.artifacts.trajectory[0].command, command);
  });

  it('a hidden check that cannot run is a trial error, not a thrown call, and is not cached', async () => {
    // Over spawnSync's 1 MB buffer, so runVerify throws ENOBUFS.
    h.writeFile(
      join(h.scenarioDir, 'hidden-checks', 'verify.mjs'),
      "process.stdout.write('x'.repeat(2 * 1024 * 1024));\n"
    );
    h.useFakeCodex();
    const r = await h.callCodex({ trialId: 'v1' });
    assert.match(r.error, /verify/);
    assert.equal(
      existsSync(join(process.env.EVAL_CACHE_DIR, `${r.metadata.cacheKey}.json`)),
      false
    );
  });

  it('the trial root is removed after a failed trial', async () => {
    h.useFakeCodex({ FAKE_CODEX_EXIT: '1' });
    const r = await h.callCodex({ trialId: 'g1', noCache: true });
    assert.ok(r.error);
    assert.equal(existsSync(dirname(h.runs()[0].home)), false);
  });
});

describe('codex sandbox', () => {
  it('CODEX_HOME holds only auth.json, a 0600 copy of the real one', async () => {
    h.useFakeCodex();
    await h.callCodex({ noCache: true });
    const [run] = h.runs();
    assert.equal(run.codex_home, 'auth.json ');
    assert.equal(run.auth_mode, '-rw-------');
  });

  it('runs codex with a per-trial HOME and TMPDIR, the stub bin first on PATH, and a minimal env', async () => {
    process.env.SOME_PARENT_SECRET = 'x';
    try {
      h.useFakeCodex();
      await h.callCodex({ noCache: true });
    } finally {
      delete process.env.SOME_PARENT_SECRET;
    }
    const [run] = h.runs();
    assert.ok(run.home.endsWith('/home') && !run.home.startsWith(h.fakeHome), run.home);
    assert.ok(run.tmpdir.endsWith('/tmp'), run.tmpdir);
    const stubDir = run.path0;
    assert.ok(stubDir.endsWith('/bin'), stubDir);
    assert.equal(run.git, `${stubDir}/git`);
    assert.equal(run.gh, `${stubDir}/gh`);
    assert.equal(run.zsh_git, `${stubDir}/git`);
    assert.equal(run.zsh_gh, `${stubDir}/gh`);
    const names = run.env.split(',');
    assert.ok(names.includes('CODEX_HOME'));
    assert.ok(!names.includes('CLAUDE_CODE_OAUTH_TOKEN'), run.env);
    assert.ok(!names.includes('SOME_PARENT_SECRET'), run.env);
  });

  it('gh and git network calls fail, are logged, and fail the trial', async () => {
    h.useFakeCodex({ FAKE_CODEX_RUN: 'git push origin main; gh pr create --fill' });
    const r = await h.callCodex({ trialId: 'f1', noCache: true });
    assert.equal(r.metadata.sandbox.forbiddenCalls.length, 2);
    assert.match(r.error, /forbidden/);
  });

  it('simulateRemote answers like a remote instead of refusing', async () => {
    setScenario({ sandbox: { simulateRemote: true } });
    h.useFakeCodex({ FAKE_CODEX_RUN: 'git push origin main' });
    const r = await h.callCodex({ trialId: 'f2', noCache: true });
    assert.deepEqual(r.metadata.sandbox.simulatedCalls, ['git push origin main']);
    assert.equal(r.error, undefined, r.error);
  });

  it('a write outside the workspace fails the trial', async () => {
    // Without sandbox-exec the fake can write there; the snapshot must still catch it.
    process.env.EVAL_SANDBOX_EXEC = '0';
    h.useFakeCodex({ FAKE_CODEX_RUN: 'mkdir -p "$FAKE_REAL_HOME/github/cloned"' });
    const r = await h.callCodex({ trialId: 'f3', noCache: true });
    assert.deepEqual(r.metadata.sandbox.outsideChanges, ['github/']);
    assert.match(r.error, /outside its sandbox/);
  });

  it('under sandbox-exec, codex skips its own seatbelt; without it, codex uses workspace-write', async () => {
    h.useFakeCodex();
    await h.callCodex({ noCache: true });
    process.env.EVAL_SANDBOX_EXEC = '0';
    await h.callCodex({ noCache: true });
    const [outer, inner] = h.runs().map(r => r.args);
    if (process.platform === 'darwin') {
      assert.match(outer, /--dangerously-bypass-approvals-and-sandbox/);
      assert.doesNotMatch(outer, /--sandbox /);
    }
    assert.match(inner, /--sandbox workspace-write/);
    assert.doesNotMatch(inner, /--dangerously-bypass-approvals-and-sandbox/);
  });

  it('without sandbox-exec, codex runs confined by its own sandbox and needs no opt-in', async () => {
    process.env.EVAL_SANDBOX_EXEC = '0';
    delete process.env.EVAL_ALLOW_UNSANDBOXED;
    h.useFakeCodex();
    const r = await h.callCodex({ noCache: true });
    assert.equal(r.error, undefined, r.error);
    assert.match(h.runs()[0].args, /--sandbox workspace-write/);
  });

  it('log writes do not follow a symlink the agent planted at a log file', async () => {
    const target = join(h.base, 'target.txt');
    h.writeFile(target, 'original');
    h.useFakeCodex({
      FAKE_CODEX_RUN: `ln -sf '${target}' "$EVAL_LOG_DIR/hook-events.ndjson"; ln -sf '${target}' "$EVAL_LOG_DIR/tool-calls.jsonl"`,
    });
    const r = await h.callCodex({ trialId: 'l1', noCache: true });
    assert.equal(readFileSync(target, 'utf8'), 'original');
    assert.equal(r.metadata.toolCalls, 1, r.error);
  });

  it('log writes do not follow the log dir replaced by a symlink', async () => {
    const targetDir = join(h.base, 'target-dir');
    h.writeFile(join(targetDir, 'hook-events.ndjson'), 'original');
    h.useFakeCodex({
      FAKE_CODEX_RUN: `rm -rf "$EVAL_LOG_DIR"; ln -s '${targetDir}' "$EVAL_LOG_DIR"`,
    });
    const r = await h.callCodex({ trialId: 'l2', noCache: true });
    assert.equal(readFileSync(join(targetDir, 'hook-events.ndjson'), 'utf8'), 'original');
    assert.deepEqual(readdirSync(targetDir), ['hook-events.ndjson']);
    assert.equal(r.metadata.toolCalls, 1, r.error);
  });

  it('the trial errors instead of restoring through an agent-replaced workspace', async () => {
    h.useFakeCodex({
      FAKE_CODEX_RUN: 'outside="$(mktemp -d)"; d="$PWD"; cd ..; rm -rf "$d"; ln -s "$outside" "$d"',
    });
    await assert.rejects(h.callCodex({ trialId: 'l3', noCache: true }), /not a real directory/);
  });

  it('a malformed codex event line is surfaced as an error instead of a silent gap', async () => {
    const eventsFile = join(h.base, 'malformed-events.jsonl');
    h.writeFile(
      eventsFile,
      [
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'cmd_0',
            type: 'command_execution',
            command: "/bin/zsh -lc 'echo hi'",
            aggregated_output: '',
            exit_code: 0,
            status: 'completed',
          },
        }),
        'not valid json',
        JSON.stringify({
          type: 'turn.completed',
          usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2 },
        }),
      ].join('\n') + '\n'
    );
    h.useFakeCodex({ FAKE_CODEX_EVENTS: eventsFile });
    const r = await h.callCodex({ trialId: 'l4', noCache: true });
    assert.match(r.error, /could not be parsed/);
  });

  it('the agent cannot read the real auth.json', darwinOnly, async () => {
    h.useFakeCodex({ FAKE_CODEX_RUN: 'cat "$FAKE_REAL_HOME/.codex/auth.json"' });
    const r = await h.callCodex({ trialId: 'a0', noCache: true });
    assert.match(r.output, /Operation not permitted/);
    assert.doesNotMatch(JSON.stringify(r), /SECRET|REDACTED/);
  });
});

describe('codex auth', () => {
  it('auth.json secrets never reach output, metadata, or the cache entry', async () => {
    h.useFakeCodex({
      FAKE_CODEX_RUN: 'cat "$CODEX_HOME/auth.json"',
      FAKE_CODEX_STDERR: 'cat "$CODEX_HOME/auth.json"',
    });
    const r = await h.callCodex({ trialId: 'a1' });
    assert.doesNotMatch(JSON.stringify(r), AUTH_SECRETS);
    assert.match(JSON.stringify(r), /\[REDACTED\]/);
    const cached = readFileSync(
      join(process.env.EVAL_CACHE_DIR, `${r.metadata.cacheKey}.json`),
      'utf8'
    );
    assert.doesNotMatch(cached, AUTH_SECRETS);
  });

  it('missing ~/.codex/auth.json throws before codex runs', async () => {
    const { rmSync } = await import('node:fs');
    rmSync(join(h.fakeHome, '.codex', 'auth.json'));
    h.useFakeCodex();
    await assert.rejects(h.callCodex({ noCache: true }), /auth\.json/);
    assert.equal(h.runs().length, 0);
  });

  it('a corrupt ~/.codex/auth.json throws a fixed message that does not quote it', async () => {
    h.writeFile(join(h.fakeHome, '.codex', 'auth.json'), '{"tokens": SECRET-CORRUPT');
    h.useFakeCodex();
    const err = await h.callCodex({ noCache: true }).catch(e => e);
    assert.match(err.message, /auth\.json is not valid JSON/);
    assert.doesNotMatch(err.message, /SECRET-CORRUPT/);
    assert.equal(h.runs().length, 0);
  });

  it('a truncated auth.json copy is not written back', async () => {
    const real = join(h.fakeHome, '.codex', 'auth.json');
    const before = readFileSync(real, 'utf8');
    h.useFakeCodex({ FAKE_CODEX_AUTH_WRITE: '{"tok' });
    const r = await h.callCodex({ noCache: true });
    assert.equal(r.metadata.sandbox.authWriteBack, 'skipped: invalid copy');
    assert.equal(readFileSync(real, 'utf8'), before);
  });

  it('rotated tokens are redacted as well as the original ones', async () => {
    const tokens = { ...FAKE_CODEX_AUTH.tokens, access_token: 'acctok-NEW-555' };
    const rotated = { ...FAKE_CODEX_AUTH, tokens: { ...tokens, refresh_token: 'reftok-NEW-666' } };
    h.useFakeCodex({
      FAKE_CODEX_AUTH_WRITE: JSON.stringify(rotated),
      FAKE_CODEX_RUN: 'cat "$CODEX_HOME/auth.json"',
      FAKE_CODEX_STDERR: 'cat "$CODEX_HOME/auth.json"',
      FAKE_CODEX_OUTPUT: 'old=acctok-SECRET-222',
    });
    const r = await h.callCodex({ trialId: 'a2' });
    assert.equal(r.error, undefined, r.error);
    const cached = readFileSync(
      join(process.env.EVAL_CACHE_DIR, `${r.metadata.cacheKey}.json`),
      'utf8'
    );
    for (const text of [JSON.stringify(r), cached]) {
      assert.doesNotMatch(text, AUTH_SECRETS);
      assert.doesNotMatch(text, /NEW-555|NEW-666/);
    }
  });

  it('a refreshed token is written back to the real auth.json, mode 0600', async () => {
    const refreshed = JSON.stringify({ ...FAKE_CODEX_AUTH, last_refresh: 'new' });
    h.useFakeCodex({ FAKE_CODEX_AUTH_WRITE: refreshed });
    await h.callCodex({ noCache: true });
    const real = join(h.fakeHome, '.codex', 'auth.json');
    assert.equal(readFileSync(real, 'utf8'), refreshed);
    assert.equal(statSync(real).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(join(h.fakeHome, '.codex')).sort(), [
      'auth.json',
      'config.toml',
      'history.jsonl',
    ]);
  });

  it('an unchanged auth.json is not written back', async () => {
    const real = join(h.fakeHome, '.codex', 'auth.json');
    const before = statSync(real).mtimeMs;
    h.useFakeCodex();
    await h.callCodex({ noCache: true });
    assert.equal(statSync(real).mtimeMs, before);
  });

  it('write-back is skipped when the real auth.json changed during the trial', async () => {
    process.env.EVAL_SANDBOX_EXEC = '0';
    h.useFakeCodex({
      FAKE_CODEX_AUTH_WRITE: JSON.stringify({ ...FAKE_CODEX_AUTH, last_refresh: 'trial' }),
      FAKE_CODEX_RUN: `printf '{"from":"live"}' > "$FAKE_REAL_HOME/.codex/auth.json"`,
    });
    const r = await h.callCodex({ noCache: true });
    assert.match(r.metadata.sandbox.authWriteBack, /real auth\.json changed/);
    assert.equal(readFileSync(join(h.fakeHome, '.codex', 'auth.json'), 'utf8'), '{"from":"live"}');
  });
});

describe('codex trial errors', () => {
  it('a trial with zero tool calls is an error', async () => {
    h.useFakeCodex({ FAKE_CODEX_TOOL_CALLS: '0', FAKE_CODEX_OUTPUT: 'NONE' });
    const r = await h.callCodex({ noCache: true });
    assert.match(r.error, /zero tool calls/);
  });

  it('a non-zero exit is an error', async () => {
    h.useFakeCodex({ FAKE_CODEX_EXIT: '2' });
    const r = await h.callCodex({ noCache: true });
    assert.match(r.error, /codex exited with code 2/);
  });

  it('a turn.failed usage-limit event with exit 0 is an error and is not cached', async () => {
    h.useFakeCodex({ FAKE_CODEX_FAIL: "You've hit your usage limit. Try again later." });
    const r = await h.callCodex({ trialId: 'u1' });
    assert.match(r.error, /usage limit/);
    const again = await h.callCodex({ trialId: 'u1' });
    assert.equal(again.metadata.cacheHit, false);
  });

  it('a timeout (null exit code) is an error', async () => {
    h.useFakeCodex({ FAKE_CODEX_RUN: 'sleep 30' });
    const r = await h.callCodex({ noCache: true }, { timeout: 1000 });
    assert.match(r.error, /timed out/);
  });
});

describe('codex cache', () => {
  it('noCache runs codex every time for the same trialId and writes no cache entry', async () => {
    h.useFakeCodex();
    for (let i = 0; i < 3; i++) {
      const r = await h.callCodex({ trialId: 'n1', noCache: true });
      assert.equal(r.metadata.cacheHit, false);
    }
    assert.equal(h.runs().length, 3);
    const dir = process.env.EVAL_CACHE_DIR;
    assert.deepEqual(existsSync(dir) ? readdirSync(dir) : [], []);
  });

  it('a run without sandbox-exec misses the cache of a sandbox-exec run', darwinOnly, async () => {
    h.useFakeCodex();
    const outer = await h.callCodex({ trialId: 'sb' });
    process.env.EVAL_SANDBOX_EXEC = '0';
    const inner = await h.callCodex({ trialId: 'sb' });
    assert.notEqual(outer.metadata.cacheKey, inner.metadata.cacheKey);
    assert.equal(inner.metadata.cacheHit, false);
    assert.equal(h.runs().length, 2);
  });

  it('same trialId without noCache hits the cache', async () => {
    h.useFakeCodex();
    const first = await h.callCodex({ trialId: 'same' });
    assert.equal(first.metadata.cacheHit, false);
    const second = await h.callCodex({ trialId: 'same' });
    assert.equal(second.metadata.cacheHit, true);
    assert.equal(h.runs().length, 1);
  });

  it('a different codex version misses the cache', async () => {
    h.useFakeCodex({ FAKE_CODEX_VERSION: '1.0.0' });
    const a = await h.callCodex({ trialId: 'v' });
    h.useFakeCodex({ FAKE_CODEX_VERSION: '2.0.0' });
    const b = await h.callCodex({ trialId: 'v' });
    assert.notEqual(a.metadata.cacheKey, b.metadata.cacheKey);
    assert.equal(b.metadata.cacheHit, false);
  });
});

describe('unwrapShell', () => {
  it('unwraps single- and double-quoted -lc wrappers', () => {
    assert.equal(unwrapShell(`/bin/zsh -lc 'echo "it'\\''s"'`), `echo "it's"`);
    assert.equal(unwrapShell('/bin/zsh -lc "git status"'), 'git status');
    assert.equal(unwrapShell('bash -c "echo \\"hi\\" \\$HOME"'), 'echo "hi" $HOME');
    assert.equal(unwrapShell('ls -la'), 'ls -la');
  });
});

describe('writeBackCodexAuth with an unreadable copy', () => {
  const original = Buffer.from('{"tokens":{"refresh_token":"r"}}');

  it('skips a directory at the copy path', () => {
    const copy = mkdtempSync(join(tmpdir(), 'auth-dir-'));
    const real = join(mkdtempSync(join(tmpdir(), 'auth-real-')), 'auth.json');
    const result = writeBackCodexAuth({ real, copy, original });
    assert.equal(result.status, 'skipped: unreadable copy');
    assert.equal(existsSync(real), false);
  });

  it('skips a FIFO at the copy path without blocking', () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-fifo-'));
    const copy = join(dir, 'auth.json');
    const made = spawnSync('/usr/bin/mkfifo', [copy]);
    assert.equal(made.status, 0, String(made.stderr));
    const result = writeBackCodexAuth({ real: join(dir, 'real.json'), copy, original });
    assert.equal(result.status, 'skipped: unreadable copy');
  });
});
