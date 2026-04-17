# PRD: lessons-learned Eval Framework

**Status:** Pre-implementation
**Last updated:** 2026-04-11
**Author:** Joe Black
**Repo:** `github.com/joeblackwaslike/lessons-learned`

---

## Problem Statement

The lessons-learned plugin injects context into Claude Code sessions to prevent recurring agent mistakes. There is currently no automated way to verify that a given lesson — or a change to an existing lesson — actually improves agent behavior or output quality. Lessons are authored and edited without feedback on whether they work.

The eval framework answers one question:

> **Does injecting lesson X cause the agent to produce a better, working, higher-quality result?**

This is an **outcome metric**, not a process metric. An agent can follow every correct behavioral step and still produce broken code. The eval must run the agent to task completion and grade the artifact.

---

## Goals

1. Automatically validate that new lessons produce measurable improvement in agent output quality
2. Detect when lesson edits are regressions (edited version performs worse than prior version)
3. Provide a comparable, reproducible benchmark that can be re-run against different LLMs or lesson implementations
4. Run locally in under 10 minutes for a single lesson; run in CI on lesson store changes
5. Produce structured JSON results and human-readable markdown reports

## Non-Goals

- Replacing the existing `node:test` unit/integration/E2E test suite (orthogonal layer)
- Evaluating the hook injection pipeline itself (covered by existing tests)
- Real-time or production monitoring
- Evaluating agent behavior outside the lessons-learned injection context

---

## Background: Lesson Type Taxonomy

The plugin has four lesson types, each firing at a different hook point and requiring a different eval strategy.

| Type | Hook | Behavioral scope | Eval unit |
|------|------|-----------------|-----------|
| `hint` | `PreToolUse` | Single tool call | One tool invocation + downstream artifact |
| `guard` | `PreToolUse` | Single tool call | Hook output JSON (deterministic) |
| `protocol` | `SessionStart` / `SubagentStart` | Session-level reasoning | Full task completion + artifact |
| `directive` | `SessionStart` + `PreToolUse` | Session-wide principle | Full task completion + artifact |

`hint` and `guard` are scoped to a single tool call and can be evaluated without a full session. `protocol` and `directive` govern how an agent reasons throughout a session — evaluating them requires running a multi-turn session to completion and grading the deliverable.

---

## Eval Design

### Two-Arm A/B Experiment

Every eval runs two arms against the same scenario:

- **Control arm:** Agent receives the task with no lesson (or the prior lesson version) injected
- **Treatment arm:** Agent receives the task with the current lesson injected at the appropriate hook point

Both arms produce a deliverable. Both are graded. The score is the delta.

### Two Eval Modes

| Mode | When used | Control arm |
|------|-----------|-------------|
| **Absolute** | First eval for a new lesson; periodic re-baseline | No lessons loaded |
| **Diff** | Every subsequent lesson edit | Prior lesson version injected |

In Diff mode, the prior version's treatment arm result is reused as the current control — it was already cached from the prior eval run. After the first absolute eval, every subsequent lesson edit costs exactly one fresh arm run per scenario.

### Two Levels of Grading

**Level 1 — Process grade** (was the right behavior exhibited?)
Assessed by an LLM judge reading the session transcript. Necessary but not sufficient.

**Level 2 — Outcome grade** (did the deliverable improve?)
Assessed by deterministic checks (build, test, grep) and/or an LLM rubric judge comparing both artifacts. This is the ground truth.

Both levels are required. A lesson that produces the right process but a broken artifact has a bug — in the lesson text, the trigger, or the scenario design.

---

## Arm Result Caching

### Motivation

Control arms are deterministic given their inputs. Re-running them on every eval wastes compute and introduces variance that makes delta comparisons noisier.

### Cache Key

```
sha256(scenario_content + scaffold_hash + model_id + control_injection_content)
```

Where `control_injection_content` is `""` (Mode 1) or `lesson.injection` at the prior `contentHash` (Mode 2).

### Cache Location

```
eval/results/arm-cache/{cache_key}.json
```

### Cache Shape

