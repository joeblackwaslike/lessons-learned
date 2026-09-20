# `reminder` Lesson Type — Design Spec

**Date**: 2026-09-20  
**Status**: Implemented  
**Author**: Joe Black

---

## Overview

A new lesson type that fires **PostToolUse** — after a tool result returns, within the same
agentic turn, before the agent decides to continue or end. This is the correct injection
point for "you just did X, now you must do Y" patterns that existing lesson types cannot
cover.

---

## Goals

- Inject mandatory-next-step context at the exact moment wrong behavior would occur
- Support matching against tool output (not just command text or file paths)
- Fire once per (session, lesson, tool invocation) — no repeat noise
- Never bleed into PreToolUse — `hint`/`guard` injection must remain unaffected

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
version of the same rule in AGENTS.md.

---

## Design

### Bucket placement

| Bucket                 | Types                   | Hook                                | Lifecycle                     |
| ---------------------- | ----------------------- | ----------------------------------- | ----------------------------- |
| PreToolUse inject      | `hint`, `guard`         | `pretooluse-lesson-inject.mjs`      | Before tool runs              |
| Session-start          | `protocol`, `directive` | `session-start-lesson-protocol.mjs` | Once at startup               |
| **PostToolUse remind** | **`reminder`**          | **`posttooluse-lesson-remind.mjs`** | **After tool result returns** |

### Pattern fields — OR logic

All three pattern fields are supported, each matched against a different part of the tool
invocation. A lesson fires if ANY populated pattern set matches:

| Field             | Matched against          | Applicable tools        |
| ----------------- | ------------------------ | ----------------------- |
| `commandPatterns` | `tool_input.command`     | `Bash`                  |
| `pathPatterns`    | `tool_input.file_path`   | `Write`, `Edit`, `Read` |
| `outputPatterns`  | `tool_response` (stdout) | any                     |

`outputPatterns` is a new field, compiled to `outputRegexSources: {source, flags}[]` in the
manifest. `commandPatterns` and `pathPatterns` reuse their existing compile paths.

### Dedup strategy

PostToolUse can't propagate env vars via stdout (unlike PreToolUse, which uses the JSON `env`
field). Layer 1 (`LESSONS_SEEN` env var) is skipped. Layers 2+3 (`claimLesson` file claim) are
used.

Dedup key: `reminder-<slug>-<sha256(sessionId + toolName + command/path).slice(0,12)>`

Unique per (session, lesson, tool invocation). A second distinct run of the same tool gets a
fresh reminder; the same exact tool call fires at most once per session.

### Output format

Raw markdown to stdout (not JSON). Empty stdout = no-op.

```
> **[Reminder]** <summary>
>
> <solution lines, each prefixed with `> `>
```

### PreToolUse bleed prevention

`matchLessons()` in `core/match.mjs` is type-agnostic — any lesson with a matching `toolNames`
entry can appear in PreToolUse results. Fix: `pretooluse-lesson-inject.mjs` adds an explicit
allow-list filter after `matchLessons()`:

```js
const preToolMatches = matches.filter(m => m.type === 'hint' || m.type === 'guard' || !m.type);
```

---

## DB Changes

- New column: `outputPatterns TEXT NOT NULL DEFAULT '[]'`
- `type` CHECK constraint updated to include `'reminder'`
- Migration: table rebuild (SQLite can't ALTER a CHECK constraint in place), guarded by
  `!cols.includes('outputPatterns')`
- `JSON_COLUMNS` in `db.mjs` includes `outputPatterns` so it round-trips as an array

---

## Alternatives Considered

**PreToolUse with output inspection**: PreToolUse fires before the tool runs. Tool output
isn't available yet. Not viable.

**Session-start protocol**: Fires once at startup. Can't react to specific tool results.
A general "don't end your turn after no-mistakes" directive was already present and failing —
the agent knows the rule but pattern-matches past the specific CLI output.

**AGENTS.md rule strengthening**: Already present, already failing. The injection point was
the problem, not the wording.

**`commandPatterns` reuse for output matching**: Rejected — reusing a field named
`commandPatterns` to match command output is semantically misleading. `outputPatterns` is
explicit.

---

## Use Cases

### Lesson A — PR drive-to-merge

```
type:           reminder
toolNames:      ['Bash']
outputPatterns: ['outcome: passed', 'pr_state: open']
priority:       10
tags:           ['workflow:pr', 'severity:autonomy']
```

Fires after any Bash command whose output contains `outcome: passed` (the `no-mistakes`
success signal). Injects instructions to find the PR and own the full review loop.

### Lesson B — Plan file without plan mode

```
type:           reminder
toolNames:      ['Write', 'Edit']
pathPatterns:   ['\\.claude/plans/']
priority:       10
tags:           ['workflow:planning', 'severity:data-loss']
```

Fires after any Write or Edit to a file under `~/.claude/plans/`. Injects a reminder to call
`EnterPlanMode` before calling `ExitPlanMode`.
