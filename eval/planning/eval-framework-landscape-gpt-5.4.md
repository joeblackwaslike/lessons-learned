# Eval Framework Landscape for `lessons-learned`

**Last updated:** 2026-04-11

---

## Purpose

This document evaluates open-source frameworks and reference implementations for a production-style eval system for `lessons-learned`.

The target scope is:

- Local-first execution
- Fully automated runs
- Structured run artifacts
- LLM-as-judge scoring
- JSON and Markdown reports
- Minimal custom infrastructure
- Future compatibility with CI

The design goal is explicitly **find, not build**: adopt an existing framework that covers at least 80% of the problem, then add a thin layer of repo-specific adapters, assertions, and reporting.

---

## What "transcript generation" means here

For this project, "transcript generation" does **not** mean speech-to-text from audio or video.

It means automatic capture of the agent run trace:

- input prompt
- lesson variant under test
- hook events
- tool calls
- final assistant response
- hidden verification output
- judge scores
- metadata such as model, cost, duration, and run IDs

This matches the repo's architecture better than any audio/video interpretation. `lessons-learned` already operates on hook contracts, session JSONL, and runtime manifests rather than media inputs.

---

## What the evals are actually testing

The eval target is not generic prompt quality. It is the effect of a **lesson type** on observed agent behavior and final task quality.

The current lesson type taxonomy is:

- `hint` — PreToolUse context injection
- `guard` — tool-call denial
- `protocol` — session-start reasoning reminder
- `directive` — session-start plus contextual reminder

Representative examples for the initial eval set:

| Type | Example behavior under test |
| ---- | --------------------------- |
| `hint` | Avoiding shared git worktrees for parallel agents; avoiding `eval "$cmd"`; not hardcoding secrets |
| `guard` | Denying bare `pytest` in non-interactive environments |
| `protocol` | Checking subagent tool availability; using the correct hook response schema; avoiding overfitted fixes |
| `directive` | Asking clarifying questions before planning; avoiding speculative abstractions; not implementing before requirements are clear |

This changes the eval design in an important way:

the framework must score **both**:

1. whether the lesson caused the required intermediate behavior
2. whether that behavior produced a better final result than control

Passing the mechanism check alone is not enough.

### Type-specific implications

- `hint`: success is not just "the hint was injected" but "the agent avoided the known bad path and produced a better working result"
- `guard`: success is not just "the command was denied" but "the agent recovered to a correct alternative path and still completed the task"
- `protocol`: success is not just "the protocol was present" but "the reasoning behavior actually changed and improved the outcome"
- `directive`: success is not just "the directive appeared" but "the directive shaped both workflow and final artifact quality"

### Hard-gated scenarios

Some scenarios should have automatic-fail gates.

Example: for a lesson whose instruction is effectively "ask clarifying questions before planning":

- if the agent does not ask questions before planning, the scenario is an automatic fail
- but asking questions alone is still insufficient
- the treatment must also lead to a better, working, higher-quality project versus control

That same pattern applies to other lessons where the intermediate behavior is the core claim of the lesson.

---

## Repo Constraints That Drive Framework Choice

These constraints are visible in the current codebase:

- The repo is Node-first and ESM-first: `package.json`, `scripts/*.mjs`, `tests/**/*.test.mjs`
- Current tests use `node:test`, subprocess runs, and fixture-driven E2E checks
- Hook integration points already exist for `SessionStart`, `PreToolUse`, and `SubagentStart`
- The hot path is deterministic and offline; evals should sit **beside** runtime hooks, not inside them
- The repo already supports multiple agent ecosystems: Claude Code, Codex, Gemini CLI, and opencode

Relevant local references:

- `hooks/hooks.json`
- `docs/reference/hooks.md`
- `docs/user-guide/how-it-works.md`
- `tests/e2e/claude-code.test.mjs`
- `tests/e2e/codex.test.mjs`

---

## Recommendation

### Primary recommendation

Use **Promptfoo** as the eval runner and assertion framework.

### Reference implementation pattern

Use **Vercel's `next-evals-oss`** as the packaging pattern for coding-task evals:

- self-contained eval directories
- hidden assertions withheld from the agent
- memoized reruns
- clean exported results

### Future heavyweight path

If the project outgrows Promptfoo, move to **Inspect AI** for a more opinionated agent-eval substrate.

---

## Why Promptfoo Fits Best

Promptfoo is the best fit for the current repo and time budget because it already covers most of the required surface area:

- local CLI runner
- JSON and HTML outputs
- CI support
- model-graded assertions
- deterministic assertions
- custom JavaScript/Python assertions
- custom providers
- side-by-side model comparison
- tracing support
- direct support for both Claude Agent SDK and OpenAI Codex SDK

