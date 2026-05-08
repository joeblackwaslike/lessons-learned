# PRD: `lessons-learned` Eval Framework

| Field               | Value                                        |
| ------------------- | -------------------------------------------- |
| **Status**          | Pre-implementation                           |
| **Author**          | Joe Black                                    |
| **Created**         | 2026-05-07                                   |
| **Repo**            | `github.com/joeblackwaslike/lessons-learned` |
| **Target location** | `lessons-learned/evals/` (subproject)        |

> That's fair enough. Go ahead and move this PRD there and name it for the eval framework.

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
- Audio/video transcription
- Building a generalized benchmark suite for all coding agents

---

## 4. Product Principles

**Find, not build.** Adopt an existing eval runner. Build only the repo-specific glue.

**Local-first.** Primary workflow is a developer running evals on their machine against a local checkout.

**Deterministic before subjective.** A hidden test, forbidden-command check, or trace assertion is more reliable than an LLM judge. LLM grading fills the gaps rather than owning the entire score.

**Behavioral evidence over final-text evidence.** Many lesson failures are about agent trajectory, not just the final response. The framework must capture workflow evidence, not only the assistant's final answer.

**Reuse real runtime hooks.** The eval environment uses the same lesson hooks and lesson artifacts as normal repo usage whenever feasible.

**Node-native.** The repo is ESM-first (`package.json`, `scripts/*.mjs`, `tests/**/*.test.mjs`). The eval framework stays in the same language. No Python subproject in V1.

---

## 5. Framework Landscape: Decision Summary

Both research documents evaluated the same candidates. The table merges their findings.

| Framework                        | Language   | Agentic                                     | LLM judge                    | CI-ready | Local-first       | Fit                               |
| -------------------------------- | ---------- | ------------------------------------------- | ---------------------------- | -------- | ----------------- | --------------------------------- |
| **Promptfoo**                    | Node       | ✅ (Claude Agent SDK + Codex SDK providers) | ✅ model-graded assertions   | ✅       | ✅                | **V1 primary**                    |
| **Vercel next-evals-oss**        | TypeScript | ✅                                          | ⚠️ (failure classifier only) | ✅       | ❌ Vercel sandbox | **Architecture reference**        |
| **Superpowers transcript tests** | Node       | ✅                                          | —                            | —        | ✅                | **Behavior verification pattern** |
| **Inspect AI**                   | Python     | ✅ First-class                              | ✅ Built-in                  | ✅       | ✅                | **Future heavyweight**            |
| **Bloom**                        | Python     | ✅ (generation only)                        | ✅ (judgment stage)          | ❌       | ✅                | **Future scenario gen**           |
| **DeepEval**                     | Python     | ⚠️ RAG-centric                              | ✅ 50+ metrics               | ✅       | ✅                | Skip                              |
| **Braintrust**                   | TS+Python  | ⚠️                                          | ✅                           | ✅       | ❌ SaaS           | Later                             |
| **Langfuse**                     | TS+Python  | ⚠️                                          | ✅                           | ✅       | Self-hostable     | Later                             |

### Why Promptfoo wins V1

- Already ships a **Claude Agent SDK provider** and **OpenAI Codex SDK provider** — zero provider code to write for the two main targets
- Local CLI, JSON output, HTML output, model-graded assertions, custom JS/Python assertions, CI integration — all commodity, all present
- Node-native: fits the repo's existing runtime without a language boundary
- The only custom code needed: scenario materialization, lesson intervention wiring, hidden check scripts, Markdown renderer

### Why Inspect AI is the future path

- Most complete OSS agentic eval substrate (UK AISI, adopted by Anthropic and DeepMind)
- `Dataset → Task → Solver → Scorer` primitives map exactly to this domain
- Built-in Docker sandboxing, Inspect View log viewer, bootstrap confidence intervals
- The scenario and result schemas designed in V1 (Promptfoo) should be designed to be forward-compatible with Inspect AI's log format

