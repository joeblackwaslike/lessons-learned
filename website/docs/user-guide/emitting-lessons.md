---
sidebar_position: 3
title: Emitting Lessons
description: How to emit #lesson tags in Claude responses so the scanner can capture them automatically.
---

# Emitting Lessons

When you make and correct a mistake during a session, you can emit a structured `#lesson` tag. The scanner harvests these automatically — no manual entry required.

---

## The `#lesson` tag format

```text
#lesson
tool: Bash
trigger: git stash
problem: git stash silently omits untracked files, risking data loss
solution: Use `git stash -u` to include untracked files
tags: tool:git, severity:data-loss
#/lesson
```

### Required fields

| Field      | Description                                                                           |
| ---------- | ------------------------------------------------------------------------------------- |
| `problem`  | What went wrong and why. Not just "it failed" — explain the root cause. Min 20 chars. |
| `solution` | The concrete correction. Commands, flags, code. Copy-pasteable. Min 20 chars.         |

### Optional fields

| Field     | Description                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `tool`    | The Claude Code tool name: `Bash`, `Read`, `Edit`, `Write`, `Glob`                                                             |
| `trigger` | A command, file path, or pattern that will become the trigger. Do not use prose gerunds — "git stash" not "running git stash". |
| `tags`    | Comma-separated `category:value` tags. See [tag taxonomy](../reference/tags.md).                                               |
| `scope`   | `project` to restrict to the current project only. Omit for a global lesson.                                                   |

### Scope field

To restrict a lesson to the current project only, add `scope: project`:

```text
#lesson
tool: Bash
trigger: just test
problem: just recipe leaks env vars into sub-shells
solution: Use `just --set KEY val` instead of export
tags: tool:just
scope: project
#/lesson
```

Omit `scope` entirely for a global lesson that applies across all projects.

---

## Cancelling a lesson

To retroactively cancel a lesson tag emitted earlier in the same session:

```text
#lesson:cancel
problem: first ~60 chars of the problem field to cancel
#/lesson:cancel
```

Use `/lessons:cancel` for an interactive cancel workflow (also handles DB records).

---

## When to emit

Emit a `#lesson` tag whenever you:

- Discover why a tool call failed and apply a different approach
- Catch yourself about to repeat a known mistake
- Receive a user correction ("no", "wrong", "that's not right")
- Identify a root cause after debugging

Do **not** force lesson tags where none apply. Only tag genuine problem→solution sequences.

---

## Examples

### Bash command with wrong flags

```text
#lesson
tool: Bash
trigger: pytest
problem: Running bare `pytest` in Claude Code causes the process to hang waiting for TTY input in non-interactive environments
solution: Use `python -m pytest --no-header -p no:faulthandler` instead
tags: lang:python, tool:pytest, severity:hang
#/lesson
```

### Wrong API namespace

```text
#lesson
tool: Bash
trigger: mock.patch
problem: mock.patch needs to patch where the object is used, not where it's defined — using the wrong namespace causes the mock to have no effect
solution: Patch `mymodule.os.path.exists`, not `os.path.exists`, when `mymodule` imports and uses `os.path.exists`
tags: lang:python, topic:testing
#/lesson
```

### File path pattern

```text
#lesson
tool: Edit
trigger: package-lock.json
problem: Editing package-lock.json directly breaks npm's integrity checksums, causing install failures
solution: Let npm manage package-lock.json — run `npm install` to update it, never edit manually
tags: tool:npm, severity:silent-failure
#/lesson
```

### Session-start reasoning reminder

```text
#lesson
problem: Assuming Bash is available in subagents — Agent tool spawns may have a restricted tool set, and calling a missing tool wastes a turn
solution: Check available tools before assuming Bash is present; use Read/Grep/Glob for file operations in potentially restricted contexts
tags: topic:agents
#/lesson
```

(No `trigger` means it becomes a `protocol`/`sessionStart: true` lesson — injected at session startup, not on a specific tool call.)

---

## What happens next

The scanner picks up `#lesson` tags on the next session startup. The background scan:

1. Reads new bytes in the session JSONL
2. Extracts the tag
3. Validates fields (length, no placeholders, no duplicate)
4. Writes a Tier 1 candidate with `confidence >= 0.75`

If it passes validation, the candidate auto-promotes to the lesson store and the manifest is rebuilt.

If it fails validation (too short, near-duplicate of existing lesson, etc.), it appears in `/lessons:review` for manual adjustment.

---

## Tag format

Tags follow `category:value` format. Common categories:

| Category   | Values                                             |
| ---------- | -------------------------------------------------- |
| `lang`     | `python`, `typescript`, `javascript`, `go`         |
| `tool`     | `pytest`, `git`, `npm`, `docker`, `vim`            |
| `severity` | `hang`, `data-loss`, `silent-failure`, `error`     |
| `topic`    | `testing`, `auth`, `networking`, `types`, `agents` |

See the full [tag reference](../reference/tags.md) for all established tags.

---

## Embedding in code fences

If you're emitting a lesson inside a markdown code block (e.g., in a documentation comment), the scanner strips the fence delimiters before parsing:

````text
```
#lesson
tool: Bash
trigger: git stash
problem: ...
solution: ...
#/lesson
```
````

Both forms are recognized. The outer backticks are not included in the parsed content.

---

## Compliance threshold

The reporting protocol is injected at session startup. If you find yourself not emitting tags even when mistakes occur, consider increasing the priority of the session-start protocol lesson or reviewing your `compactionReinjectionThreshold` setting to ensure the protocol re-injects after `/compact`.
