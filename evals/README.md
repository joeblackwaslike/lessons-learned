# Eval Framework

Lesson injection effectiveness evals built on [Promptfoo](https://promptfoo.dev).

## Architecture

```text
evals/
├── promptfooconfig.yaml          # Single config: all scenarios + extensions
├── justfile                      # just eval-smoke / eval-run / eval-report / eval-clean / ...
├── providers/
│   └── claude-agent.mjs          # Runs Claude Code, writes control transcript, calls Tier 3 judge
├── tools/
│   └── mock-serena.mjs           # Mock Serena MCP server for scenarios that need it stubbed
├── scripts/
│   ├── assert-hidden-check.mjs   # Tier 1 — deterministic verify.mjs pass/fail
│   ├── assert-judge.mjs          # Tier 3 — reads judgeResult from provider metadata
│   ├── judge.mjs                 # Form A/B prompts, Claude API call, JSON output
│   ├── probe-scenario.mjs        # One-off scenario debugging via the Anthropic SDK
│   ├── gen-regression-traps.mjs  # Generates adversarial traps for data/obsoleted-lessons.json
│   ├── repair-judge-errors.mjs   # Re-runs judge calls that failed with auth/transient errors
│   ├── materialize-workspace.mjs # Copies seed-workspace/ + runs seed-setup.mjs before each arm
│   ├── collect-artifacts.mjs     # Gathers tool-calls.jsonl / hook-events.ndjson after a run
│   ├── scenario-helpers.mjs      # gitInit()/writeFiles() building blocks for seed-setup.mjs
│   ├── hooks/
│   │   ├── before-each.mjs       # Injects lessonSnapshot into test vars
│   │   └── after-all.mjs         # Prints Tier 3 judge summary after all arms complete
│   ├── generate-scenarios.mjs    # npm run eval:gen — scaffolds TC-* folders
│   ├── render-report.mjs         # Markdown report with dimension scores
│   └── list-runs.mjs             # npm run eval:runs — lists result files
├── scenarios/
│   └── TC-*/                     # One folder per scenario (hand-crafted or generated)
│       ├── scenario.json         # Metadata: lessonId, interventionType, lessonType
│       ├── PROMPT.md             # Trigger prompt
│       ├── seed-workspace/       # Starting filesystem state for the agent
│       ├── seed-setup.mjs        # Optional: git state seeding via scenario-helpers.mjs
│       └── hidden-checks/verify.mjs  # Tier 1 deterministic check
└── results/
    ├── cache/                    # Arm result cache + control transcript cache
    └── reports/                  # Markdown reports
```

`just --list` (from `evals/`) shows the full command surface: `eval-smoke`, `eval-run`,
`eval-lesson`, `eval-scenario`, `eval-report`, `eval-report-file`, `eval-no-cache`, `eval-clean`.

## Grading Tiers

| Tier   | What it checks                  | How                                                                          |
| ------ | ------------------------------- | ---------------------------------------------------------------------------- |
| Tier 1 | File system / command outcome   | `hidden-checks/verify.mjs` — exit 0 = pass                                   |
| Tier 2 | Tool-call sequence              | `assert-trajectory.mjs` — declarative rules in `scenario.json`               |
| Tier 3 | Did the lesson change behavior? | LLM judge (`judge.mjs`) — Form A (hint/guard) or Form B (protocol/directive) |

## Running Evals

```bash
cd evals

# Full suite (87 control + 87 treatment arms)
npm run eval

# Smoke test (TC-H3 + TC-G1 only, fast)
npm run eval:smoke

# Markdown report
npm run eval:report:latest

# Web viewer (multi-run browser, charts)
npx promptfoo view

# List cached run files
npm run eval:runs
```

## Generating New Scenarios

```bash
# Generate for all active lessons that lack a scenario
npm run eval:gen

# Generate for specific lesson slugs
npm run eval:gen -- --ids never-write-literal-secret-values-into-s-b226,always-add-timeout-and-p-nocacheprovider-013f

# Add a focus hint to the generation prompt
npm run eval:gen -- --hint "focus on the untracked files edge case"

# Overwrite existing generated scenarios
npm run eval:gen -- --force

# Dry run (show what would be generated, no file creation)
npm run eval:gen -- --dry-run
```

Generated scenarios are in the same Promptfoo-native format as hand-crafted ones and are automatically appended to `promptfooconfig.yaml`.

## Tier 3 Judge

The judge (`scripts/judge.mjs`) runs inside `claude-agent.mjs` for treatment arms. It:

1. Determines form from lesson type: **Form A** (hint/guard) receives both control + treatment transcripts; **Form B** (protocol/directive) receives treatment only.
2. Calls `claude-sonnet-4-6` (override with `EVAL_JUDGE_MODEL`) with a structured prompt.
3. Returns `{ outcome, reasoning, dimension_scores, delta }`.

**Outcomes:**

- `PASS` — treatment agent applied the lesson's solution concretely
- `FAIL` — agent acknowledged but didn't act; consider editing the solution
- `CONTROL_CORRECT` — control agent already avoids the mistake; check the trigger prompt first, archive second
- `SKIP` — ambiguous or judge error

**Prerequisites:** `judge.mjs`, `probe-scenario.mjs`, `gen-regression-traps.mjs`,
`generate-scenarios.mjs`, and `repair-judge-errors.mjs` all call an isolated `claude -p`
subprocess (see `lib/claude-spawn.mjs`) — OAuth via your `claude login` session (the default
`~/.claude/` config dir), no env vars required, no meridian proxy needed. Control arms must run
before treatment arms — guaranteed by `maxConcurrency: 1` in the config, with all controls
listed before treatments.

## Agent Arm Sandbox

Agent arms run with permissions skipped, so each one runs in a per-trial sandbox
(`lib/trial-sandbox.mjs`). It narrows what a trial can do to the real machine; it is not a jail.

What each trial gets:

- A temp root with its own workspace, `HOME`, `TMPDIR`, and XDG dirs. The CLI's own state
  (`~/.claude.json`, settings, transcripts) goes to the temp home and is deleted afterwards.
- A stub `bin/` first on `PATH`. `gh` and the `git` network commands (`push`, `pull`, `fetch`,
  `clone`, `ls-remote`, `remote add|set-url`) exit 97 and are logged; other `git` commands run
  the real git. Shells reset `PATH` on startup (nix-darwin's `/etc/zshenv`, `path_helper` in
  login shells), so the same `PATH` is also exported from `CLAUDE_ENV_FILE` (sourced before
  every Bash tool command) and from the temp home's `.zshenv`, `.zprofile`, `.zshrc`, `.zlogin`,
  `.bashrc`, `.bash_profile`, and `.profile` (`BASH_ENV` and `ENV` point at them). The rest of
  `PATH` is the provider's own, so node, pnpm, uv, and python3 stay available.
- On macOS, `sandbox-exec` (turn off with `EVAL_SANDBOX_EXEC=0`) with this profile: allow by
  default, then deny every write except to the trial root (workspace, home, tmp, logs),
  `/dev`, and paths a provider adds (Serena's `.uv-cache`); deny reads of
  `~/.ssh`, `~/.config/gh`, `~/.aws`, `~/Library/Keychains`, `~/.git-credentials`,
  `~/.claude/.credentials.json`, `~/.netrc`, and `~/.npmrc`; deny outbound connections to unix
  sockets under the real home (this covers OrbStack's Docker socket) or matching
  `/var/run/*.sock`, to any localhost port (e.g. the Dolt server on 3308), and to TCP ports
  22 (SSH) and 9418 (`git://`). HTTPS to the internet stays open; the CLI needs it.
- A before/after snapshot of `~/github` (top-level names), `~/.claude/settings.json`,
  `~/.claude/CLAUDE.md`, `~/Library/Application Support/Claude/claude_desktop_config.json`,
  and `~/.codex/config.toml`.
- Hook logs (`hook-events.ndjson`, `tool-calls.jsonl`) written to `EVAL_LOG_DIR` in the trial
  root, outside the workspace, then copied over the workspace's `.eval/` before artifacts are
  collected. Clearing or forging `.eval/` in the workspace changes nothing.
- The agent runs in its own process group. On timeout or when output passes 10 MB, the
  whole group gets SIGTERM, then SIGKILL; leftovers are killed when the CLI exits.

What it does not stop:

- Reads anywhere except the denied paths: the agent can read the real home, including
  this repo and `~/.claude` (but not `~/.claude/.credentials.json`).
- HTTPS to any host. Seatbelt filters connections by address and port, not by host name,
  so it cannot allow only the model API. Codex's own `--sandbox workspace-write` blocks
  network for the commands it runs, but macOS cannot nest that seatbelt inside this one, so
  under `sandbox-exec` Codex runs with its sandbox bypassed and its commands get the same
  open network as Claude's. Real `git` or `gh` called by absolute path, `curl`, or `npm` can
  reach the network; the stubs only catch what resolves through `PATH`. They have no
  credentials to push with, since the credential files and the Keychain are unreadable and
  the temp home has no git or gh config.
- IPC that `(allow default)` leaves open: `defaults write` (via cfprefsd, which writes the
  real `~/Library/Preferences`), `launchctl`, `osascript` and other Apple Events, pasteboard,
  and other mach services. These act through daemons outside the sandbox, so a trial using
  them can change the real machine without tripping the write deny or the snapshot.
- Connections to this machine's non-loopback addresses.
- Off macOS there is no `sandbox-exec`: only the temp home, the stubs, and the snapshot.

Scenarios whose mistake is a push or a PR set `"sandbox": { "simulateRemote": true }` in
`scenario.json`. The stubs then succeed with canned output (a PR create prints a fake PR
URL, `git push` says `Everything up-to-date`) and the calls land in
`metadata.sandbox.simulatedCalls` instead of failing the trial; the scenario's
`trajectoryAssertions` or `verify.mjs` decide whether the mistake happened. Seeds must not
contain remote URLs.

The agent authenticates with `CLAUDE_CODE_OAUTH_TOKEN`. When that variable is unset, the
provider reads the access token of your `claude login` from the macOS Keychain (or
`~/.claude/.credentials.json`) and passes only that token, never the refresh token. A token
that expires within the trial timeout plus two minutes (at least five minutes) stops the run;
start any `claude` session to refresh it, or export a long-lived token from
`claude setup-token`. The token is in the agent's environment, so a tool call can print it;
the provider replaces it with `[REDACTED]` in everything it returns or caches.

The provider returns `error` (an ERROR row in promptfoo, never cached) when `claude` exits
non-zero, times out, overflows its output buffer, prints a usage-limit or API error, changes
a watched path, makes a refused `gh`/`git` call, or produces no output and no tool calls. For
statistical trials (`vars.trialId` set), a run with zero tool calls is an error too, unless
`scenario.json` sets `"allowNoToolCalls": true`.

## Cache Behavior

| Cache file                                 | Key                                                                                            | Purpose                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `results/cache/{cacheKey}.json`            | `sha256(scenarioHash + model + interventionJson + lessonContentHash + cliVersion [+ trialId])` | Full arm result; treatment arms re-run when lesson problem/solution changes |
| `results/cache/control-{controlHash}.json` | `sha256(scenarioId + model + requiresSignature + cliVersion)`                                  | Control transcript; reused by all lessons sharing the same trigger prompt   |

Overlay interventions also hash the overlay dir's files (paths, modes, content; an overlay
containing a symlink is rejected). `vars.noCache: true` (or `EVAL_NO_CACHE=1`) skips the cache
and the control-transcript write for statistical trials; `EVAL_CACHE_DIR` moves the cache.

Clear all caches: `npm run eval:clean`

## MCP Server Setup

The Promptfoo MCP server is registered in `.mcp.json` at the repo root. It exposes eval run history to AI agents (Claude Code, Codex).

**One-time setup** (automatic via `.mcp.json`):

```json
{
  "mcpServers": {
    "promptfoo": {
      "type": "stdio",
      "command": "npx",
      "args": ["promptfoo", "mcp"]
    }
  }
}
```

To verify it's visible in Claude Code: open the MCP panel — `promptfoo` should appear in the server list.

## Scenario Format

Each `TC-*/scenario.json` includes:

```json
{
  "id": "TC-H3-hardcoded-secrets",
  "lessonId": "never-write-literal-secret-values-into-s-b226",
  "interventionType": "lesson",
  "lessonType": "hint",
  "recommendedInterventions": ["never-write-literal-secret-values-into-s-b226"]
}
```

`lessonId` is the lesson slug. `interventionType` supports future expansion to `skill`, `claude-md`, `plugin`, etc. — no rework needed, just add a scenario folder with the right type and a matching judge form.
