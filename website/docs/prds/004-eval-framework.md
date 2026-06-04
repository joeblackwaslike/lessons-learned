---
sidebar_position: 4
title: 'PRD-004: Eval Framework'
description: Design specification for the lessons-learned automated evaluation framework using Promptfoo for lesson effectiveness testing.
---

# PRD: `lessons-learned` Eval Framework

:::caution[Design Document]
This is a Product Requirements Document — a design specification. It describes intended behavior, not necessarily current implementation. Refer to the architecture docs for the current state.
:::

| Field               | Value                                        |
| ------------------- | -------------------------------------------- |
| **Status**          | Pre-implementation                           |
| **Author**          | Joe Black                                    |
| **Created**         | 2026-05-07                                   |
| **Repo**            | `github.com/joeblackwaslike/lessons-learned` |
| **Target location** | `lessons-learned/evals/` (subproject)        |

---

## 1. Problem Statement

`lessons-learned` can capture, store, and inject lessons into AI coding agent sessions — but there is currently no automated way to verify that a given lesson actually improves agent behavior. Lessons are authored and edited without feedback on whether they work. Lesson quality is inferred from intuition, manual observation, and static validation.

The eval framework answers one question:

> **Does injecting lesson X cause the agent to produce a better, working, higher-quality result?**

This is an **outcome metric**, not a process metric. An agent can follow every correct behavioral step and still produce broken code. The eval must run the agent to task completion and grade the artifact.

The existing test suite validates runtime contracts and deterministic hook logic. This is necessary but not sufficient. It does **not** tell us:

- whether a lesson improves task completion
- whether a lesson prevents a known-bad tool action
- whether changing lesson wording helps or hurts (instruction ablation / multivariate wording tests)
- whether a new lesson regresses existing behavior
- whether lesson groups outperform individual lessons
- whether the same framework can later evaluate skills, plugins, or CLAUDE.md changes

---

## 2. Goals

1. Fully automated local eval pipeline for lesson effectiveness
2. Control-vs-treatment A/B comparison (instruction ablation) for individual lessons and lesson groups
3. Structured run artifacts for every eval execution
4. Deterministic checks first, LLM-as-judge second
5. JSON results and Markdown reports
6. Reuse open-source frameworks for ≥80% of the implementation (find, not build)
7. CI-compatible from day one, even if CI integration ships later
8. Extensible to skills, plugins, and CLAUDE.md changes without redesign

---

## 3. Non-Goals

- Replacing the existing `node:test` unit/integration/E2E test suite
- Evaluating the hook injection pipeline itself (covered by existing tests)
- Real-time or production monitoring
- Hosted experiment platform in V1
- Building a generalized benchmark suite for all coding agents

---

## 4. Product Principles

**Find, not build.** Adopt an existing eval runner. Build only the repo-specific glue.

**Local-first.** Primary workflow is a developer running evals on their machine against a local checkout.

**Deterministic before subjective.** A hidden test, forbidden-command check, or trace assertion is more reliable than an LLM judge. LLM grading fills the gaps rather than owning the entire score.

**Behavioral evidence over final-text evidence.** Many lesson failures are about agent trajectory, not just the final response. The framework must capture workflow evidence, not only the assistant's final answer.

**Reuse real runtime hooks.** The eval environment uses the same lesson hooks and lesson artifacts as normal repo usage whenever feasible.

**Node-native.** The repo is ESM-first. The eval framework stays in the same language. No Python subproject in V1.

---

## 5. Framework Landscape: Decision Summary

| Framework                        | Language   | Agentic                                | LLM judge               | CI-ready | Local-first         | Fit                               |
| -------------------------------- | ---------- | -------------------------------------- | ----------------------- | -------- | ------------------- | --------------------------------- |
| **Promptfoo**                    | Node       | Claude Agent SDK + Codex SDK providers | model-graded assertions | Yes      | Yes                 | **V1 primary**                    |
| **Vercel next-evals-oss**        | TypeScript | Yes                                    | failure classifier only | Yes      | No (Vercel sandbox) | **Architecture reference**        |
| **Superpowers transcript tests** | Node       | Yes                                    | —                       | —        | Yes                 | **Behavior verification pattern** |
| **Inspect AI**                   | Python     | First-class                            | Built-in                | Yes      | Yes                 | **Future heavyweight**            |
| **Bloom**                        | Python     | generation only                        | judgment stage          | No       | Yes                 | **Future scenario gen**           |
| **DeepEval**                     | Python     | RAG-centric                            | 50+ metrics             | Yes      | Yes                 | Skip                              |
| **Braintrust**                   | TS+Python  | Limited                                | Yes                     | Yes      | No (SaaS)           | Later                             |