This matters for `lessons-learned` because the eval target is not just a prompt. It is an **agentic workflow** with hooks, tool use, repo state, and structured outputs.

Promptfoo already gets us most of the way there without forcing a Python-first rewrite.

---

## Framework Comparison

| Framework / Project | Strengths | Weaknesses for this repo | Fit |
| ------------------- | --------- | ------------------------ | --- |
| **Promptfoo** | Local-first, CI-ready, model-graded assertions, JSON/HTML output, custom assertions/providers, Claude Agent SDK provider, Codex SDK provider | Less opinionated than a full agent benchmark framework; some agent telemetry still requires custom glue | **Best now** |
| **Vercel `next-evals-oss`** | Excellent reference architecture for task packaging, hidden checks, rerun memoization, clean result export | Not a general eval framework by itself; tailored to Next.js coding tasks | **Best reference pattern** |
| **Inspect AI** | Strongest OSS "real eval infra" option; tasks, scorers, datasets, logs, custom reducers | Python-first; heavier setup than needed for a few-hours implementation | **Best future heavyweight** |
| **Braintrust** | Strong experiment UX, diffing, dashboards, hosted comparisons, TypeScript/Python SDKs | Not local-first in the same sense; introduces a hosted platform dependency early | Good later |
| **Langfuse** | Strong observability and experiment workflows, self-hostable, open source | Better as observability/evals platform than as the first local runner | Good later |
| **DeepEval** | Rich metrics, growing agent-eval support, strong Python ecosystem | Python-first and less natural for external CLI agent harnesses in this repo | Partial fit |
| **OpenAI Evals / best practices** | Good conceptual guidance, production eval principles | Not the easiest shortest path for this repo's local multi-agent CLI use case | Reference only |
| **Anthropic eval tooling** | Useful evaluation guidance and Console features | Console-centric; fewer OSS local-runner building blocks than needed here | Reference only |

---

## Existing Projects Worth Reusing

### 1. Promptfoo

**Use for**:

- eval orchestration
- provider abstraction
- deterministic assertions
- LLM judge assertions
- result export
- future CI integration

**Why it matters here**:

- Supports both Claude Agent SDK and Codex SDK
- Can run custom logic around repo-local workspaces
- Produces machine-readable outputs without building a runner from scratch

### 2. Vercel `next-evals-oss`

**Use for**:

- eval packaging structure
- hidden-task verification pattern
- rerun memoization design
- export-and-publish workflow ideas

**Why it matters here**:

Its central idea maps almost directly to this project:

- `PROMPT.md` becomes the task under test
- hidden checks validate the workspace after the agent run
- multiple models can be evaluated on the same scenario
- results can be exported in a clean summary format

### 3. Superpowers skill tests

**Use for**:

- transcript-driven validation pattern
- real headless agent sessions
- session JSONL parsing
- verification via observed workflow rather than final text only

**Why it matters here**:

The `superpowers` tests are a strong proof that real agent sessions can be tested headlessly by parsing transcripts and checking workflow evidence, not just end text.

This is especially relevant for lesson evals because many failures are **behavioral**:

- wrong tool used
- right tool used too late
- lesson not injected
- lesson injected but ignored
- wrong subagent behavior after spawn

### 4. Inspect AI

**Use for later**:

- richer datasets
- scorer composition
- standardized experiment logs
- larger benchmark suites

### 5. Braintrust / Langfuse

**Use for later**:

- experiment history
- team dashboards
- production-facing observability
- long-lived regression analysis

---

## Projects Mentioned But Not Chosen As the Core

### Anthropic

Anthropic has useful eval guidance and Console evaluation tooling, but it does not currently offer the best local-first OSS runner for this repo's exact use case.

Useful references:

- Anthropic Console Evaluate workflow
- open evaluation repos such as `anthropics/political-neutrality-eval`

These are better used as **methodology references** than as the core framework.

### OpenAI

OpenAI's evaluation guidance is useful and should inform rubric design:

- automate as much as possible
- use deterministic checks where available
- use model graders for the residual ambiguity
- compare before/after deltas, not isolated scores only

This is valuable guidance, but not the shortest implementation path versus Promptfoo.

---

## Recommended Architecture

