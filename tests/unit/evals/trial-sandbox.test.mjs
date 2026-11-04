import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashDir } from '../../../evals/lib/arm-cache.mjs';
import {
  createTrialSandbox,
  sandboxCommand,
  sandboxProfile,
} from '../../../evals/lib/trial-sandbox.mjs';
import { useTrialHarness } from '../../helpers/fake-claude.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MATERIALIZE = join(root, 'evals', 'scripts', 'materialize-workspace.mjs');
const HOOK_SHIM = join(root, 'evals', 'scripts', 'eval-hook-shim.mjs');
const darwinOnly = {
  skip: process.platform !== 'darwin' && 'sandbox-exec exists only on macOS',
};
const h = useTrialHarness();

function setScenario(json) {
  h.writeFile(join(h.scenarioDir, 'scenario.json'), JSON.stringify(json));
}

function writeProbe() {
  const probe = join(h.base, 'probe.mjs');
  h.writeFile(
    probe,
    [
      "import net from 'node:net';",
      'const [kind, target] = process.argv.slice(2);',
      "const s = kind === 'unix' ? net.connect(target) : net.connect(Number(target), kind);",
      "s.on('connect', () => { console.log('CONNECTED'); process.exit(0); });",
      "s.on('error', e => { console.log('DENIED', e.code); process.exit(1); });",
      '',
    ].join('\n')
  );
  return probe;
}