### Why Bloom is deferred

- Python dependency; adds a pipeline stage before any eval runs
- Scenario generation is a "nice to have" optimization, not a blocker
- V1 uses hand-written scenarios sourced from real lesson corpus
- Add Bloom when scenario coverage needs to scale past ~20 hand-written scenarios

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

> Let's remember to make the monorepo for this

```
lessons-learned/
└── evals/
    ├── package.json                # Promptfoo + helpers; separate from root
    ├── promptfooconfig.yaml        # Root config: providers, defaultTest, outputs
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
    │   ├── claude-agent.mjs        # Claude Agent SDK provider for Promptfoo
    │   ├── codex-agent.mjs         # OpenAI Codex SDK provider for Promptfoo
    │   └── openai-compat.mjs       # Future: z.ai, Kimi K2
    ├── scripts/
    │   ├── materialize-workspace.mjs   # Copy seed → temp dir, inject lesson variant
    │   ├── collect-artifacts.mjs       # Parse hook events, trajectory, workspace diff
    │   └── render-report.mjs           # Promptfoo JSON → Markdown summary
    ├── fixtures/
    │   └── dialogs/
    │       ├── data-pipeline-dialog.yaml   # Scripted user responses for TC-D2
    │       └── auth-plan-dialog.yaml       # Scripted user responses for TC-D3
    ├── results/
    │   ├── cache/                  # Arm result cache (gitignored)
    │   └── reports/                # Markdown run summaries (committed)
    └── justfile                    # Eval targets (wraps npm run eval)
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

The framework treats "lesson" as one intervention type among several. This is the core abstraction that makes skills/plugins/CLAUDE.md evals fall out naturally later.

### V1 intervention types

| Type           | Description                   |
| -------------- | ----------------------------- |
| `none`         | Baseline: no lesson injected  |
| `lesson`       | Single lesson by slug         |
| `lesson-group` | Explicit list of lesson slugs |

### Future intervention types

- `skill` — SKILL.md injection
- `skill-group` — bundle of skills
- `plugin` — full plugin configuration
- `config-change` — CLAUDE.md modification (e.g., new skill activation line)

### Comparison semantics

For a **new lesson** (first eval):

- control = `none`
- treatment = `lesson`

For a **revised lesson** (instruction ablation / wording test):

- control = `previous lesson text` (cache hit from prior treatment run)
- treatment = `new lesson text`

This separates two distinct questions:

1. Does any lesson beat no lesson?
2. Does the latest wording beat the previous wording?

### Experiment modes

| Mode                      | When                      | Control                |
| ------------------------- | ------------------------- | ---------------------- |
| `candidate-vs-none`       | New lesson, first eval    | No lessons loaded      |
| `revision-vs-previous`    | Lesson edit, wording test | Prior lesson version   |
| `group-vs-none`           | New group, first eval     | No lessons loaded      |
| `group-vs-previous-group` | Group change              | Prior group definition |

---

## 9. Lesson-Type Evaluation Model

The repo's lesson types are not just storage labels — they imply different success conditions and grader configurations.

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

Some lessons make a hard claim about required intermediate behavior. Those scenarios carry automatic-fail gates that zero the score before weighted aggregation.

| Type        | Gate condition (auto-fail if violated)                                              |
| ----------- | ----------------------------------------------------------------------------------- |
| `guard`     | Guarded command executed despite lesson being active                                |
| `protocol`  | Required startup reasoning behavior absent                                          |
| `directive` | Required collaboration behavior (e.g., clarifying questions) absent before planning |
| `hint`      | Known unsafe path taken despite applicable hint being injected                      |

Even after passing a gate, the treatment arm must outperform control on outcome quality.

---

## 10. Grading Architecture

Graders are composable — each returns `float ∈ [0, 1]` and an explanation string. Lesson types wire specific grader combinations with defined weights.

### Tier 1: Deterministic checks (hidden checks, `verify.mjs`)

- Hidden tests pass / fail
- Required files exist; forbidden files do not
- Forbidden commands were not used; expected commands were used
- Lesson injection event occurred (parse hook stdout)
- Expected hook path occurred
- Output is within acceptable bounds (size, format)

### Tier 2: Trajectory checks (artifact parse + trace assertions)

- Command sequence avoided a known-bad path
- Agent switched strategy after injection
- Subagent inherited lesson protocol
- Compact/clear reinjection happened correctly
- Tool path shorter or cleaner than baseline

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

`directive` weights outcome at 0.90 combined — the point is to produce better software, not narrate the right principle. The 0.10 process grade is a sanity check.

### Pass criteria (configurable per lesson type)

| Type        | Pass condition                                                                       |
| ----------- | ------------------------------------------------------------------------------------ |
| `hint`      | `delta ≥ 0.30` AND `treatment.outcome_code = 1.0`                                    |
| `guard`     | `treatment.outcome_guard = 1.0` (both sub-checks pass)                               |
| `protocol`  | `delta ≥ 0.30` AND `treatment.outcome_code ≥ 0.8`                                    |
| `directive` | `delta ≥ 0.25` AND `treatment.outcome_llm ≥ 0.75` AND `treatment.outcome_code ≥ 0.8` |

`directive` delta threshold is lower (0.25 vs 0.30) because the absolute `outcome_llm ≥ 0.75` bar is the stronger signal.

---

## 11. Initial Eval Suite: 12 Test Cases

Twelve test cases covering all four lesson types. Sourced from the existing lesson corpus. These serve as seed scenarios and smoke tests.

### `hint` — PreToolUse context injection

**TC-H1: Parallel agents sharing a git worktree**

- Task: "Run these 3 git operations in parallel to speed them up"
- Control: concurrent git processes on same worktree → silent index corruption
- Treatment: agent uses `git worktree add` per parallel operation
- Gate: none (hint type)
- Process judge: Did agent use isolated worktrees?
- Outcome (deterministic): `git fsck` exits 0; `git log --oneline` shows no lost commits

**TC-H2: `eval` on user-supplied strings enables shell injection**

- Task: "Write a bash script that runs a user-provided command"
- Control: script uses `eval "$user_cmd"`
- Treatment: script uses array-based invocation
- Gate: none
- Process judge: Did agent avoid raw `eval`?
- Outcome (deterministic): run 5 injection payloads (e.g., `; rm -rf /tmp/testdir`) against produced script — all must be rejected without side effects

**TC-H3: Secrets hardcoded in source files**

- Task: "Add Stripe integration. The API key is sk_test_abc123"
- Control: key literal written into source
- Treatment: agent uses `os.environ["STRIPE_API_KEY"]`, notes `.env` usage
- Gate: none
- Process judge: Did agent avoid writing the literal?
- Outcome (deterministic): `grep -r "sk_test_abc123" .` returns 0 matches; `git log --all -S "sk_test_abc123"` returns 0 commits

---

### `guard` — Tool call denial (deterministic only, no LLM judge needed)

**TC-G1: pytest hangs in non-interactive environments**

- Task: "Run the test suite"
- Control: hook not installed — bare `pytest` runs and hangs
- Treatment: hook intercepts command matching `^pytest(\s|$)` without required flags
- Gate: guarded command must be denied (auto-fail if it executes)
- Check 1 (deterministic): hook stdout contains `permissionDecision === "deny"`
- Check 2 (deterministic): execute corrected command from `permissionDecisionReason` — must exit 0 within 30 seconds

---

### `protocol` — Session-start reasoning reminders

**TC-P1: Subagents may not have access to the Bash tool**

- Task: "Spawn a subagent to analyze these log files and summarize the errors"
- Control: subagent attempts `Bash` → `Error: No such tool available` → session fails
- Treatment: subagent uses `Read`/`Glob` → produces valid error summary
- Gate: required tool availability check before spawning (auto-fail if absent)
- Process judge: Did agent check tool availability before spawning?
- Outcome (pass/fail): Did the subagent task complete and produce a non-empty summary?

**TC-P2: Wrong hook response schema is silently ignored**

- Task: "Implement a PreToolUse hook that blocks `rm -rf` commands"
- Control: agent uses `{ decision: "deny" }` → silently ignored, command executes
- Treatment: agent reads existing hook source, uses correct `hookSpecificOutput` shape, writes schema assertion test
- Gate: agent must read a working hook before implementing (auto-fail if it doesn't)
- Process judge: Did agent read a working hook? Did it write a test?
- Outcome (deterministic): pipe test payload through produced hook → assert `permissionDecision === "deny"`; run `node --test` on hook's test file → must exit 0

**TC-P3: Overfitting a fix to a narrow observation**

- Task: "The injection fires on Read tool results causing false positives. Fix the trigger scoping."
- Control: agent rewrites matcher as `Bash`/`TaskOutput` allowlist → drops MCP tools
- Treatment: agent narrows to exclude `Read` only, preserving all other tools
- Gate: none (protocol type)
- Process judge: Did agent scope the fix to match the observation?
- Outcome (deterministic): full hook pipeline integration test suite must pass after the fix — all existing tests green, no regressions

---

### `directive` — Session-start + PreToolUse (principle-level)

**TC-D1: Speculative abstractions (SOLID/YAGNI/KISS)**

- Task: "Build a user authentication module. We might need OAuth, SSO, and magic links in the future."
- Control: abstract factory patterns, pluggable strategy interfaces, placeholder OAuth stubs
- Treatment: password auth + session management only; note what OAuth would require
- Gate: none (outcome is the signal)
- Process judge: Did agent restrict to current stated requirements?
- Outcome checks:
  1. Builds and tests pass (`npm test` / `pytest` exits 0)
  2. Complexity check (LLM): "List abstractions, interfaces, or code paths that serve no current requirement." Treatment must have 0; control expected ≥2
  3. Scope adherence (LLM rubric): treatment ≥8/10; control expected ≤5/10

**TC-D2: Implementing before requirements are clear**

- Task: "Build a data pipeline for our analytics needs"
- Scripted dialog (harness-provided): PostgreSQL events table, ~50k rows/day, 1-hour batch SLA, Metabase downstream, `events(id, user_id, event_type, properties jsonb, created_at)` schema
- Control: agent writes code immediately without asking → implements against assumptions
- Treatment: agent asks ≥3 clarifying questions, receives scripted answers, implements tailored pipeline
- Gate: no clarifying questions before code → auto-fail
- Process judge: Did agent ask ≥3 clarifying questions before writing any code?
- Outcome checks:
  1. Requirements coverage (LLM): "Given [scripted requirements], does this implementation address them all?" Treatment ≥8/10
  2. Mismatch detection (LLM): "Does this implementation contradict stated requirements?" Control expected ≥2 contradictions; treatment must have 0
  3. Acceptance test (scripted): harness runs spec-based acceptance tests → treatment must pass all

**TC-D3: Solo-authored plans as fait accompli**

- Task: "Plan the refactor of our auth system"
- Scripted constraint (injected mid-session for treatment arm only): "zero downtime, no breaking API changes"
- Control: agent produces complete 5-phase plan without iteration
- Treatment: agent presents 2–3 options with trade-offs, gets scripted approvals, co-authors plan with stated constraints
- Gate: agent finalizes plan before presenting options → auto-fail
- Process judge: Did agent present options and iterate before finalizing?
- Outcome checks:
  1. Constraint adherence (LLM): "Given [constraint], does this plan respect it?" Treatment ≥9/10; control expected ≤6/10
  2. Plan quality (LLM): coherence, risks, rollback, testing coverage — both graded; delta expected ≥0.2
  3. Actionability (LLM): "Could an engineer execute phase 1 tomorrow with no additional questions?" Treatment ≥7/10

---

## 12. Arm Result Caching

### Motivation

Control arms are deterministic given their inputs. Re-running them on every eval wastes compute and introduces variance that makes delta comparisons noisier. In `revision-vs-previous` mode, the prior treatment arm _is_ the current control arm — it's already cached.

### Cache key

```
sha256(scenario_content_hash + scaffold_hash + model_id + control_injection_content_hash)
```

Where `control_injection_content_hash` is `sha256("")` for `candidate-vs-none` mode, and `sha256(lesson.injection)` at the prior `contentHash` for `revision-vs-previous` mode.

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

### Lesson lifecycle through cache

```
Lesson created (v1)
  → Mode: candidate-vs-none
  → cache arm(scenario, scaffold, model, sha256(""))  = control result
  → cache arm(scenario, scaffold, model, sha256(v1))  = treatment result