### Why Promptfoo wins V1

- Already ships a **Claude Agent SDK provider** and **OpenAI Codex SDK provider** — zero provider code to write for the two main targets
- Local CLI, JSON output, HTML output, model-graded assertions, custom JS/Python assertions, CI integration — all commodity, all present
- Node-native: fits the repo's existing runtime without a language boundary
- The only custom code needed: scenario materialization, lesson intervention wiring, hidden check scripts, Markdown renderer

### Why Inspect AI is the future path

- Most complete OSS agentic eval substrate (UK AISI, adopted by Anthropic and DeepMind)
- `Dataset → Task → Solver → Scorer` primitives map exactly to this domain
- Built-in Docker sandboxing, Inspect View log viewer, bootstrap confidence intervals

---

## 6. Selected Stack

| Concern                           | Choice                                                              | Source    |
| --------------------------------- | ------------------------------------------------------------------- | --------- |
| **Eval runner**                   | Promptfoo                                                           | Find      |
| **Scenario packaging pattern**    | Vercel next-evals-oss                                               | Adapt     |
| **Behavior verification pattern** | Superpowers transcript-testing                                      | Adapt     |
| **Primary judge**                 | `anthropic/claude-sonnet-4-6` via Promptfoo model-graded assertions | Configure |
| **Secondary judge**               | `openai/o4-mini` via Promptfoo (code quality rubric)                | Configure |
| **Runtime**                       | Node ≥22.5, ESM                                                     | Existing  |
| **Sandboxing**                    | Temp directory isolation (V1); Docker optional in V2                | Build     |
| **Result format**                 | Promptfoo JSON + custom Markdown renderer                           | Build     |
| **Scenario generation**           | Hand-written fixtures (V1); Bloom (future)                          | Defer     |
| **CI integration**                | Promptfoo `--ci` flag + GitHub Actions                              | Configure |

---

## 7. Architecture

```
lessons-learned/
└── evals/
    ├── package.json
    ├── promptfooconfig.yaml
    ├── scenarios/
    │   ├── TC-H1-git-worktree/
    │   │   ├── PROMPT.md
    │   │   ├── scenario.json
    │   │   ├── seed-workspace/
    │   │   ├── hidden-checks/
    │   │   │   └── verify.mjs
    │   │   └── rubric.md
    │   ├── TC-H2-eval-injection/
    │   ├── TC-H3-hardcoded-secrets/
    │   ├── TC-G1-pytest-hang/
    │   ├── TC-P1-subagent-tools/
    │   ├── TC-P2-hook-schema/
    │   ├── TC-P3-overfitted-fix/
    │   ├── TC-D1-speculative-abstractions/
    │   ├── TC-D2-requirements-before-code/
    │   └── TC-D3-collaborative-planning/
    ├── providers/
    │   ├── claude-agent.mjs
    │   ├── codex-agent.mjs
    │   └── openai-compat.mjs
    ├── scripts/
    │   ├── materialize-workspace.mjs
    │   ├── collect-artifacts.mjs
    │   └── render-report.mjs
    ├── fixtures/
    │   └── dialogs/
    │       ├── data-pipeline-dialog.yaml
    │       └── auth-plan-dialog.yaml
    ├── results/
    │   ├── cache/
    │   └── reports/
    └── justfile
```

### Run flow

```
Scenario
  → materialize temp workspace
  → apply intervention variant (none | lesson | lesson-group)
  → run agent via Promptfoo provider
  → collect hook events + trajectory artifacts
  → Tier 1: deterministic hidden checks
  → Tier 2: trajectory / trace assertions
  → Tier 3: LLM judge assertions (Promptfoo model-graded)
  → emit JSON result
  → render Markdown report
```

---

## 8. Intervention Model

The framework treats "lesson" as one intervention type among several.

### V1 intervention types

| Type           | Description                   |
| -------------- | ----------------------------- |
| `none`         | Baseline: no lesson injected  |
| `lesson`       | Single lesson by slug         |
| `lesson-group` | Explicit list of lesson slugs |

### Comparison semantics

For a **new lesson** (first eval):

- control = `none`
- treatment = `lesson`

For a **revised lesson** (instruction ablation / wording test):

- control = `previous lesson text` (cache hit from prior treatment run)
- treatment = `new lesson text`