```json
{
  "cache_key": "sha256:abc123...",
  "scenario_id": "git-worktree-parallel",
  "scaffold_version": "sha256:def456...",
  "model": "anthropic/claude-sonnet-4-6",
  "control_injection_hash": "sha256:000000...0000",
  "runs": 1,
  "created_at": "2026-04-11T14:32:00Z",
  "scores": {
    "process_score": 0.0,
    "outcome_code_score": 0.55,
    "outcome_llm_score": 0.40,
    "weighted_total": 0.42
  },
  "artifact": "...",
  "transcript": [...]
}
```

`control_injection_hash` is `sha256("")` for Mode 1. Field is always present so cache lookups are uniform across modes.

### Cache Invalidation

| Trigger | Busts cache? |
|---------|-------------|
| Scenario YAML content changes | Yes |
| Scaffold content changes | Yes |
| Judge model changes | Yes |
| Control injection content changes | Yes |
| Lesson text / trigger changes | **No** — control never sees the lesson under test |
| `--no-cache` flag | Yes |

### Lesson Lifecycle Through Cache

```
Lesson created
    → Mode 1: control = empty, treatment = lesson@v1
    → cache: arm(scenario, scaffold, model, "") = control result
    → cache: arm(scenario, scaffold, model, v1_hash) = treatment result

Lesson edited (v1 → v2)
    → Mode 2: control = lesson@v1 (cache HIT — was prior treatment)
    → treatment = lesson@v2 (fresh run)
    → cache: arm(scenario, scaffold, model, v2_hash) = new treatment result

Lesson edited again (v2 → v3)
    → Mode 2: control = lesson@v2 (cache HIT)
    → treatment = lesson@v3 (fresh run)
    → and so on
```

The `contentHash` field (`sha256:(mistake + remediation + triggers)`) already exists on every lesson in the schema and is used as the lookup key for prior versions.

---

## Test Cases (Initial Eval Suite)

Twelve test cases covering all four lesson types. Sourced from the lesson type reference document. These serve as the seed eval suite and smoke tests during implementation.

### `hint` — PreToolUse context injection

**TC-H1: Parallel agents corrupting a shared git worktree**
- Task: "Run these 3 git operations in parallel to speed them up"
- Control outcome: concurrent git processes on same worktree → silent index corruption
- Treatment outcome: agent uses `git worktree add` per parallel operation
- Process judge: Did agent use isolated worktrees?
- Outcome check (deterministic): `git fsck` exits 0 and `git log --oneline` shows no lost commits

**TC-H2: `eval` on user-supplied strings enables shell injection**
- Task: "Write a bash script that runs a user-provided command"
- Control outcome: script uses `eval "$user_cmd"`
- Treatment outcome: script uses array-based invocation
- Process judge: Did agent avoid raw `eval`?
- Outcome check (deterministic): run 5 injection attempts (e.g. `; rm -rf /tmp/testdir`) against produced script — all must be rejected without side effects

**TC-H3: Secrets hardcoded in source files**
- Task: "Add Stripe integration. The API key is sk_test_abc123"
- Control outcome: key literal written into source
- Treatment outcome: agent uses `os.environ["STRIPE_API_KEY"]`, notes `.env` usage
- Process judge: Did agent avoid writing the literal?
- Outcome check (deterministic): `grep -r "sk_test_abc123" .` returns 0 matches AND `git log --all -S "sk_test_abc123"` returns 0 commits

---

### `guard` — Tool call denial (deterministic only, no LLM judge)

**TC-G1: pytest hangs in non-interactive environments**
- Task: Run the test suite
- Control: hook not installed — bare `pytest` runs and hangs
- Treatment: hook intercepts command matching `^pytest(\s|$)` without required flags
- Check 1 (deterministic): hook stdout contains `permissionDecision === "deny"`
- Check 2 (deterministic): execute the corrected command from `permissionDecisionReason` — must exit 0 within 30 seconds

---

### `protocol` — Session-start reasoning reminders

**TC-P1: Subagents may not have access to the Bash tool**
- Task: "Spawn a subagent to analyze these log files and summarize the errors"
- Control outcome: subagent attempts `Bash` → `Error: No such tool available` → session fails
- Treatment outcome: subagent uses `Read`/`Glob` → produces valid error summary
- Process judge: Did agent check tool availability before spawning?
- Outcome check (pass/fail): Did the subagent task complete and produce a non-empty summary? Control expected to fail; treatment expected to succeed.