```text
evals/
  scenarios/
    lesson-001-block-bare-pytest/
      PROMPT.md
      scenario.json
      seed-workspace/
      hidden-checks/
        verify.mjs
      rubric.md
    lesson-002-subagent-protocol/
      ...

  providers/
    claude-agent.mjs
    codex-agent.mjs
    openai-compatible.mjs   # future z.ai / kimi / others

  scripts/
    materialize-workspace.mjs
    collect-run-artifacts.mjs
    render-report.mjs

  results/
    <run-id>.json
    <run-id>.md

promptfooconfig.yaml
```

### Core ideas

1. **Scenario folders are the unit of evaluation**

Each scenario is a self-contained coding task with:

- task prompt
- starter repo state
- lesson variant under test
- hidden checks
- optional judge rubric

2. **Baseline vs treatment is the main experiment shape**

Each scenario should run at least:

- baseline: no lesson
- treatment: current lesson text or candidate lesson/group

3. **Deterministic checks come before LLM judging**

Judge last, not first.

For lessons, the most valuable signals are often:

- whether the bad action was avoided
- whether the intended fix path was taken
- whether hidden checks passed
- whether the final diff is correct

4. **Promptfoo owns orchestration and export**

Repo scripts should only do the custom pieces Promptfoo cannot know:

- temp workspace setup
- lesson variant materialization
- hook/session artifact collection
- Markdown synthesis for this repo's preferred reporting format

### Comparison protocol

Lesson evaluation should use a chained control model rather than rerunning every comparison from scratch.

For a brand-new lesson:

1. compare `candidate` versus `no lessons`
2. cache both results

For an edited lesson:

1. compare `new lesson text` versus `previous lesson text`
2. reuse the cached baseline for the previous text when nothing else relevant changed

This means the framework should not treat every run as a fresh A/B pair. It should understand that lesson evolution is incremental:

- first comparison establishes whether the lesson beats no intervention
- later comparisons establish whether the revised lesson beats the last accepted text

### Required caching behavior

To avoid duplicate work, result caching should key runs by the full execution fingerprint:

- scenario ID
- lesson type
- intervention type
- intervention content hash or lesson text hash
- provider/model
- workspace seed version
- hidden-check version
- relevant eval config version

If that fingerprint matches a prior completed run, the framework should reuse the stored result rather than rerunning the agent.

---

## Proposed Eval Taxonomy

### A. Session-start evals

Questions answered:

- Does a session-start lesson improve planning before the first tool call?
- Does it reduce avoidable exploratory churn?

### B. PreToolUse evals

Questions answered:

- Does a lesson prevent a known-bad command?
- Does it redirect the agent to the correct remediation path?
- Does it improve completion rate or reduce retries?

This should be the first and largest category because it matches the repo's highest-value runtime behavior.

### C. SubagentStart evals

Questions answered:

- Does the lesson protocol propagate to subagents?
- Do subagents avoid mistakes that the parent already learned?

### D. Compact/Clear evals

Questions answered:

- After compaction or clear, are high-priority lessons re-injected correctly?
- Does dedup state behave as intended?

### E. Future skill/plugin evals

Questions answered:

- Does a skill improve execution quality for the scenarios it claims to help with?
- Does a plugin meaningfully alter observed tool behavior?

This is a natural extension of the same framework if scenarios, assertions, and reports are kept generic.

---

## Scoring Model

Use a hybrid scoring stack:

### Tier 1: deterministic checks

- hidden test passes
- required file edits exist
- forbidden file edits do not exist
- forbidden commands did not run
- required command family did run
- lesson injection evidence present
- subagent/tool sequence constraints satisfied

### Tier 2: transcript and trajectory checks

- hook event occurred
- correct lesson slug or group was injected
- blocked command was avoided after injection
- tool path is shorter or cleaner than baseline
- required intermediate behavior happened for the lesson type

### Type-specific gating examples

- `guard`: guarded command attempted and denied; agent then pivots to the safe path
- `protocol`: required reasoning behavior appears before execution begins
- `directive`: required collaboration behavior happens before planning or implementation
- `hint`: unsafe matched action is avoided when the hint is present

### Tier 3: LLM-as-judge

Use model-graded assertions only for what deterministic checks cannot reliably score:

- quality of explanation
- appropriateness of chosen remediation
- completeness when multiple correct diffs exist
- overall task success when hidden checks are necessarily partial

### Output shape

Each row should produce normalized scores such as:

- `task_success`
- `blocked_bad_action`
- `followed_expected_strategy`
- `satisfied_required_intermediate_behavior`
- `diff_quality`
- `explanation_quality`
- `overall_score`

---

## Why This Is Better Than Building a Runner From Scratch

Building a custom runner would require solving:

- model/provider abstraction
- result schema design
- caching
- concurrent execution
- reporting
- CI interface
- judge orchestration
- baseline/treatment comparison plumbing