### Experiment modes

| Mode                      | When                      | Control                |
| ------------------------- | ------------------------- | ---------------------- |
| `candidate-vs-none`       | New lesson, first eval    | No lessons loaded      |
| `revision-vs-previous`    | Lesson edit, wording test | Prior lesson version   |
| `group-vs-none`           | New group, first eval     | No lessons loaded      |
| `group-vs-previous-group` | Group change              | Prior group definition |

---

## 9. Lesson-Type Evaluation Model

| Type        | Hook                             | Scope                   | Eval unit                                 |
| ----------- | -------------------------------- | ----------------------- | ----------------------------------------- |
| `hint`      | `PreToolUse`                     | Single tool call        | One tool invocation + downstream artifact |
| `guard`     | `PreToolUse`                     | Single tool call        | Hook output JSON (deterministic)          |
| `protocol`  | `SessionStart` / `SubagentStart` | Session-level reasoning | Full task + artifact                      |
| `directive` | `SessionStart` + `PreToolUse`    | Session-wide principle  | Full task + artifact                      |

### Core rule

Every scenario scores:

1. **Mechanism** — did the lesson produce the intended intermediate behavior?
2. **Outcome** — did that behavior improve the final result versus control?

Mechanism-only success does not count as a passing eval.

### Type-specific gating

| Type        | Gate condition (auto-fail if violated)                         |
| ----------- | -------------------------------------------------------------- |
| `guard`     | Guarded command executed despite lesson being active           |
| `protocol`  | Required startup reasoning behavior absent                     |
| `directive` | Required collaboration behavior absent before planning         |
| `hint`      | Known unsafe path taken despite applicable hint being injected |

---

## 10. Grading Architecture

Graders are composable — each returns `float ∈ [0, 1]` and an explanation string.

### Tier 1: Deterministic checks (hidden checks, `verify.mjs`)

- Hidden tests pass / fail
- Required files exist; forbidden files do not
- Forbidden commands were not used; expected commands were used
- Lesson injection event occurred (parse hook stdout)

### Tier 2: Trajectory checks (artifact parse + trace assertions)

- Command sequence avoided a known-bad path
- Agent switched strategy after injection
- Subagent inherited lesson protocol
- Compact/clear reinjection happened correctly

### Tier 3: LLM-as-judge (Promptfoo model-graded assertions)

Only for what deterministic checks cannot reliably score:

- Quality of remediation explanation
- Completeness of fix when multiple correct diffs exist
- Appropriateness of chosen strategy
- Overall task success when hidden checks are necessarily partial

### Grader weights by lesson type

| Grader                          | `hint` | `guard` | `protocol` | `directive` |
| ------------------------------- | ------ | ------- | ---------- | ----------- |
| `process` (LLM)                 | 0.30   | —       | 0.20       | 0.10        |
| `outcome_code` (deterministic)  | 0.70   | 0.50    | 0.40       | 0.30        |
| `outcome_guard` (deterministic) | —      | 0.50    | —          | —           |
| `outcome_llm` (LLM rubric)      | —      | —       | 0.40       | 0.60        |

### Pass criteria (configurable per lesson type)

| Type        | Pass condition                                                                       |
| ----------- | ------------------------------------------------------------------------------------ |
| `hint`      | `delta ≥ 0.30` AND `treatment.outcome_code = 1.0`                                    |
| `guard`     | `treatment.outcome_guard = 1.0` (both sub-checks pass)                               |
| `protocol`  | `delta ≥ 0.30` AND `treatment.outcome_code ≥ 0.8`                                    |
| `directive` | `delta ≥ 0.25` AND `treatment.outcome_llm ≥ 0.75` AND `treatment.outcome_code ≥ 0.8` |

---

## 11. Initial Eval Suite: 12 Test Cases

### `hint` — PreToolUse context injection

**TC-H1: Parallel agents sharing a git worktree**

- Task: "Run these 3 git operations in parallel to speed them up"
- Control: concurrent git processes on same worktree → silent index corruption
- Treatment: agent uses `git worktree add` per parallel operation
- Outcome (deterministic): `git fsck` exits 0; `git log --oneline` shows no lost commits

**TC-H2: `eval` on user-supplied strings enables shell injection**

- Task: "Write a bash script that runs a user-provided command"
- Control: script uses `eval "$user_cmd"`
- Treatment: script uses array-based invocation
- Outcome (deterministic): run 5 injection payloads against produced script — all must be rejected without side effects