**TC-P2: Wrong hook response schema is silently ignored**
- Task: "Implement a PreToolUse hook that blocks `rm -rf` commands"
- Control outcome: agent uses `{ decision: "deny" }` schema → hook silently ignored, command executes
- Treatment outcome: agent reads existing hook source, uses correct `hookSpecificOutput` shape, writes schema assertion test
- Process judge: Did agent read a working hook before implementing? Did it write a test?
- Outcome check (deterministic): pipe test payload through produced hook → assert `permissionDecision === "deny"`. Run `node --test` on hook's test file → must exit 0.

**TC-P3: Overfitting a fix to a narrow observation**
- Task: "The injection fires on Read tool results causing false positives. Fix the trigger scoping."
- Control outcome: agent rewrites matcher as `Bash`/`TaskOutput` allowlist → drops MCP tools
- Treatment outcome: agent narrows to exclude `Read` only, preserving all other tools
- Process judge: Did agent scope the fix to match the observation?
- Outcome check (deterministic): hook pipeline integration test suite must fully pass after the fix — all existing tests green, no regressions.

---

### `directive` — Session-start + PreToolUse (principle-level)

**TC-D1: Speculative abstractions (SOLID/YAGNI/KISS)**
- Task: "Build a user authentication module. We might need OAuth, SSO, and magic links in the future."
- Control outcome: abstract factory patterns, pluggable strategy interfaces, placeholder OAuth stubs
- Treatment outcome: password auth + session management only; note what OAuth would require
- Process judge: Did agent restrict implementation to current stated requirements?
- Outcome checks:
  1. Builds and tests pass (`npm test` / `pytest` exits 0)
  2. Complexity check (LLM): "List abstractions, interfaces, or code paths that serve no current requirement." Treatment must have 0; control expected ≥2.
  3. Scope adherence (LLM rubric): treatment ≥8/10; control expected ≤5/10

**TC-D2: Implementing before requirements are clear**
- Task: "Build a data pipeline for our analytics needs"
- Scripted dialog (provided by harness): PostgreSQL events table, ~50k rows/day, 1-hour batch SLA, Metabase downstream, `events(id, user_id, event_type, properties jsonb, created_at)` schema
- Control outcome: agent writes code immediately without asking → implements against assumptions
- Treatment outcome: agent asks ≥3 clarifying questions, receives scripted answers, implements tailored pipeline
- Process judge: Did agent ask ≥3 clarifying questions before writing any code?
- Outcome checks:
  1. Requirements coverage (LLM): "Given [scripted requirements], does this implementation address them all?" Treatment ≥8/10.
  2. Mismatch detection (LLM): "Does this implementation contradict the stated requirements?" Control expected ≥2 contradictions; treatment must have 0.
  3. Acceptance test (scripted): harness runs spec-based acceptance tests against produced pipeline — treatment must pass all.

**TC-D3: Solo-authored plans as fait accompli**
- Task: "Plan the refactor of our auth system"
- Scripted constraint (injected mid-session for treatment arm only): "zero downtime, no breaking API changes"
- Control outcome: agent produces complete 5-phase plan without iteration — user never states constraints
- Treatment outcome: agent presents 2–3 options with trade-offs, gets scripted approvals, co-authors plan with stated constraints
- Process judge: Did agent present options and iterate before finalizing?
- Outcome checks:
  1. Constraint adherence (LLM): "Given [constraint], does this plan respect it?" Treatment ≥9/10; control expected ≤6/10 (constraint never stated to control arm).
  2. Plan quality (LLM): coherence, risks, rollback, testing coverage — both arms graded; delta expected ≥0.2.
  3. Actionability (LLM): "Could an engineer execute phase 1 tomorrow with no additional questions?" Treatment ≥7/10.

---

## Grading Architecture

Graders are composable — each returns `float` in `[0, 1]` and an explanation string. Lesson types wire specific combinations with defined weights.

### Grader Weights by Lesson Type

| Grader | `hint` | `guard` | `protocol` | `directive` |
|--------|--------|---------|------------|-------------|
| `process` (LLM) | 0.3 | — | 0.2 | 0.1 |
| `outcome_code` (deterministic) | 0.7 | 0.5 | 0.4 | 0.3 |
| `outcome_guard` (deterministic) | — | 0.5 | — | — |
| `outcome_llm` (LLM rubric) | — | — | 0.4 | 0.6 |

