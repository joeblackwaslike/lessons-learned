# Using the Eval Framework

The eval framework measures whether lesson injection actually changes Claude's behavior. It runs Claude Code against trigger scenarios — once without a lesson (control arm) and once with the lesson injected (treatment arm) — and grades the difference across three tiers.

## Prerequisites

```bash
cd evals && npm install
```

No API key required. The Tier 3 judge uses your existing `claude login` session.

## The Fastest Path: `/eval`

Type `/eval` in Claude Code for an interactive session that handles the full workflow: focus selection → scenario generation → eval run → report.

## Running Evals Manually

```bash
cd evals

# Full suite — all 9 scenario pairs (≈30–45 min)
npm run eval

# Smoke test — TC-H3 + TC-G1 only (≈5–8 min)
npm run eval:smoke

# Specific scenarios
npx promptfoo eval --config promptfooconfig.yaml \
  --filter-pattern 'TC-G1|TC-H1' \
  --output results/cache/latest-run.json
```

## Reading Results

### Terminal summary (after-all hook)

After the run completes, the terminal prints:

```
── Tier 3 Judge Summary ──────────────────────────────────────
  PASS: 6  FAIL: 2  CONTROL_CORRECT: 1  SKIP: 0
──────────────────────────────────────────────────────────────
```

### Markdown report

```bash
npm run eval:report:latest
```

The report is written to `evals/results/reports/report-<timestamp>.md` and printed to stdout. It includes:

- Summary table (pass rate, mean delta, regression count)
- Per-scenario result table
- Failure blocks with judge reasoning, dimension scores, and trajectory failures

### Web viewer

```bash
npx promptfoo view
```

Multi-run browser with charts, filtering, and per-result detail. Persists across runs — every eval is stored in `~/.promptfoo/promptfoo.db`.

## Understanding Outcomes

### Tier 1 — Deterministic check

`hidden-checks/verify.mjs` in each scenario folder. Exit 0 = pass. Checks whether the agent produced the correct artifact (file created, correct content, tests passing, etc.).

### Tier 2 — Trajectory assertions

Checks the sequence of tool calls recorded in `hook-events.ndjson`. Defined per-scenario in `scenario.json` under `trajectoryAssertions`. Example checks: "agent used `git worktree add`", "agent ran the test suite", "pytest was called with timeout flags".

Returns pass if no assertions are defined for a scenario (not all behaviors are visible in tool-call trajectory).

### Tier 3 — LLM judge

Compares control and treatment transcripts (Form A: hint/guard) or evaluates the treatment transcript alone (Form B: protocol/directive). Outputs:

| Outcome           | Meaning                                            | Action                                                                                                                        |
| ----------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `PASS`            | Lesson caused agent to apply the fix concretely    | No action needed                                                                                                              |
| `FAIL`            | Agent acknowledged the lesson but didn't act on it | Edit the solution to be more prescriptive                                                                                     |
| `CONTROL_CORRECT` | Control agent already avoids the mistake           | Check the trigger prompt first — is it specific enough? Refine and re-run. If prompt is sound, consider archiving the lesson. |
| `SKIP`            | Ambiguous or judge error                           | Check stderr; often a missing control transcript                                                                              |

**Dimension scores** (0–10 each, Form A only):

1. Correctness
2. Scope adherence
3. Clarity
4. Testability
5. Absence of failure mode ← most load-bearing for Tier 3 pass/fail

**Delta** = avg(treatment dimensions) − avg(control dimensions). Positive = improvement.

## Acting on Results

### FAIL — lesson not changing behavior

The solution is likely too vague. Make it prescriptive:

```bash
# Before: "Consider using git stash -u to include untracked files"
# After: "Always use git stash -u. Never use bare git stash."
node scripts/lessons.mjs edit \
  --id <slug> \
  --patch '{"solution": "Always use git stash -u. Never use bare git stash."}'
node scripts/lessons.mjs build
npm run eval:clean  # treatment cache invalidates automatically, but clean to be safe
npm run eval:smoke
```

### CONTROL_CORRECT — trigger prompt too easy

The scenario doesn't reliably reproduce the failure mode. Edit `scenarios/TC-*/PROMPT.md` to be more specific — add constraints that force the agent toward the mistake:

```bash
# Make the prompt less forgiving — don't hint at the solution
# Re-run the specific scenario after editing
npx promptfoo eval --config promptfooconfig.yaml \
  --filter-pattern 'TC-G1' \
  --output results/cache/latest-run.json
npm run eval:report:latest
```

### Trajectory assertion failures

A trajectory failure with a Tier 3 PASS is usually fine — the lesson worked but the agent took a different (valid) path. If both fail, the trajectory failure is a useful signal about what the agent did instead.

## Generating Scenarios for New Lessons

```bash
# Generate for all active lessons without a scenario (uses Claude API for prompt generation)
npm run eval:gen

# Generate for a specific lesson
npm run eval:gen -- --ids <lesson-slug>

# Add a hint to steer the trigger prompt
npm run eval:gen -- --ids <slug> --hint "focus on the case where .git is absent"

# Preview without writing files
npm run eval:gen -- --dry-run

# Overwrite an existing generated scenario
npm run eval:gen -- --ids <slug> --force
```

After generation, a `TC-{H|G|P|D}{N}-{slug}/` folder appears in `evals/scenarios/` and a control + treatment pair is appended to `promptfooconfig.yaml`. The auto-generated `hidden-checks/verify.mjs` only checks for non-empty output — replace it with a meaningful check before treating results as authoritative.

### Writing a good `hidden-checks/verify.mjs`

The verify script receives the workspace path as `process.argv[2]`. Exit 0 = pass, non-zero = fail.

```js
#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const workspace = process.argv[2];
const file = join(workspace, 'src', 'payments.js');

if (!existsSync(file)) process.exit(1);
const src = readFileSync(file, 'utf8');

// Fail if literal secret appears in source
if (/sk_test_[a-zA-Z0-9]+/.test(src)) process.exit(1);
process.exit(0);
```

### Writing trajectory assertions

Add `trajectoryAssertions` to `scenario.json`. Rules are evaluated against PreToolUse events:

```json
"trajectoryAssertions": [
  {
    "type": "required",
    "tool": "Bash",
    "commandMatch": "git worktree add",
    "description": "Agent used git worktrees for parallel isolation"
  },
  {
    "type": "forbidden",
    "tool": "Bash",
    "commandMatch": "^git stash$",
    "description": "Agent did not use bare git stash"
  }
]
```

Rule types: `required` (must appear), `forbidden` (must not appear). Match fields: `tool` (exact), `commandMatch` (regex on Bash command), `pathMatch` (regex on file path).

## Cache Reference

| File                                | Key                                                             | When it clears                              |
| ----------------------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| `results/cache/{key}.json`          | `sha256(scenarioHash + model + lessonProblem + lessonSolution)` | Lesson edited (problem or solution changed) |
| `results/cache/control-{hash}.json` | `sha256(prompt + model)`                                        | `npm run eval:clean`                        |

```bash
npm run eval:clean   # wipe all caches (next run is a full cold run)
```

## List Past Runs

```bash
npm run eval:runs
```

Full run history is in `~/.promptfoo/promptfoo.db` and browsable via `npx promptfoo view`.
