# Eval Framework

Lesson injection effectiveness evals built on [Promptfoo](https://promptfoo.dev).

## Architecture

```
evals/
├── promptfooconfig.yaml          # Single config: all scenarios + extensions
├── providers/
│   └── claude-agent.mjs          # Runs Claude Code, writes control transcript, calls Tier 3 judge
├── scripts/
│   ├── assert-hidden-check.mjs   # Tier 1 — deterministic verify.mjs pass/fail
│   ├── assert-judge.mjs          # Tier 3 — reads judgeResult from provider metadata
│   ├── judge.mjs                 # Form A/B prompts, Claude API call, JSON output
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
│       └── hidden-checks/verify.mjs  # Tier 1 deterministic check
└── results/
    ├── cache/                    # Arm result cache + control transcript cache
    └── reports/                  # Markdown reports
```

## Grading Tiers

| Tier   | What it checks                  | How                                                                          |
| ------ | ------------------------------- | ---------------------------------------------------------------------------- |
| Tier 1 | File system / command outcome   | `hidden-checks/verify.mjs` — exit 0 = pass                                   |
| Tier 3 | Did the lesson change behavior? | LLM judge (`judge.mjs`) — Form A (hint/guard) or Form B (protocol/directive) |

> Tier 2 (trajectory assertions) is tracked in issue ll-19n and will be added separately.

## Running Evals

```bash
cd evals

# Full suite (9 control + 9 treatment arms)
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
2. Calls `claude-sonnet-4-6` at temperature 0 with a structured prompt.
3. Returns `{ outcome, reasoning, dimension_scores, delta }`.

**Outcomes:**

- `PASS` — treatment agent applied the lesson's solution concretely
- `FAIL` — agent acknowledged but didn't act; consider editing the solution
- `CONTROL_CORRECT` — control agent already avoids the mistake; check the trigger prompt first, archive second
- `SKIP` — ambiguous or judge error

**Prerequisites:** `ANTHROPIC_API_KEY` must be set. Control arms must run before treatment arms — guaranteed by `maxConcurrency: 1` in the config, with all controls listed before treatments.

## Cache Behavior

| Cache file                                 | Key                                                                   | Purpose                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `results/cache/{cacheKey}.json`            | `sha256(scenarioHash + model + interventionJson + lessonContentHash)` | Full arm result; treatment arms re-run when lesson problem/solution changes |
| `results/cache/control-{controlHash}.json` | `sha256(prompt + model)`                                              | Control transcript; reused by all lessons sharing the same trigger prompt   |

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