Directive evals weight outcome at 0.9 combined — the point of a directive is to produce better software, not to narrate the right principle. The 0.1 process grade is a sanity check: if outcome improves but process is 0, the lesson may be redundant or the scenario is poorly designed.

### Pass Criteria (Configurable)

| Type | Pass condition |
|------|---------------|
| `hint` | `delta ≥ 0.30` AND `treatment.outcome_code = 1.0` |
| `guard` | `treatment.outcome_guard = 1.0` (both sub-checks) |
| `protocol` | `delta ≥ 0.30` AND `treatment.outcome_code ≥ 0.8` |
| `directive` | `delta ≥ 0.25` AND `treatment.outcome_llm ≥ 0.75` AND `treatment.outcome_code ≥ 0.8` |

Directive delta threshold is lower (0.25 vs 0.30) because the absolute `outcome_llm ≥ 0.75` bar is the stronger signal.

### Outcome LLM Judge Prompt — Code Quality Rubric

Used for `protocol` and `directive` lesson types.

```
You are a senior software engineer reviewing two implementations of the same task.
Both were produced by an AI agent. Implementation A had no guiding principle.
Implementation B was guided by this principle:

  Principle: {lesson.summary}
  Intended effect: {lesson.remediation}

Task: {scenario.task}

Evaluate on these dimensions (score each 0–10):

1. Correctness: Does it do what was asked?
2. Scope adherence: Does it implement only what was required, no more?
3. Clarity: Is the code readable and logically structured?
4. Testability: Is it structured to make testing easy?
5. Absence of known failure mode: Does it avoid: {lesson.mistake}?

Implementation A (control):
{control_artifact}

Implementation B (treatment):
{treatment_artifact}

Score both on each dimension.
Dimension 5 is a required pass for the treatment arm.

Output JSON only:
{
  "dimension_scores": { "control": [d1,d2,d3,d4,d5], "treatment": [d1,d2,d3,d4,d5] },
  "delta": <treatment_avg - control_avg>,
  "dimension_5_pass": <bool>,
  "pass": <bool>,
  "reasoning": "<one paragraph>"
}
```

### Outcome LLM Judge Prompt — Requirements Coverage

Used for TC-D2 and TC-D3.

```
You are checking whether a software deliverable meets a set of stated requirements.

Requirements:
{scripted_requirements}

Deliverable:
{artifact}

For each requirement: MET / NOT MET / PARTIALLY MET.
List any assumptions in the deliverable that CONTRADICT the requirements.

Output JSON only:
{
  "requirements": [{"requirement": "...", "status": "..."}],
  "score": <met_count / total>,
  "contradictions": ["..."]
}
```

---

## Scripted User Responses

For `protocol` and `directive` session evals that require user interaction during the session (clarifying questions, design approvals), the eval harness provides a scripted dialog — predefined responses keyed by trigger keywords.

The harness routes agent questions through a keyword matcher. If the control arm agent skips requirements gathering, it receives no scripted responses and implements against its own assumptions.

Example for TC-D2:

```yaml
# eval/scenarios/fixtures/data-pipeline-dialog.yaml
task: "Build a data pipeline for our analytics needs"
scripted_responses:
  - trigger: "data source"
    response: "PostgreSQL events table, ~50k rows/day, append-only"
  - trigger: "latency"
    response: "Batch is fine, 1-hour SLA"
  - trigger: "downstream"
    response: "Metabase dashboard reads from a summary table"
  - trigger: "schema"
    response: "events(id, user_id, event_type, properties jsonb, created_at)"
  - wildcard: true
    response: "Let's keep it simple for now, we can expand later"
acceptance_tests:
  - "Pipeline reads from events table (not a mock source)"
  - "Output lands in a summary table with correct schema"
  - "Runs within 1-hour window"
  - "No hardcoded connection strings"
```

---

## Session Eval Scaffolds

For `protocol` and `directive` evals, the agent works inside a fresh project scaffold — a minimal real codebase with enough structure to make the task meaningful.

Each scaffold lives in `eval/scaffolds/` and is checked into the repo.

**Harness behavior per arm:**
1. Copy scaffold to temp Docker volume (arms never share state)
2. Start session with or without lesson injection
3. Provide task prompt; route scripted user responses
4. Run to completion (or timeout)
5. Run deterministic outcome checks on produced artifact
6. Pass artifact to LLM outcome judge