function listen(server, ...args) {
  return new Promise(resolve => server.listen(...args, () => resolve(server)));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('sandbox PATH reaches every shell', () => {
  it('git and gh resolve to the stubs in zsh, bash, and sh, login or not', async () => {
    const script = join(h.base, 'which-shells.sh');
    h.writeFile(
      script,
      [
        'for sh in "zsh -c" "zsh -lc" "zsh -ic" "bash -c" "bash -lc" "sh -c"; do',
        '  set -- $sh',
        `  echo "$sh=$(/bin/$1 $2 'command -v git; command -v gh' 2>/dev/null </dev/null | tr '\\n' ' ')"`,
        'done',
        `echo "envfile=$(/bin/zsh -c '. "$CLAUDE_ENV_FILE"; command -v git; command -v gh' | tr '\\n' ' ')"`,
        '',
      ].join('\n')
    );
    h.useFakeClaude({ FAKE_CLAUDE_RUN: `sh ${script}` });
    const r = await h.call({ trialId: 'p1', noCache: true });
    const stubDir = h.runs()[0].path0;
    assert.ok(stubDir.endsWith('/bin'), stubDir);
    for (const sh of ['zsh -c', 'zsh -lc', 'zsh -ic', 'bash -c', 'bash -lc', 'sh -c', 'envfile']) {
      const line = r.output.split('\n').find(l => l.startsWith(`${sh}=`));
      assert.equal(line, `${sh}=${stubDir}/git ${stubDir}/gh `, r.output);
    }
  });

  it('the agent keeps its toolchain: node resolves outside the stub dir in a login zsh', async () => {
    h.useFakeClaude({ FAKE_CLAUDE_RUN: 'echo "node=$(/bin/zsh -lc "command -v node")"' });
    const r = await h.call({ trialId: 'p2', noCache: true });
    const node = r.output.split('\n').find(l => l.startsWith('node='));
    assert.ok(node && node.length > 'node='.length, r.output);
    assert.ok(!node.includes(h.runs()[0].path0), node);
  });

  it('scenario env cannot override HOME or PATH', async () => {
    setScenario({ env: { HOME: '/tmp/evil-home', PATH: '/usr/bin:/bin' } });
    h.useFakeClaude();
    await h.call({ trialId: 'p3', noCache: true });
    const [run] = h.runs();
    assert.notEqual(run.home, '/tmp/evil-home');
    assert.ok(run.path0.endsWith('/bin') && run.path0 !== '/usr/bin', run.path0);
  });
});

describe('sandbox-exec write confinement', () => {
  it('the profile denies every write, then allows the trial root, /dev, and extra paths', () => {
    const sb = createTrialSandbox('profile');
    try {
      const extra = join(h.base, 'extra');
      const lines = sandboxProfile(sb, [extra]).split('\n');
      const denyAll = lines.indexOf('(deny file-write*)');
      assert.ok(denyAll > 0, lines.join('\n'));
      for (const path of [sb.root, '/dev', realpathSync(extra)]) {
        const allow = lines.indexOf(`(allow file-write* (subpath "${path}"))`);
        assert.ok(allow > denyAll, `${path} is not allowed after the deny`);
      }
    } finally {
      rmSync(sb.root, { recursive: true, force: true });
    }
  });

  it('a write outside the trial root fails; one in the workspace succeeds', darwinOnly, () => {
    const sb = createTrialSandbox('confine');
    const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    try {
      const script = `echo x > '${outside}/escaped'; echo x > '${sb.workspace}/inside'`;
      const { command, args } = sandboxCommand(sb, '/bin/sh', ['-c', script]);
      spawnSync(command, args);
      assert.equal(existsSync(join(outside, 'escaped')), false);
      assert.equal(existsSync(join(sb.workspace, 'inside')), true);
    } finally {
      rmSync(sb.root, { recursive: true, force: true });
    }
  });
});

describe('sandbox-exec network and read denies', () => {
  it('connecting to a unix socket under the real home is denied', darwinOnly, async () => {
    const sock = join(h.fakeHome, 's.sock');
    const server = await listen(
      net.createServer(c => c.end()),
      sock
    );
    try {
      h.useFakeClaude({ FAKE_CLAUDE_RUN: `node ${writeProbe()} unix ${sock}` });
      const r = await h.call({ trialId: 'n1', noCache: true });
      assert.match(r.output, /DENIED EPERM/);
    } finally {
      server.close();
    }
  });

  it('connecting to a localhost TCP port is denied', darwinOnly, async () => {
    const server = await listen(
      net.createServer(c => c.end()),
      0,
      '127.0.0.1'
    );
    try {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      h.useFakeClaude({ FAKE_CLAUDE_RUN: `node ${writeProbe()} 127.0.0.1 ${port}` });
      const r = await h.call({ trialId: 'n2', noCache: true });
      assert.match(r.output, /DENIED EPERM/);
    } finally {
      server.close();
    }
  });

  it('reading a credential file under the real home is denied', darwinOnly, async () => {
    h.writeFile(join(h.fakeHome, '.ssh', 'id_test'), 'secret-key');
    h.useFakeClaude({ FAKE_CLAUDE_RUN: 'head -c 20 "$FAKE_REAL_HOME/.ssh/id_test"' });
    const r = await h.call({ trialId: 'n3', noCache: true });
    assert.doesNotMatch(r.output, /secret-key/);
    assert.match(r.output, /Operation not permitted/);
  });
});

describe('simulated remotes', () => {
  const run = 'gh pr create --fill; git push origin main';

  it('scenario sandbox.simulateRemote: gh and git push succeed with canned output, not an error', async () => {
    setScenario({ sandbox: { simulateRemote: true } });
    h.useFakeClaude({ FAKE_CLAUDE_RUN: run });
    const r = await h.call({ trialId: 's1', noCache: true });
    assert.match(r.output, /https:\/\/github\.com\/.+\/pull\/\d+/);
    assert.match(r.output, /Everything up-to-date/);
    assert.deepEqual(r.metadata.sandbox.simulatedCalls, [
      'gh pr create --fill',
      'git push origin main',
    ]);
    assert.deepEqual(r.metadata.sandbox.forbiddenCalls, []);
    assert.equal(r.error, undefined);
  });

  it('without the flag the same calls are refused and the trial is an error', async () => {
    h.useFakeClaude({ FAKE_CLAUDE_RUN: run });
    const r = await h.call({ trialId: 's2', noCache: true });
    assert.deepEqual(r.metadata.sandbox.simulatedCalls, []);
    assert.equal(r.metadata.sandbox.forbiddenCalls.length, 2);
    assert.match(r.error, /forbidden/);
  });
});

describe('process lifetime', () => {
  it('a timeout kills the whole process group, including background children', async () => {
    const pidFile = join(h.writable, 'child.pid');
    h.useFakeClaude({ FAKE_CLAUDE_RUN: `sleep 30 & echo $! > ${pidFile}; sleep 30` });
    const r = await h.call({ trialId: 'g1', noCache: true }, { timeout: 1000 });
    assert.match(r.error, /timed out/);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    for (let i = 0; i < 20 && isAlive(pid); i++) await new Promise(res => setTimeout(res, 100));
    assert.equal(isAlive(pid), false, `background child ${pid} survived the timeout`);
  });

  it('output over the buffer limit is labelled as such, not as a timeout', async () => {
    h.useFakeClaude({ FAKE_CLAUDE_RUN: 'yes aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | head -c 11000000' });
    const r = await h.call({ trialId: 'g2', noCache: true });
    assert.match(r.error, /output exceeded/);
  });

  it('the trial root is removed after a failed trial', async () => {
    h.useFakeClaude({ FAKE_CLAUDE_EXIT: '1' });
    const r = await h.call({ trialId: 'g3', noCache: true });
    assert.ok(r.error);
    assert.equal(existsSync(dirname(h.runs()[0].home)), false);
  });
});

describe('token handling', () => {
  it('the OAuth token is redacted from output, stderr, and the cache entry', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok-SECRET-123';
    h.useFakeClaude({
      FAKE_CLAUDE_RUN: 'echo "out=$CLAUDE_CODE_OAUTH_TOKEN"',
      FAKE_CLAUDE_STDERR: 'echo "err=$CLAUDE_CODE_OAUTH_TOKEN"',
    });
    const r = await h.call({ trialId: 't1' });
    assert.doesNotMatch(JSON.stringify(r), /tok-SECRET-123/);
    assert.match(r.output, /out=\[REDACTED\]/);
    assert.match(r.metadata.stderr, /err=\[REDACTED\]/);
    const cached = readFileSync(
      join(process.env.EVAL_CACHE_DIR, `${r.metadata.cacheKey}.json`),
      'utf8'
    );
    assert.doesNotMatch(cached, /tok-SECRET-123/);
  });

  function stubSecurity(expiresInMs) {
    const dir = join(h.base, 'security-bin');
    const argvLog = join(h.base, 'security-argv.log');
    const creds = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'kc-SECRET-456',
        refreshToken: 'refresh-SECRET',
        expiresAt: Date.now() + expiresInMs,
      },
    });
    h.writeFile(join(dir, 'security'), `#!/bin/sh\necho "$*" >> '${argvLog}'\necho '${creds}'\n`);
    chmodSync(join(dir, 'security'), 0o755);
    process.env.PATH = `${dir}:${process.env.PATH}`;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    return argvLog;
  }

  it(
    'reads the Keychain token through `security`, never putting it in argv or logs',
    darwinOnly,
    async () => {
      const argvLog = stubSecurity(60 * 60_000);
      h.useFakeClaude({ FAKE_CLAUDE_RUN: 'echo "env=$CLAUDE_CODE_OAUTH_TOKEN"' });
      const r = await h.call({ trialId: 't2', noCache: true });
      assert.equal(r.error, undefined, r.error);
      assert.equal(h.runs()[0].token, 'set');
      assert.match(r.output, /env=\[REDACTED\]/);
      for (const text of [
        readFileSync(argvLog, 'utf8'),
        readFileSync(h.log, 'utf8'),
        JSON.stringify(r),
      ]) {
        assert.doesNotMatch(text, /kc-SECRET-456|refresh-SECRET/);
      }
    }
  );

  it(
    'a token that expires before timeout + 2 minutes stops the trial before it starts',
    darwinOnly,
    async () => {
      stubSecurity(11 * 60_000);
      h.useFakeClaude();
      await assert.rejects(
        h.call({ trialId: 't3', noCache: true }, { timeout: 10 * 60_000 }),
        /expires/
      );
      assert.equal(h.runs().length, 0);
    }
  );
});

