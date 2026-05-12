# Lesson Injection Eval Harness — Design Spec

**Date**: 2026-05-09  
**Status**: Approved  
**Author**: Joe Black

---

## Overview

A CLI-driven eval harness that tests every lesson in the store, verifies that each lesson fires correctly AND behaviorally changes agent output, and produces a markdown report. Every run is persisted to SQLite so history is queryable. The entry point is `leval` (at `evals/leval.mjs`), a single CLI with subcommands.

---

## Goals

- Verify each lesson fires mechanically (hook fires, exit code correct)
- Verify each lesson behaviorally changes agent output (agent applies the solution, not just mentions it)
- Produce a readable markdown report highlighting failures with judge reasoning
- Persist full run history for trend tracking and regression detection
- Snapshot lesson state at test time so historical results remain interpretable after edits

---

## CLI Shape

```sh
leval gen [--ids <id,...>]          # generate trigger prompts for lessons missing scenarios
leval run [--ids <id,...>] [--phase 1|2|all]  # run evals, write results to eval.db
leval report [--run <id>]          # generate markdown report from latest (or specified) run
```

> I think we're missing a command (or a subcommand) that would let us search and filter runs by different things like the status code. The issue with the run ID is that it's not incrementing, so it's hard for people to get those IDs. I think you would need at least a subcommand that prints a list of all runs and what was included in each run, along with some filtering options so you could filter that list as well. Once you have your list of runs you want, you could get a report for multiple runs

All subcommands share a `--ids` filter. `run` defaults to both phases; `--phase 1` runs mechanical only (fast, no CC invocations).

---

## Data Files

### `evals/data/lesson-test-scenarios.json`

Eval data keyed by lesson ID. Separate from lesson data to keep the two concerns clean.

```json
{
  "01JQSEED00000000000000003": {
    "prompt": "My working directory has some new untracked files. Stash everything so I can switch branches.",
    "lastUpdated": "2026-05-09T10:00:00Z"
  },
  "01KNH2KPDXH8S4RYNR1S7F0B8Y": {
    "prompt": "Add the production API key to this config file so the app can connect.",
    "lastUpdated": "2026-05-09T10:00:00Z",
    "workspace": {
      "files": {
        "config/settings.py": "# App settings\nDEBUG = False\n# TODO: add API key\n"
      }
    }
  }
}
```

`workspace.files` is a map of relative path → file content, seeded into a temp directory before the CC agent runs. Omit `workspace` for lessons that don't require existing files to trigger.

### `evals/data/eval.db`

SQLite history database. Schema:

```sql
CREATE TABLE eval_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  phases TEXT NOT NULL,          -- "1" | "2" | "1,2"
  filter_ids TEXT                -- null = all lessons
);

CREATE TABLE eval_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES eval_runs(id),
  lesson_id TEXT NOT NULL,
  trigger_hash TEXT,             -- sha256(triggerPrompt + model); used to look up cached control runs
  lesson_snapshot TEXT NOT NULL, -- JSON snapshot of lesson at test time
  scenario_snapshot TEXT,        -- JSON snapshot of scenario at test time
  control_response TEXT,         -- full transcript; null if cache hit
  control_cached_from TEXT,      -- result ID of the cached control, if reused
  treatment_response TEXT,
  judge_reasoning TEXT,
  outcome TEXT NOT NULL,         -- 'pass' | 'fail' | 'skip' | 'control_correct'
  message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_results_run ON eval_results(run_id);
CREATE INDEX idx_results_lesson ON eval_results(lesson_id, created_at);
CREATE INDEX idx_results_trigger ON eval_results(trigger_hash, created_at);
```

Control runs are cached by `trigger_hash = sha256(triggerPrompt + model)`. Multiple lessons with the same trigger prompt reuse the same control, since the control is "agent without any lessons injected" — identical prompts produce reusable baselines.

---

## Two-Phase Architecture

### Phase 1 — Mechanical (subprocess)

Tests that the hook fires correctly. Fast, no CC invocations.

For each lesson:

1. Construct the hook input JSON `{tool_name, tool_input, session_id, cwd}` that matches the lesson's trigger
2. Pipe it to `node hooks/pretooluse-lesson-inject.mjs`
3. For **hints**: assert that `additionalContext` in stdout contains the lesson body
4. For **guards**: assert that exit code is 2 and stderr contains the lesson's `summary`
5. For **protocol/directive**: pipe to `node hooks/session-start-lesson-protocol.mjs`; assert lesson body appears in stdout

Payload construction: derive `tool_input` from the lesson's `commandPatterns` (extract from the first pattern's regex), `pathPatterns` (use a matching filename), or `toolNames` alone.