**Scaffold design rules:**
- Must build and pass its own baseline tests before eval runs (verified at harness startup)
- All relevant files must fit in one LLM context window
- Must have a clear, checkable completion criterion in `scaffold.yaml`

---

## Scoring Output

### Per-lesson JSON record

```json
{
  "lesson_id": "01KN96KK3P0YZJNXKAWBJM0H0D",
  "slug": "no-speculative-abstractions-abcd",
  "type": "directive",
  "eval_mode": "absolute",
  "scenario_id": "auth-module-yagni",
  "arms": {
    "control": {
      "cache_hit": false,
      "process_score": 0.0,
      "outcome_code_score": 0.6,
      "outcome_llm_score": 0.4,
      "weighted_total": 0.42
    },
    "treatment": {
      "process_score": 0.9,
      "outcome_code_score": 1.0,
      "outcome_llm_score": 0.85,
      "weighted_total": 0.895
    }
  },
  "improvement_delta": 0.475,
  "pass": true,
  "failure_reason": null
}
```

### Markdown report format

```markdown
# Eval Report — 2026-04-11 14:32 UTC

**Run:** `01KPABCDE` | **Ref:** `abc1234` | **Judge:** claude-sonnet-4-6 + o4-mini

## Summary

| Metric | Value |
|--------|-------|
| Lessons evaluated | 12 |
| Pass rate | 83.3% (10/12) |
| Mean improvement delta | +0.49 |
| Regressions | 0 |
| New failures | 1 |

## Results

| Lesson | Type | Mode | Control | Treatment | Delta | Pass |
|--------|------|------|---------|-----------|-------|------|
| git-stash-untracked | hint | absolute | 0.28 | 0.95 | +0.67 | ✅ |
| pytest-hang | guard | absolute | — | 1.00 | — | ✅ |
| no-speculative-abstractions | directive | diff | 0.42 | 0.90 | +0.48 | ✅ |
| git-worktree-parallel | hint | absolute | 0.55 | 0.70 | +0.15 | ❌ |

## Failures

### git-worktree-parallel (hint) — FAILED
Delta: +0.15 (threshold: 0.30) | Treatment outcome_code: 0.70 (threshold: 1.00)

**Diagnosis:** Trigger fires too late — command setup happens before the git commands match.
Consider a SubagentStart variant or rewriting commandPatterns to match the setup step.
```

---

## Tech Stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Eval harness | Inspect AI (`inspect-ai`) | Best-in-class agentic eval primitives, Docker sandboxing, LLM judge, Inspect View, MIT |
| Scenario generation | Bloom (`github.com/safety-research/bloom`) | Bloom seed → diverse scenarios; exports Inspect-compatible JSON |
| LLM backend | LiteLLM | Provider-agnostic; switching models is a config change |
| Primary judge | `anthropic/claude-sonnet-4-6` | Process + outcome grading |
| Secondary judge | `openai/o4-mini` | Code quality rubric (stronger on structured code review) |
| Runtime | Python 3.12, `uv` | Matches Bloom and Inspect AI; separate `eval/` dir excluded from npm package |
| Sandboxing | Docker (via Inspect AI built-in) | Required for deterministic artifact checks and isolation between arms |

---

## Directory Layout

```
eval/
├── pyproject.toml               # uv: inspect-ai, litellm, anthropic, docker
├── justfile                     # eval targets
├── evals/
│   ├── lesson_eval.py           # Inspect Task entry point
│   ├── dataset.py               # lessons.json → Inspect Samples
│   ├── solver_pretooluse.py     # two-arm solver: hint + guard
│   ├── solver_session.py        # multi-turn solver: protocol + directive
│   └── graders/
│       ├── process.py           # LLM process judge
│       ├── outcome_code.py      # deterministic: build + test + shell checks
│       ├── outcome_llm.py       # LLM rubric: quality + requirements coverage
│       └── outcome_guard.py     # deterministic: hook output + corrected command
├── scenarios/
│   ├── seeds/                   # Bloom seed YAMLs (one per lesson)
│   ├── generated/               # Bloom output, cached by contentHash
│   └── fixtures/                # hand-written scenarios + scripted dialogs
├── scaffolds/
│   ├── auth-module/             # TC-D1, TC-D2 project scaffold
│   ├── data-pipeline/           # TC-D2 project scaffold
│   └── hook-implementation/     # TC-P2 project scaffold
├── results/
│   └── arm-cache/               # cached arm results (gitignored)
└── reports/                     # markdown run summaries (committed)
```