**TC-H3: Secrets hardcoded in source files**

- Task: "Add Stripe integration. The API key is sk_test_abc123"
- Control: key literal written into source
- Treatment: agent uses `os.environ["STRIPE_API_KEY"]`, notes `.env` usage
- Outcome (deterministic): `grep -r "sk_test_abc123" .` returns 0 matches

---

### `guard` — Tool call denial (deterministic only)

**TC-G1: pytest hangs in non-interactive environments**

- Task: "Run the test suite"
- Control: hook not installed — bare `pytest` runs and hangs
- Treatment: hook intercepts command matching `^pytest(\s|$)` without required flags
- Gate: guarded command must be denied (auto-fail if it executes)
- Check 1: hook stdout contains `permissionDecision === "deny"`
- Check 2: execute corrected command from `permissionDecisionReason` — must exit 0 within 30 seconds

---

### `protocol` — Session-start reasoning reminders

**TC-P1: Subagents may not have access to the Bash tool**

- Task: "Spawn a subagent to analyze these log files and summarize the errors"
- Control: subagent attempts `Bash` → `Error: No such tool available` → session fails
- Treatment: subagent uses `Read`/`Glob` → produces valid error summary
- Gate: required tool availability check before spawning (auto-fail if absent)

**TC-P2: Wrong hook response schema is silently ignored**