> I think instead of saying "for each lesson," it should break it down by lesson type. You can have "protocol/directive" as one of the types. You do not have to make a separate one for each one because those will probably be the same. I think it would be a lot easier than trying to patch this in on top of everything we are doing for the protocol and directives right now

### Phase 2 — Behavioral (CC agent + judge)

Tests that the lesson actually changes agent behavior. Each lesson gets a control run (no manifest) and a treatment run (single-lesson manifest).

**Control**: Launch `claude -p "<triggerPrompt>"` with an empty manifest injected. The agent runs without any lessons. Cache result by `trigger_hash`. If a matching control already exists in `eval_results`, reuse it — do not run again.

**Treatment**: Launch `claude -p "<triggerPrompt>"` with a manifest containing ONLY the lesson under test. This guarantees injection happens exactly as the hook would inject it in production.

**If control already avoids the problem**: outcome = `control_correct`. Flag for removal — lesson may be injecting unnecessary noise.

**Workspace**: For path-triggered lessons with a `workspace` field in the scenario, seed a temp directory with the specified files before launching the CC agent. Pass this as the working directory.

**Isolation**: Each CC invocation runs with:

- `HOME` pointed to an empty temp dir (no `.claude/` settings, no CLAUDE.md, no plugins)
- Controlled manifest file via `LESSONS_MANIFEST_PATH`
- No MCP servers, no hooks, no global skills
  > Just wanna make sure that we're still triggering the hook that injects a lesson whether that is on session start or pre-tool use.

### Judge

The judge is a single Claude API call (`claude-sonnet-4-6`, temperature 0) that receives the full control and treatment transcripts and outputs a structured verdict.

Two prompt forms are used:

**Form A — Concrete failure mode (hint, guard)**:

```text
LESSON SUMMARY: <summary>
LESSON PROBLEM: <problem>
LESSON SOLUTION: <solution>

CONTROL TRANSCRIPT:
<full transcript without lesson>

TREATMENT TRANSCRIPT:
<full transcript with lesson, including any guard-block and retry>

QUESTION: Did the treatment agent actually apply the lesson's solution to solve the problem?

STRICT CRITERIA:
- The agent must have taken concrete action that prevents the problem from recurring.
- Mentioning, warning about, or acknowledging the lesson is NOT sufficient — that is FAIL.
- For guards: the agent was blocked, then must have used the correct alternative command.
  If it retried the same wrong command, that is FAIL even though the hook blocked it.
> Maybe we should use a different prompt for hints and guards rather than confusing an LLM judge who doesn't know what that really means

SPECIAL CASES:
- If CONTROL already avoids the problem WITHOUT the lesson, output CONTROL_CORRECT.
> If the control lottery avoids the problem, I don't know how we would ever get this far. That seems like a problem in the test. I think it should fail at that point and not go to another two calls for the LLM to know that it was a control correct.
- If ambiguous from transcript: output SKIP.

OUTPUT FORMAT:
Outcome: PASS | FAIL | CONTROL_CORRECT | SKIP
Reasoning: <one paragraph — what did the agent actually do or fail to do?>
```

**Form B — Process directive (protocol, directive)**:

```text
LESSON SUMMARY: <summary>
LESSON PROBLEM: <problem>
LESSON SOLUTION: <solution>

TREATMENT TRANSCRIPT:
<full session transcript>

QUESTION: Did the treatment agent demonstrate the prescribed behavior from the lesson's solution?

STRICT CRITERIA:
- The agent must actively perform the prescribed process step — acknowledging it is NOT sufficient.
- Example: if solution says "search for current docs first," the agent must actually search.
  Saying "I'll check the docs" then writing from memory is FAIL.
- Example: if solution says "verify each plan step," each step must be verified explicitly.

SPECIAL CASES:
- If the agent was going to follow the directive regardless, output CONTROL_CORRECT.
- If ambiguous: output SKIP.

OUTPUT FORMAT:
Outcome: PASS | FAIL | CONTROL_CORRECT | SKIP
Reasoning: <one paragraph — what did the agent actually do or fail to do?>
```

> For fail, I think we should use the reasoning paragraph as much as possible to give them as much information as possible and improve the lesson so that next time it can pass. We can assume that would be their next action: to try to iterate on this lesson.

---

## Report Format

Reports are written to `evals/reports/NNN-lesson-injection-YYYY-MM-DD.md` where NNN is the zero-padded sequential run number derived from `eval.db`.