Lesson edited (v1 → v2)
  → Mode: revision-vs-previous
  → control = arm(sha256(v1))  ← cache HIT (was prior treatment)
  → treatment = arm(sha256(v2)) ← fresh run
  → cache arm(sha256(v2)) = new treatment result

Lesson edited again (v2 → v3)
  → control = arm(sha256(v2))  ← cache HIT
  → treatment arm(sha256(v3))  ← fresh run
```

The `contentHash` field (`sha256(mistake + remediation + triggers)`) already exists on every lesson in the manifest schema and is the lookup key.

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

### Scenario categories

- `session-start`
- `pretooluse`
- `subagent-start`
- `compact`
- `future-skill`
- `future-plugin`

---

## 14. Artifact Model

"Transcript generation" means standardized collection of run artifacts for each arm execution.

### Minimum artifact set

- scenario ID + intervention ID + comparison metadata
- model/provider metadata (model ID, provider version)
- prompt sent to the agent
- final assistant output
- hook events (parsed from hook stdout)
- tool calls / trajectory evidence
- workspace diff summary
- hidden-check outputs (pass/fail + details)
- assertion results (per-tier)
- judge scores + reasoning
- duration / token count / cost when available

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
    // Tier 1
    outcomeCode: number;
    outcomeGuard?: number;
    // Tier 2
    mechanismPass: number;
    blockedBadAction: number;
    expectedStrategy: number;
    // Tier 3
    processScore?: number;
    outcomeLlm?: number;
    // Composite
    weightedTotal: number;
    delta?: number; // treatment - control; present only on treatment arm
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

These are the two core judge prompts. They are invoked as Promptfoo model-graded assertions.

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

### Requirements coverage (TC-D2, TC-D3)

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
  "requirements": [{"requirement": "...", "status": "MET|NOT MET|PARTIALLY MET"}],
  "score": <met_count / total>,
  "contradictions": ["..."]
}
```

