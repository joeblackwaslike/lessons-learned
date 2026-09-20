# `reminder` Lesson Type — Design Spec

**Added:** 2026-09-20  
**Status:** Implemented

---

## Problem

Two persistent failure patterns motivated this type:

**Pattern 1 — PR drive-to-merge.** After `no-mistakes axi run` passes, the agent treats
`outcome: passed` in the command output as a "task complete" signal and ends its turn without
driving the PR review loop to merge. The rule to own the full review loop exists in AGENTS.md
but is pattern-matched past — the CLI output reads semantically like a completed unit of work.

**Pattern 2 — Plan file without plan mode.** When the agent writes a file under
`~/.claude/plans/` while NOT in plan mode, it may call `ExitPlanMode` next. That call either
fails or — worse — the model misreads it as explicit approval and executes the plan without
ever showing it to the user.

Neither pattern is a knowledge gap. Both are "known rule, wrong trigger." The fix is an
in-context prompt injected at the exact moment the wrong behavior would occur, not another
version of the same rule stored in AGENTS.md.

---

## Design Decision: PostToolUse injection

The existing lesson types (`hint`, `guard`) fire **PreToolUse** — before the tool runs. The
`protocol` and `directive` types fire at **session start** — once, before any tool calls.

Neither bucket fits these patterns. What's needed is a hook that fires **after** a specific
tool result returns, within the same agentic turn, before the agent decides to continue or
end. That's the PostToolUse lifecycle event.

**PostToolUse stdout contract:** raw markdown text. Empty stdout = no-op. (Different from
PreToolUse, which uses a JSON envelope with `hookSpecificOutput.additionalContext`.)

---

## The `reminder` type

| Property  | Value                                                              |
| --------- | ------------------------------------------------------------------ |
| Lifecycle | PostToolUse                                                        |
| Hook      | `hooks/posttooluse-lesson-remind.mjs`                              |
| Output    | Raw markdown injected into context                                 |
| Dedup     | Per (session, lesson, tool invocation) — layers 2+3 of `dedup.mjs` |

### Pattern fields

All three existing pattern fields are supported, each matching a different part of the tool
invocation. The lesson fires if ANY populated pattern set matches (OR logic):

| Field             | Matched against          | Applicable tools        |
| ----------------- | ------------------------ | ----------------------- |
| `commandPatterns` | `tool_input.command`     | `Bash`                  |
| `pathPatterns`    | `tool_input.file_path`   | `Write`, `Edit`, `Read` |
| `outputPatterns`  | `tool_response` (stdout) | any                     |

`outputPatterns` is new — it maps to `outputRegexSources` in the manifest (same
`{source, flags}` shape as `commandRegexSources`). `commandPatterns` and `pathPatterns`
reuse their existing compile path.

### Why OR logic

A `reminder` lesson should fire when _any_ of its configured conditions are met. Requiring
ALL pattern sets to match (AND logic) would make cross-field lessons nearly impossible to
write correctly. Most lessons will have only one pattern field populated; the OR logic is a
no-op for those.

### Dedup strategy

PostToolUse can't propagate env vars via stdout (unlike PreToolUse, which uses the JSON
`env` field). So the `LESSONS_SEEN` env-var fast path (dedup layer 1) is skipped.

Dedup key: `reminder-<slug>-<sha256(sessionId + toolName + command/path).slice(0,12)>`

This is unique per (session, lesson, specific tool invocation). A second distinct run of the
same tool (different command/path string) gets a fresh reminder; the same exact tool call
fires at most once per session.

### PreToolUse bleed prevention

`matchLessons()` in `core/match.mjs` does not filter by type — any lesson with a matching
`toolNames` entry can appear in PreToolUse results. A `reminder` lesson with
`toolNames: ['Bash']` would appear in PreToolUse matches alongside `hint` lessons.

Fix: `hooks/pretooluse-lesson-inject.mjs` filters matches to `type === 'hint' || type === 'guard'`
after calling `matchLessons`. Explicit allow-list, not deny-list.

---

## DB changes

- New column: `outputPatterns TEXT NOT NULL DEFAULT '[]'`
- `type` CHECK constraint updated to include `'reminder'`
- Migration: table rebuild (required to update CHECK constraint — SQLite can't ALTER a CHECK
  in place) guarded by `!cols.includes('outputPatterns')`
- `JSON_COLUMNS` in `db.mjs` includes `outputPatterns` so it round-trips as an array

---

## Alternatives considered

**PreToolUse with output inspection**: PreToolUse fires before the tool runs. The command
output isn't available yet. Not viable.

**Session-start protocol**: Fires once at startup. Can't react to specific tool results.
Injecting a general "don't end your turn after no-mistakes" directive here was tried — the
agent knows the rule but pattern-matches past it because the specific CLI output looks
like a terminal state.

**AGENTS.md rule strengthening**: Already there, already failing. The intervention point
was the problem, not the wording.

**`commandPatterns` reuse for output matching**: Proposed but rejected — reusing a field
named "commandPatterns" to match command output is semantically misleading. The new
`outputPatterns` field is explicit and self-documenting.

---

## Use cases

### PR drive-to-merge

```
type:           reminder
toolNames:      ['Bash']
outputPatterns: ['outcome:\\s*passed', 'pr_state:\\s*open']
```

Fires after `no-mistakes axi run` output contains `outcome: passed`.

### Plan file without plan mode

```
type:           reminder
toolNames:      ['Write', 'Edit']
pathPatterns:   ['\\.claude/plans/']
```

Fires after any Write or Edit to a file under `~/.claude/plans/`.