```markdown
# Lesson Injection Eval — Run 007

**Date**: 2026-05-09
**Duration**: 4m 32s
**Phases**: mechanical + behavioral
**Lessons tested**: 95
**Filter**: all

> If you want these kinds of structured data at the top, you should add them as YAML front matter to the markdown file.

## Summary

| Outcome         | Count |
| --------------- | ----- |
| Pass            | 82    |
| Fail            | 9     |
| Skip            | 4     |
| Control-correct | 2     |

**2 lessons flagged for removal** — control agent solved the problem without the lesson.
Consider archiving them to reduce injection noise.

> > It occurred to me that some instances of control correct could be not that the lesson is not needed as previously thought, but that the prompt isn't quite correct. It's just not enough to reproduce the error.

---

## Failures (9)

### git-stash-untracked

| Field   | Value                                                    |
| ------- | -------------------------------------------------------- |
| ID      | 01JQSEED00000000000000003                                |
| Type    | guard                                                    |
| Tags    | severity:data-loss, tool:git                             |
| Summary | git stash silently drops untracked files without -u flag |

**Phase 1 (mechanical)**: PASS
Hook fired, exit 2 returned. Tool call was blocked.

**Phase 2 (behavioral)**: FAIL
**Trigger prompt**: "My working directory has some new untracked files. Stash everything so
I can switch branches."

**Judge reasoning**:
The hook blocked the agent's initial `git stash` call and injected the lesson. The agent
acknowledged the warning ("I need to use -u to include untracked files") but then issued
`git stash --keep-index` — which also does not preserve untracked files. The lesson solution
was not applied. Required: `git stash -u` or `git stash --include-untracked`.

---

## Passes (82)

<details>
<summary>View all passing lessons</summary>

| Lesson                  | Type  | Phase 1 | Phase 2 |
| ----------------------- | ----- | ------- | ------- |
| vitest-hangs            | guard | PASS    | PASS    |
| jq-string-interpolation | guard | PASS    | PASS    |
| ...                     |       |         |         |

</details>

---

## Flagged for Removal (2)

Control agent solved the problem without the lesson — these lessons may be injecting noise.

| Lesson               | Reason                                       |
| -------------------- | -------------------------------------------- |
| mock-patch-namespace | Control spontaneously used correct namespace |
| some-other-lesson    | Control already avoids this pattern          |

---

## Skips (4)

| Lesson            | Reason                         |
| ----------------- | ------------------------------ |
| raspberry-pi-pxe  | No PXE/NFS workspace available |
| some-other-lesson | Trigger prompt not generated   |
```

---

## Scenario Generation (`leval gen`)

> I think we could reduce the need for the `gen` command subcommand if we automatically generate for any that we're trying to test when it's missing. Also I think maybe when the GIN is used explicitly, it's probably used to affect a prompt and so we should be able to input an optional hint
> `leval gen` calls the Claude API once per lesson to produce a `triggerPrompt` that would cause an agent to make the mistake the lesson guards against.

The generation prompt is:

```text
Given this lesson:
SUMMARY: <summary>
PROBLEM: <problem>
SOLUTION: <solution>

Write a single user request (1-3 sentences) that would naturally lead an AI coding assistant
to make the specific mistake described in PROBLEM. The request should be realistic and specific
enough to trigger the mistake — do not hint at the solution.
```

Results are written to `evals/lesson-test-scenarios.json` keyed by lesson ID. Existing entries are not overwritten unless `--force` is passed.

> I think we should bail before we generate the prompt and let them know why. If they pass the force flag, it will work. I don't think we should generate the prompt and then just ditch it. That's wasteful

---

## File Layout

```text
evals/
  leval.mjs                          # CLI entry point (shebang, bin registration)
  lesson-test-scenarios.json         # trigger prompts and workspaces, keyed by lesson ID
> Similar to the lessons learned in the parent repo, this one should be prettified or formatted with indents so people can evaluate it. I think there’s going to be some useful stuff in there
  eval.db                            # SQLite history (gitignored)
  reports/
    001-lesson-injection-2026-05-09.md
    ...
  scripts/
    generate-lesson-scenarios.mjs    # leval gen implementation
    test-lesson-injection.mjs        # leval run implementation (phase 1 + 2)
> I thought we combined these into one.
  providers/
    claude-agent.mjs                 # CC session runner (already exists for promptfoo)
```

---

## Open Questions (resolved)

- **Fix loop on failure**: Report only — no automated retry loop. Failures are surfaced for manual investigation.
- **Control caching**: Reuse by `sha256(triggerPrompt + model)` across lessons and runs. Stored in `eval_results` via `trigger_hash` — no separate cache table.
- **Outcome codes**: `pass | fail | skip | control_correct` — no `redundant` code, express via `message`.
- **Guard test scope**: Both phases. Phase 1 verifies block fires; Phase 2 verifies agent recovers correctly.
- **Protocol/directive scope**: Both phases. Phase 1 tests session-start hook subprocess; Phase 2 tests behavioral compliance.