---

## CLI / just Targets

```bash
just eval-baseline              # Mode 1: run + cache control arms for all lessons
just eval-baseline --n 5        # average 5 runs per arm before caching
just eval-run                   # Mode 2 if prior contentHash exists; Mode 1 otherwise
just eval-run --mode absolute   # force Mode 1
just eval-run --mode diff       # force Mode 2 (fails if no prior hash in git)
just eval-run --no-cache        # re-run both arms fresh
just eval-run --lesson-id X     # single lesson
just eval-scenarios             # generate Bloom scenarios for lessons with no cached scenarios
just eval-scenarios --all       # regenerate all scenarios
just eval-report                # generate markdown report from latest results/
just eval-smoke                 # run TC-H3 + TC-G1 only (fast sanity check, ~2 min)
```

---

## Implementation Phases

**Phase 1 — Scaffold** (~30 min)
- `eval/pyproject.toml`, `eval/justfile`
- `eval/evals/dataset.py`: `data/lessons.json` → Inspect `Sample` objects with `lesson_type` and `contentHash` in metadata

**Phase 2 — PreToolUse solver + graders** (~60 min)
- `solver_pretooluse.py`: two-arm solver; treatment arm calls real `pretooluse-lesson-inject.mjs` via subprocess
- `graders/outcome_code.py`: runs `outcome_check` shell command from scenario YAML
- `graders/outcome_guard.py`: hook stdout assertion + corrected command execution
- `graders/process.py`: LLM process judge
- Smoke test: TC-H3 + TC-G1

**Phase 3 — Session solver + scaffolds** (~90 min)
- `solver_session.py`: multi-turn runner with scripted response keyword router
- `graders/outcome_llm.py`: code quality rubric + requirements coverage judges
- `eval/scaffolds/auth-module/`, `eval/scaffolds/data-pipeline/`
- `eval/scenarios/fixtures/` scripted dialog YAMLs for TC-D2, TC-D3
- Smoke test: TC-D2

**Phase 4 — Arm caching** (~30 min)
- `arm-cache/` read/write logic keyed by `sha256(scenario + scaffold + model + control_injection)`
- `--no-cache`, `--mode`, `--n` flag handling in `dataset.py` / harness entrypoint

**Phase 5 — Scenario generation + Bloom** (~30 min)
- `eval/scenarios/seeds/*.yaml`: one per lesson
- `just eval-scenarios` target: calls `bloom run`, caches to `scenarios/generated/{slug}.json`
- `dataset.py` falls back to `fixtures/` if no generated scenarios exist

**Phase 6 — Reporter + CI** (~20 min)
- `evals/reporter.py`: Inspect JSON log → `reports/run-{ulid}.md`
- `.github/workflows/eval.yml`: triggers on `data/lessons.json` changes or manual dispatch; posts report diff as PR comment; fails on regressions

**Estimated total:** 3.5–4 hours with this document as context.

---

## Relationship to Existing Test Suite

| Layer | Concern | Framework |
|-------|---------|-----------|
| Unit / integration / E2E | Hook protocol correctness, injection pipeline, scanner, CLI | `node:test` (existing `tests/`) |
| **Eval** | **Does lesson injection produce better agent outcomes?** | **Inspect AI (this PRD)** |

These are orthogonal. A perfectly wired hook pipeline (all existing tests passing) with lessons that produce zero outcome improvement (eval failing) is a real and distinct failure mode. Both layers are needed.

---

## Future Extensions

| Item | Notes |
|------|-------|
| Lesson group evals | Eval sets of lessons together — test for interference or compounding effects |
| Skills + plugins | Same framework extends to SKILL.md and plugin evals — swap injection point, keep solver/judge structure |
| Regression gating | CI fails if `pass_rate` drops below threshold or any regression detected |
| Scenario coverage enforcement | New lessons blocked from merge without at least one hand-written scenario |
| Local judge | LiteLLM makes switching to Ollama trivial — bulk CI cost reduction |
| Lesson improvement suggestions | Failed lesson's outcome judge reasoning fed into a prompt that suggests rewrites |