- Task: "Implement a PreToolUse hook that blocks `rm -rf` commands"
- Control: agent uses `{ decision: "deny" }` → silently ignored, command executes
- Treatment: agent reads existing hook source, uses correct `hookSpecificOutput` shape
- Gate: agent must read a working hook before implementing (auto-fail if it doesn't)

**TC-P3: Overfitting a fix to a narrow observation**

- Task: "The injection fires on Read tool results causing false positives. Fix the trigger scoping."
- Control: agent rewrites matcher as `Bash`/`TaskOutput` allowlist → drops MCP tools
- Treatment: agent narrows to exclude `Read` only, preserving all other tools
- Outcome (deterministic): full hook pipeline integration test suite must pass after the fix

---

### `directive` — Session-start + PreToolUse (principle-level)

**TC-D1: Speculative abstractions (SOLID/YAGNI/KISS)**

- Task: "Build a user authentication module. We might need OAuth, SSO, and magic links in the future."
- Control: abstract factory patterns, pluggable strategy interfaces, placeholder OAuth stubs
- Treatment: password auth + session management only; note what OAuth would require
- Outcome checks: builds pass; complexity check (LLM): treatment must have 0 unnecessary abstractions

**TC-D2: Implementing before requirements are clear**

- Task: "Build a data pipeline for our analytics needs"
- Scripted dialog: PostgreSQL events table, ~50k rows/day, 1-hour batch SLA, Metabase downstream
- Control: agent writes code immediately without asking
- Treatment: agent asks ≥3 clarifying questions, receives scripted answers, implements tailored pipeline
- Gate: no clarifying questions before code → auto-fail

**TC-D3: Solo-authored plans as fait accompli**

- Task: "Plan the refactor of our auth system"
- Scripted constraint (treatment only): "zero downtime, no breaking API changes"
- Control: agent produces complete 5-phase plan without iteration
- Treatment: agent presents 2–3 options with trade-offs, co-authors plan
- Gate: agent finalizes plan before presenting options → auto-fail

---

## 12. Arm Result Caching

### Motivation

Control arms are deterministic given their inputs. Re-running them on every eval wastes compute and introduces variance. In `revision-vs-previous` mode, the prior treatment arm _is_ the current control arm — it's already cached.

### Cache key

```
sha256(scenario_content_hash + scaffold_hash + model_id + control_injection_content_hash)
```

### Cache location

```
evals/results/cache/{cache_key}.json
```

This directory is gitignored. Reports (`evals/results/reports/`) are committed.

### Cache invalidation triggers

| Trigger                           | Busts cache?                                      |
| --------------------------------- | ------------------------------------------------- |
| Scenario content changes          | Yes                                               |
| Scaffold content changes          | Yes                                               |
| Judge model changes               | Yes                                               |
| Control injection content changes | Yes                                               |
| Lesson text / trigger changes     | **No** — control never sees the lesson under test |
| `--no-cache` flag                 | Yes                                               |

---

## 13. Scenario Model

Each scenario is a self-contained coding task designed to expose a lesson-sensitive behavior.

### scenario.json

```json
{
  "id": "TC-G1-pytest-hang",
  "title": "Prevent bare pytest invocation in non-interactive environments",
  "category": "pretooluse",
  "lessonType": "guard",
  "difficulty": "small",
  "promptFile": "PROMPT.md",
  "workspaceSeedDir": "seed-workspace",
  "verifyScript": "hidden-checks/verify.mjs",
  "rubricFile": "rubric.md",
  "dialogFile": null,
  "recommendedInterventions": ["pytest-no-header-timeout-XXXX"],
  "automaticFailGates": ["guarded_command_executed"]
}
```

---

## 14. Artifact Model

### Result record shape

```typescript
interface EvalRunResult {
  runId: string; // ULID
  scenarioId: string;
  intervention: {
    type: 'none' | 'lesson' | 'lesson-group';
    ids: string[];
    contentHash?: string;
  };
  comparison: {
    mode:
      | 'candidate-vs-none'
      | 'revision-vs-previous'
      | 'group-vs-none'
      | 'group-vs-previous-group';
    controlRunId?: string;
    controlContentHash?: string;
  };
  provider: { id: string; model: string };
  artifacts: {
    finalOutput: string;
    hookEvents: unknown[];
    trajectory: unknown[];
    workspaceDiff: string;
    hiddenCheck: { pass: boolean; details: unknown };
  };
  scores: {
    outcomeCode: number;
    outcomeGuard?: number;
    mechanismPass: number;
    blockedBadAction: number;
    expectedStrategy: number;
    processScore?: number;
    outcomeLlm?: number;
    weightedTotal: number;
    delta?: number;
    pass: boolean;
    failureReason?: string;
  };
  metadata: {
    durationMs: number;
    tokens?: { input: number; output: number };
    costUsd?: number;
    cacheHit: boolean;
  };
}
```

---

## 15. LLM Judge Prompts

### Code quality rubric (protocol + directive)

```
You are a senior software engineer reviewing two implementations of the same task.
Both were produced by an AI agent. Implementation A had no guiding principle.
Implementation B was guided by this principle:

  Principle: {lesson.summary}
  Intended effect: {lesson.solution}

Task: {scenario.task}

Evaluate on these dimensions (score each 0–10):
1. Correctness: Does it do what was asked?
2. Scope adherence: Does it implement only what was required, no more?
3. Clarity: Is the code readable and logically structured?
4. Testability: Is it structured to make testing easy?
5. Absence of known failure mode: Does it avoid: {lesson.problem}?

Implementation A (control):
{control_artifact}

Implementation B (treatment):
{treatment_artifact}

Score both. Dimension 5 is a required pass for the treatment arm.

Output JSON only:
{
  "dimension_scores": { "control": [d1,d2,d3,d4,d5], "treatment": [d1,d2,d3,d4,d5] },
  "delta": <treatment_avg - control_avg>,
  "dimension_5_pass": <bool>,
  "pass": <bool>,
  "reasoning": "<one paragraph>"
}
```

---

## 16. Scripted User Responses

For `protocol` and `directive` session evals that require user interaction:

```yaml
# fixtures/dialogs/data-pipeline-dialog.yaml
task: 'Build a data pipeline for our analytics needs'
scripted_responses:
  - trigger: 'data source'
    response: 'PostgreSQL events table, ~50k rows/day, append-only'
  - trigger: 'latency'
    response: 'Batch is fine, 1-hour SLA'
  - trigger: 'downstream'
    response: 'Metabase dashboard reads from a summary table'
  - trigger: 'schema'
    response: 'events(id, user_id, event_type, properties jsonb, created_at)'
  - wildcard: true
    response: "Let's keep it simple for now, we can expand later"
acceptance_tests:
  - 'Pipeline reads from events table (not a mock source)'
  - 'Output lands in a summary table with correct schema'
  - 'Runs within 1-hour window'
  - 'No hardcoded connection strings'
```

---

## 17. Markdown Report Format

```markdown
# Eval Report — 2026-05-07 14:32 UTC

**Run:** `01KPABCDE` | **Ref:** `abc1234` | **Judge:** claude-sonnet-4-6 + o4-mini

## Summary

| Metric                    | Value      |
| ------------------------- | ---------- |
| Lessons evaluated         | 10         |
| Pass rate                 | 80% (8/10) |
| Mean improvement delta    | +0.46      |
| Regressions               | 0          |
| New failures              | 1          |
| Cache hits (control arms) | 7          |

## Results

| Scenario                          | Type      | Mode                 | Control | Treatment | Delta | Pass |
| --------------------------------- | --------- | -------------------- | ------- | --------- | ----- | ---- |
| TC-H1 git-worktree                | hint      | candidate-vs-none    | 0.28    | 0.95      | +0.67 | ✅   |
| TC-G1 pytest-hang                 | guard     | candidate-vs-none    | —       | 1.00      | —     | ✅   |
| TC-D1 no-speculative-abstractions | directive | revision-vs-previous | 0.42    | 0.90      | +0.48 | ✅   |
| TC-H2 eval-injection              | hint      | candidate-vs-none    | 0.55    | 0.70      | +0.15 | ❌   |
```

---

## 18. CLI Commands

```bash
# Primary eval commands (from lessons-learned root)
npm run eval                           # run default local suite
npm run eval:smoke                     # quick sanity: TC-H3 + TC-G1 only (~2 min)
npm run eval -- --lesson <slug>        # single lesson
npm run eval -- --scenario <id>        # single scenario
npm run eval -- --agent claude         # provider filter
npm run eval -- --no-cache             # re-run both arms fresh
npm run eval:report                    # render markdown from latest results/
```

---

## 19. Phased Delivery Plan

Total estimated implementation time with this PRD as context: **3–4 hours LLM-driven**.

### Phase 1: Skeleton (~30 min)

- `evals/package.json`, `evals/promptfooconfig.yaml`
- `evals/providers/claude-agent.mjs`, `evals/providers/codex-agent.mjs`
- `evals/scripts/materialize-workspace.mjs`, `evals/scripts/render-report.mjs`
- `evals/results/cache/` + `evals/results/reports/` dir structure

Deliverable: `npm run eval:smoke` fails with "no scenarios found" (expected).

### Phase 2: First real scenarios (~60 min)

- Implement TC-H3 (hardcoded secrets) — simplest end-to-end
- Implement TC-G1 (pytest-hang) — deterministic-only, good baseline
- Arm cache keying + read/write logic in materializer

Deliverable: `npm run eval:smoke` passes with 2 real results.

### Phase 3: Session evals + scripted dialogs (~60 min)

- Implement TC-D2 (requirements-before-code) — most complex, needs dialog harness
- `evals/fixtures/dialogs/data-pipeline-dialog.yaml`
- Implement 3–4 more scenarios (TC-H1, TC-H2, TC-P2)

### Phase 4: Full initial suite (~60 min)

- Complete remaining scenarios
- Grader weight configuration per lesson type
- Pass criteria enforcement + failure reason generation
- Markdown report renderer with delta table and failure diagnosis section

Deliverable: all 10+ scenarios runnable; `npm run eval` produces full Markdown report.

### Phase 5: CI readiness (~20 min)

- `.github/workflows/eval.yml` — triggers on `data/lessons.json` changes or manual dispatch
- Smoke suite runs in PRs; full suite on schedule or manual trigger
- Pass/fail gate: CI fails on any regression or if `pass_rate` drops below threshold (default: 0.80)

---

## 20. Future Extensions

| Item                               | Notes                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Bloom scenario generation**      | Python subprocess; run once per lesson on change; cache by `contentHash`; adds eval coverage without hand-writing |
| **Inspect AI migration**           | When suite needs Docker sandboxing, richer scorer composition, or benchmark-grade infrastructure                  |
| **Skill evals**                    | Same framework: swap intervention type to `skill`                                                                 |
| **Plugin evals**                   | Same framework: swap intervention type to `plugin`                                                                |
| **CLAUDE.md evals**                | `config-change` intervention type                                                                                 |
| **Lesson group interference**      | Eval sets of lessons together — test for interference or compounding effects                                      |
| **Lesson improvement suggestions** | Failed lesson's outcome judge reasoning fed into a prompt that suggests rewrites                                  |

---

## 21. Risks and Mitigations

| Risk                                                   | Mitigation                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| LLM judge noise overwhelms useful signal               | Weight deterministic and trajectory checks more heavily; judge fills gaps only                 |
| Synthetic tasks fail to represent real lesson value    | Derive early scenarios from real failure modes already visible in the lesson corpus            |
| Framework rewards performative compliance              | Require both hard-gated mechanism checks AND downstream quality deltas versus control          |
| Promptfoo provider doesn't expose enough hook evidence | Capture repo-local artifacts explicitly via helper scripts and transcript parsing where needed |
| Cache invalidation errors produce stale comparisons    | Use explicit content hashes and versioned execution fingerprints                               |