describe('trial evidence', () => {
  it('empty output with zero tool calls is an error even without a trialId', async () => {
    h.useFakeClaude({ FAKE_CLAUDE_TOOL_CALLS: '0', FAKE_CLAUDE_OUTPUT: '' });
    const r = await h.call({ noCache: true });
    assert.match(r.error, /no output and no tool calls/);
  });

  it('allowNoToolCalls lets a text-only trial pass', async () => {
    setScenario({ allowNoToolCalls: true });
    h.useFakeClaude({ FAKE_CLAUDE_TOOL_CALLS: '0', FAKE_CLAUDE_OUTPUT: 'NONE' });
    const r = await h.call({ trialId: 'e1', noCache: true });
    assert.equal(r.error, undefined);
  });

  it('hook events survive the agent deleting .eval, and forged workspace events are ignored', async () => {
    h.useFakeClaude({
      FAKE_CLAUDE_RUN:
        'rm -rf .eval; mkdir -p .eval; printf "%s\\n" "{\\"type\\":\\"PreToolUse\\",\\"tool_name\\":\\"Bash\\",\\"tool_input\\":{\\"command\\":\\"forged\\"}}" > .eval/hook-events.ndjson',
    });
    const r = await h.call({ trialId: 'e2', noCache: true });
    assert.equal(r.metadata.toolCalls, 1);
    assert.deepEqual(
      r.metadata.artifacts.trajectory.map(e => e.command),
      ['ls']
    );
  });

  it('the hook shim writes to EVAL_LOG_DIR when set', () => {
    const logDir = join(h.base, 'eval-log');
    const ws = mkdtempSync(join(tmpdir(), 'shim-ws-'));
    const run = spawnSync(process.execPath, [HOOK_SHIM], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: ws }),
      env: { ...process.env, EVAL_LOG_DIR: logDir },
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(existsSync(join(logDir, 'hook-events.ndjson')));
    assert.equal(existsSync(join(ws, '.eval')), false);
  });

  it('the hook shim records malformed stdin instead of silently discarding it', () => {
    const logDir = join(h.base, 'eval-log-malformed');
    const run = spawnSync(process.execPath, [HOOK_SHIM], {
      input: 'not valid json',
      env: { ...process.env, EVAL_LOG_DIR: logDir },
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    const logged = readFileSync(join(logDir, 'hook-events.ndjson'), 'utf8');
    assert.match(logged, /"type":"PARSE_ERROR"/);
  });

  for (const stdin of ['{}', '[]']) {
    it(`the hook shim records a PARSE_ERROR for structurally invalid stdin ${stdin}`, () => {
      const logDir = join(h.base, `eval-log-invalid-${stdin.replace(/\W/g, '')}`);
      const run = spawnSync(process.execPath, [HOOK_SHIM], {
        input: stdin,
        env: { ...process.env, EVAL_LOG_DIR: logDir },
        encoding: 'utf8',
      });
      assert.equal(run.status, 0, run.stderr);
      const logged = readFileSync(join(logDir, 'hook-events.ndjson'), 'utf8');
      assert.match(logged, /"type":"PARSE_ERROR"/);
    });
  }

  it('a malformed hook event is surfaced as an error instead of a silent gap', async () => {
    h.useFakeClaude({
      FAKE_CLAUDE_RUN:
        'printf \'{"type":"PARSE_ERROR","timestamp":"now","error":"boom"}\\n\' >> "${EVAL_LOG_DIR:-.eval}/hook-events.ndjson"',
    });
    const r = await h.call({ trialId: 'e3', noCache: true });
    assert.match(r.error, /could not be parsed/);
  });

  it('the trial errors instead of restoring through an agent-replaced workspace', async () => {
    h.useFakeClaude({
      FAKE_CLAUDE_RUN:
        'outside="$(mktemp -d)"; d="$PWD"; cd ..; rm -rf "$d"; ln -s "$outside" "$d"',
    });
    await assert.rejects(h.call({ trialId: 'e4', noCache: true }), /not a real directory/);
  });

  it('the trial repairs an agent-replaced log dir instead of following it', async () => {
    setScenario({ allowNoToolCalls: true });
    const outside = mkdtempSync(join(tmpdir(), 'ws-outside-logdir-'));
    h.writeFile(join(outside, 'hook-events.ndjson'), 'forged');
    h.useFakeClaude({
      FAKE_CLAUDE_OUTPUT: 'NONE',
      // Replacing the log dir with a symlink after the fake CLI has already written its own
      // (real) hook events means those real events are lost too — forfeiting trajectory
      // evidence is the acceptable cost of refusing to trust an agent-forged log dir.
      FAKE_CLAUDE_RUN: `d="\${EVAL_LOG_DIR:-.eval}"; rm -rf "$d"; ln -s '${outside}' "$d"`,
    });
    const r = await h.call({ trialId: 'e5', noCache: true });
    assert.equal(r.error, undefined, r.error);
    assert.equal(readFileSync(join(outside, 'hook-events.ndjson'), 'utf8'), 'forged');
    assert.deepEqual(r.metadata.artifacts.trajectory, []);
  });
});

describe('cache and transcript hygiene', () => {
  it('a noCache trial writes no arm-result cache entry, but still writes its control transcript', async () => {
    h.useFakeClaude();
    const result = await h.call({ trialId: 'c1', noCache: true });
    const cacheDir = process.env.EVAL_CACHE_DIR;
    // The control transcript is a separate side-channel the judge needs even under
    // noCache; only the arm-result cache entry itself must be absent.
    assert.deepEqual(existsSync(cacheDir) ? readdirSync(cacheDir) : [], [
      `control-${result.metadata.controlHash}.json`,
    ]);
    const again = await h.call({ trialId: 'c1' });
    assert.equal(again.metadata.cacheHit, false);
  });

  it('the CLI version is part of the control hash', async () => {
    h.useFakeClaude({ FAKE_CLAUDE_VERSION: '1.0.0' });
    const a = await h.call({ noCache: true });
    h.useFakeClaude({ FAKE_CLAUDE_VERSION: '2.0.0' });
    const b = await h.call({ noCache: true });
    assert.notEqual(a.metadata.controlHash, b.metadata.controlHash);
  });

  it('hashDir changes when only a file mode changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mode-'));
    h.writeFile(join(dir, 'run.sh'), 'echo hi');
    const before = hashDir(dir);
    chmodSync(join(dir, 'run.sh'), 0o755);
    assert.notEqual(hashDir(dir), before);
  });

  it('an overlay dir containing a symlink is rejected', () => {
    const overlay = join(h.base, 'overlay');
    mkdirSync(overlay);
    symlinkSync(join(h.fakeHome, '.claude', 'settings.json'), join(overlay, 'settings.json'));
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
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /symlink/);
  });
});