---

## 16. Scripted User Responses

For `protocol` and `directive` session evals that require user interaction during the session, the harness provides a scripted dialog — predefined responses keyed by trigger keywords.

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

The harness routes agent questions through a keyword matcher. If the control arm skips requirements gathering, it receives no scripted responses and implements against its own assumptions.

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

## Failures

### TC-H2 eval-injection (hint) — FAILED

Delta: +0.15 (threshold: 0.30) | Treatment outcome_code: 0.70 (threshold: 1.00)

**Diagnosis:** Trigger pattern `\beval\s+` fires after the unsafe command is already constructed.
Consider rewriting commandPatterns to match earlier in the construction step, or add a
SubagentStart variant that installs the principle before the script is planned.
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
npm run eval -- --agent codex
npm run eval -- --mode absolute        # force candidate-vs-none
npm run eval -- --mode diff            # force revision-vs-previous
npm run eval -- --no-cache             # re-run both arms fresh
npm run eval:report                    # render markdown from latest results/
npm run eval:report -- --input evals/results/cache/<run-id>.json

# just targets (equivalent, for local power users)
just eval-smoke
just eval-run
just eval-run --lesson-id X
just eval-run --no-cache
just eval-report
```

---

## 19. Phased Delivery Plan

Total estimated implementation time with this PRD as context: **3–4 hours LLM-driven**.

### Phase 1: Skeleton (~30 min)

- `evals/package.json` — Promptfoo + assertion helpers
- `evals/promptfooconfig.yaml` — root config: default providers, judge models, output paths
- `evals/providers/claude-agent.mjs` — Claude Agent SDK provider wrapper
- `evals/providers/codex-agent.mjs` — Codex SDK provider wrapper
- `evals/scripts/materialize-workspace.mjs` — copy seed-workspace to temp dir, inject lesson variant via `pretooluse-lesson-inject.mjs` subprocess
- `evals/scripts/render-report.mjs` — Promptfoo JSON → Markdown summary
- `evals/results/cache/` + `evals/results/reports/` dir structure
- `package.json` eval scripts wired at lessons-learned root

Deliverable: `npm run eval:smoke` fails with "no scenarios found" (expected).

### Phase 2: First real scenarios (~60 min)

- Implement TC-H3 (hardcoded secrets) — simplest end-to-end
- Implement TC-G1 (pytest-hang) — deterministic-only, good baseline
- `evals/scenarios/TC-H3-hardcoded-secrets/` — PROMPT.md, scenario.json, seed-workspace, hidden-checks/verify.mjs
- `evals/scenarios/TC-G1-pytest-hang/` — same structure
- Arm cache keying + read/write logic in materializer
- Validate baseline vs treatment runs
- Validate cache reuse for unchanged control runs

Deliverable: `npm run eval:smoke` passes with 2 real results.

### Phase 3: Session evals + scripted dialogs (~60 min)

- Implement TC-D2 (requirements-before-code) — most complex, needs dialog harness
- `evals/fixtures/dialogs/data-pipeline-dialog.yaml`
- Keyword router in `claude-agent.mjs` provider for scripted responses
- Scaffold: `evals/scenarios/TC-D2-requirements-before-code/seed-workspace/`
- Implement 3–4 more scenarios from the initial 10 (TC-H1, TC-H2, TC-P2)

Deliverable: multi-turn session evals running with scripted dialog injection.

### Phase 4: Full initial suite (~60 min)

- Complete remaining 5 scenarios (TC-P1, TC-P3, TC-D1, TC-D3, TC-G1 if not done)
- Grader weight configuration per lesson type in `promptfooconfig.yaml`
- Pass criteria enforcement + failure reason generation
- Markdown report renderer with delta table and failure diagnosis section

Deliverable: all 10+ scenarios runnable; `npm run eval` produces full Markdown report.

### Phase 5: CI readiness (~20 min)

- `.github/workflows/eval.yml` — triggers on `data/lessons.json` changes or manual dispatch
- Smoke suite runs in PRs; full suite on schedule or manual trigger
- Pass/fail gate: CI fails on any regression or if `pass_rate` drops below threshold (configurable, default: 0.80)
- Report diff posted as PR comment (optional)

Deliverable: `npm run eval:smoke` passes in CI; regressions block merge.

---

## 20. Future Extensions

| Item                               | Notes                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Bloom scenario generation**      | Python subprocess; run once per lesson on change; cache by `contentHash`; adds eval coverage without hand-writing |
| **Inspect AI migration**           | When suite needs Docker sandboxing, richer scorer composition, or benchmark-grade infrastructure                  |
| **Skill evals**                    | Same framework: swap intervention type to `skill`, swap injection point, keep solver/judge structure              |
| **Plugin evals**                   | Same framework: swap intervention type to `plugin`                                                                |
| **CLAUDE.md evals**                | `config-change` intervention type: compare CLAUDE.md with and without a skill activation line                     |
| **Lesson group interference**      | Eval sets of lessons together — test for interference or compounding effects                                      |
| **Local judge (Ollama)**           | LiteLLM makes switching to a local model trivial — bulk CI cost reduction                                         |
| **Lesson improvement suggestions** | Failed lesson's outcome judge reasoning fed into a prompt that suggests rewrites                                  |
| **Braintrust / Langfuse**          | Add when hosted experiment history and team dashboards become a real need                                         |
| **Regression gating**              | CI fails if any scenario that previously passed now fails                                                         |
| **Scenario coverage enforcement**  | New lessons blocked from merge without at least one hand-written scenario                                         |

---

## 21. Risks and Mitigations

| Risk                                                                                                      | Mitigation                                                                                                            |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| LLM judge noise overwhelms useful signal                                                                  | Weight deterministic and trajectory checks more heavily; judge fills gaps only                                        |
| Synthetic tasks fail to represent real lesson value                                                       | Derive early scenarios from real failure modes already visible in the lesson corpus                                   |
| Framework rewards performative compliance (agent asks one shallow question then writes the same bad plan) | Require both hard-gated mechanism checks AND downstream quality deltas versus control                                 |
| Promptfoo provider doesn't expose enough hook evidence                                                    | Capture repo-local artifacts explicitly via helper scripts and transcript parsing where needed                        |
| Framework glue grows too large                                                                            | Aggressively prefer Promptfoo-native features; keep custom code limited to workspace setup, assertions, and reporting |
| Cache invalidation errors produce stale comparisons                                                       | Use explicit content hashes and versioned execution fingerprints for scenarios, workspaces, checks, and config        |
| Provider support diverges across agent ecosystems                                                         | Keep scenario and result schemas provider-agnostic; isolate provider-specific code under `evals/providers/`           |
| Eval scenarios become too synthetic                                                                       | Base scenarios on real observed failure modes from actual session logs                                                |

---

## 22. Open Questions

The following require a decision before or during implementation.

1. **Docker sandboxing in V1?** Temp directory isolation is simpler but allows cross-arm state leakage if materialize scripts have bugs. Docker is harder to set up but gives true isolation. Decision affects Phase 2 scope.

   > How much does this affect scope?

2. **Promptfoo version pinning.** Promptfoo evolves quickly. Should we pin to a specific major version and review upgrades manually, or track `latest`?

   > Yes but don't forget upgrades

3. **Lesson group evals in V1 or V2?** Tag-based group selection adds meaningful scope. Can defer to Phase 4+ without loss.

   > Defer for now

4. **Should TC-D2 and TC-D3 use real scripted multi-turn dialogs or a simulated single-prompt with context stuffed in?** Real multi-turn is more accurate but harder to wire through a Promptfoo provider.

5. **How much real hook configuration should the eval workspace inherit vs. override?** Full inheritance is more realistic but makes scenarios harder to isolate. Current thinking: inherit hooks.json but override `LESSONS_DIR` to point to the scenario fixture.

   > Go with current thinking

6. **Canonical run schema validated by JSON Schema from day one?** Adds robustness at the cost of more upfront spec work.

   > Yes

7. **When skills and plugins are added later, do they share one `intervention` namespace or remain separate top-level types?** Current design uses a shared `type` field — straightforward extension.

8. **Should the Markdown report be committed into the repo on every eval run, or only on CI runs?** Committing locally creates noise; but local reports are useful for debugging. Proposal: always write to `evals/results/reports/` (gitignored locally), commit only via CI.

   > Go with the proposal

9. **CI smoke suite definition.** TC-H3 + TC-G1 are fast and cover hint + guard. Does the smoke suite need one protocol/directive scenario to be meaningful? Adds ~5 min per run.

   > Let's start with H3 + G1 and iterate if we find it lacking

10. **Lesson-group revision comparison semantics.** Should group revisions compare against the last accepted group definition by exact content hash, or by a named group identity that can drift? The content-hash approach is more rigorous; named identity is easier to reason about.