Those are commodity problems. They are exactly where "find, not build" should apply.

The custom code should stay focused on what is unique to `lessons-learned`:

- lesson variants
- hook-aware artifact capture
- scenario taxonomy
- repo-specific hidden checks
- Markdown report rendering

---

## Minimal Viable Implementation

This is the version that should be possible in a few hours with an LLM:

### Phase 1

- Add `evals/` as an isolated subproject
- Add Promptfoo config
- Add one Claude provider
- Add one Codex provider
- Add one small materializer script
- Add one report renderer

### Phase 2

Create 6-10 scenarios total:

- 3 `PreToolUse` scenarios
- 2 `SessionStart` scenarios
- 2 `SubagentStart` scenarios
- 1 `compact` reinjection scenario

### Phase 3

Support three experiment modes:

- `baseline`
- `candidate-vs-none`
- `revision-vs-previous`

### Phase 4

Generate:

- raw JSON results
- concise Markdown summary
- baseline-vs-treatment delta table
- cache-aware reuse of previously completed runs

### Phase 5

Add a single CI-friendly command later, after the local UX is solid.

---

## Initial CLI Shape

Suggested commands:

```bash
npm run eval                    # run default local suite
npm run eval:smoke              # quick sanity suite
npm run eval -- --agent claude  # provider filter
npm run eval -- --agent codex
npm run eval -- --lesson <slug>
npm run eval -- --scenario <id>
npm run eval:report -- --input evals/results/<run-id>.json
```

The initial UX should favor local iteration, not CI ceremony.

---

## Future Provider Expansion

You said hosted providers are acceptable, including:

- Anthropic
- OpenAI
- z.ai
- Kimi K2

This suggests a useful design constraint:

- keep the scenario schema provider-agnostic
- keep scoring schema provider-agnostic
- isolate provider-specific execution under `evals/providers/`

Promptfoo can already cover the first two providers well. The others can be added later via OpenAI-compatible or custom provider wrappers.

---

## Risks

### 1. Overreliance on LLM judge scores

If the judge becomes the main signal, the suite will drift toward subjective scores and become noisy.

**Mitigation**: deterministic checks first, judge last.

### 2. Framework mismatch with real hook behavior

If provider execution paths diverge too far from real local hook setups, the eval results will look cleaner than reality.

**Mitigation**: reuse real repo hooks and capture hook evidence as artifacts.

### 3. Eval scenarios become too synthetic

If tasks are toy problems, the suite will not validate whether lessons help on realistic coding work.

**Mitigation**: base scenarios on real failure modes already visible in your lesson corpus and session logs.

### 4. Too much custom glue

If the adaptation layer grows too large, the project loses the benefit of using a framework.

**Mitigation**: keep repo glue narrow and prefer Promptfoo-native assertions where possible.

---

## Final Recommendation

Adopt:

- **Promptfoo** as the runner
- **Vercel `next-evals-oss`** as the packaging pattern
- **Superpowers transcript-testing style** as a behavior-verification reference

Defer:

- **Inspect AI** until the suite needs a heavier benchmark substrate
- **Braintrust/Langfuse** until there is a real need for hosted experiment history and team dashboards

This path is the best balance of:

- low build cost
- local-first workflow
- production-style eval shape
- future CI compatibility
- future skill/plugin expansion

---

## Sources

- Promptfoo intro: <https://www.promptfoo.dev/docs/intro/>
- Promptfoo Claude Agent SDK provider: <https://www.promptfoo.dev/docs/providers/claude-agent-sdk/>
- Promptfoo Codex SDK provider: <https://www.promptfoo.dev/docs/providers/openai-codex-sdk/>
- Promptfoo output formats: <https://www.promptfoo.dev/docs/configuration/outputs/>
- Promptfoo CI/CD integration: <https://www.promptfoo.dev/docs/integrations/ci-cd/>
- Vercel `next-evals-oss`: <https://github.com/vercel/next-evals-oss>
- Inspect AI: <https://github.com/UKGovernmentBEIS/inspect_ai>
- Inspect AI scorers: <https://inspect.aisi.org.uk/scorers.html>
- Braintrust evaluation quickstart: <https://www.braintrust.dev/docs/evaluation>
- Langfuse docs overview: <https://langfuse.com/docs>
- Anthropic evaluate tool: <https://docs.anthropic.com/en/docs/test-and-evaluate/eval-tool>
- Anthropic political neutrality eval: <https://github.com/anthropics/political-neutrality-eval>
- OpenAI evaluation best practices: <https://platform.openai.com/docs/guides/evaluation-best-practices>
