---
sidebar_position: 8
title: Contributing Lessons
description: Writing, reviewing, and tuning high-quality lessons for maximum injection effectiveness.
---

# Contributing Lessons

This guide covers writing, reviewing, and tuning lessons for maximum effectiveness.

## Lesson types

| Type        | When injected                 | Effect                                   |
| ----------- | ----------------------------- | ---------------------------------------- |
| `hint`      | PreToolUse — on trigger match | Prepends warning to Claude's context     |
| `guard`     | PreToolUse — on trigger match | Blocks the tool call + injects reason    |
| `protocol`  | SessionStart                  | Injected once at session start           |
| `directive` | SessionStart                  | Always-on; higher priority than protocol |

**Rule of thumb:** default to `hint`. Use `guard` only for hard stops (destructive commands, security violations). Use `protocol` for once-per-session reminders. Use `directive` only for absolute always-on rules that need no trigger.

### One concrete example per type

**hint** — triggered warning on a specific command:

```json
{
  "summary": "git stash silently drops untracked files without -u flag",
  "problem": "Running `git stash` without the `-u` flag silently leaves untracked files behind, risking data loss when the stash is applied elsewhere.",
  "solution": "Use `git stash -u` or `git stash --include-untracked` to include untracked files in the stash.",
  "type": "hint",
  "tool": "Bash",
  "commandPatterns": ["\\bgit\\s+stash\\b"],
  "tags": ["tool:git", "severity:data-loss"],
  "priority": 7
}
```

**guard** — blocks a dangerous command pattern:

```json
{
  "summary": "never eval user-supplied strings — use bash -c or a wrapper instead",
  "problem": "Using `eval \"$user_input\"` executes arbitrary shell code. Even trusted input can contain subshell constructs or variable expansions that produce unintended side effects.",
  "solution": "Use `bash -c \"$1\"` with positional parameters, or wrap the command in an array and pass to exec. Never interpolate user input directly into eval.",
  "type": "guard",
  "tool": "Bash",
  "commandPatterns": ["\\beval\\b"],
  "commandMatchTarget": "executable",
  "tags": ["severity:security", "topic:shell"],
  "priority": 9
}
```

**protocol** — once-per-session reminder injected into the workspace:

```json
{
  "summary": "emit #lesson tags when you discover a problem→solution sequence",
  "problem": "Insights found during a session are lost unless captured. Future sessions repeat the same mistakes because there is no persistent record of what went wrong and how it was fixed.",
  "solution": "Whenever you identify a problem→solution pair, emit a #lesson...#/lesson block in your response. The scanner picks it up and promotes it to the lesson store after the session.",
  "type": "protocol",
  "tags": ["topic:lesson-capture", "severity:process"],
  "priority": 8
}
```

**directive** — always-on rule, no trigger needed:

```json
{
  "summary": "always check serial console first when a Pi node fails to boot",
  "problem": "SSH and ping give no diagnostic signal when a node fails before the network stack comes up. Checking SSH/ping wastes time and returns nothing useful at that stage.",
  "solution": "Connect via serial console (screen /dev/cu.usbmodem<ID> 115200) immediately when a node is unreachable. Serial shows BOOT_ORDER and the exact failure point before any network is available.",
  "type": "directive",
  "tags": ["env:pi-cluster", "topic:debugging"],
  "priority": 6
}
```

## Field reference by type

| Field                | hint                   | guard                  | protocol               | directive              |
| -------------------- | ---------------------- | ---------------------- | ---------------------- | ---------------------- |
| `summary`            | required               | required               | required               | required               |
| `problem`            | required               | required               | required               | required               |
| `solution`           | required               | required (≥20 chars)   | required               | required               |
| `tool`               | **required**           | **required**           | must be empty          | must be empty          |
| `commandPatterns`    | optional               | optional               | ignored                | ignored                |
| `pathPatterns`       | optional               | optional               | ignored                | ignored                |
| `commandMatchTarget` | optional               | recommended            | —                      | —                      |
| `tags`               | optional               | optional               | optional               | optional               |
| `priority`           | optional (default 5)   | optional (default 5)   | optional (default 5)   | optional (default 5)   |
| `confidence`         | optional (default 0.8) | optional (default 0.8) | optional (default 0.8) | optional (default 0.8) |
| `scope`              | optional               | optional               | optional               | optional               |

## The directive vs hint distinction

This is the most common misconfiguration:

**Wrong — directive with toolNames (toolNames silently ignored):**

```json
{
  "type": "directive",
  "tool": "Bash",
  "commandPatterns": ["\\bgit\\b"]
}
```

`directive` injects at session start regardless of any tool call. `toolNames` is silently ignored. The lesson fires on _every_ session whether or not git is ever used.

**Right — use `hint` when you want trigger-scoped injection:**

```json
{
  "type": "hint",
  "tool": "Bash",
  "commandPatterns": ["\\bgit\\b"]
}
```

**Right — use `directive` when the lesson should always be active (no conditions):**

```json
{
  "type": "directive"
}
```

The intake validator (`lessons add`) will block `directive`/`protocol` lessons that have `tool` set.

## Dead trigger: the silent no-fire trap

A `hint` or `guard` with `commandPatterns` or `pathPatterns` but no `tool` can **never fire**. The matching engine bails at step 1 (toolNames check) before evaluating patterns.

**Wrong:**

```json
{
  "type": "hint",
  "commandPatterns": ["\\bosascript\\b"]
}
```

**Right:**

```json
{
  "type": "hint",
  "tool": "Bash",
  "commandPatterns": ["\\bosascript\\b"]
}
```

The intake validator blocks this misconfiguration.

## `commandMatchTarget: "executable"`

By default, `commandPatterns` matches against the full command string including all arguments. This can cause false positives when your trigger word appears inside a JSON `--patch` argument or a quoted string.

**Example:**

```bash
node scripts/lessons.mjs edit --id my-lesson --patch '{"trigger": "git stash"}'
```

If a lesson has `commandPatterns: ["\\bgit\\s+stash\\b"]` and `commandMatchTarget: "full"` (default), this edit command would trigger the lesson even though no git stash is running.

**Fix:** set `commandMatchTarget: "executable"` — this strips everything after the first quoted argument before pattern matching.

Use `"executable"` for all `guard` lessons and any `hint` that targets a specific command name (not a flag or argument value).

## Capturing lessons: what makes a good lesson

**Emit `#lesson` tags in-session** when you discover a problem→solution sequence:

```text
#lesson
tool: Bash
trigger: osascript
problem: Using `osascript << EOF` (double-quoted) causes bash to expand $VAR references before osascript receives the script, silently corrupting AppleScript/JXA code.
solution: Use single-quoted delimiter: `osascript <<'EOF' ... EOF`. Escape literal $ as \$ if you need mixed expansion.
tags: tool:osascript, topic:heredoc, severity:silent-failure
#/lesson
```

**Good lesson criteria:**

- **Problem is specific and falsifiable.** "This can cause issues" is not a problem. "Bash expands $VARS inside unquoted heredoc, corrupting the osascript input" is.
- **Solution is actionable.** The reader should be able to apply it immediately without research. Include the exact command or pattern change.
- **Problem and solution are different.** The solution must add information beyond re-describing the problem. `lessons add` blocks lessons where the two are ≥70% similar by token overlap.
- **Summary ≤80 chars, no trailing `...`.** The summary is the injection header — it must fit on one line.
- **Solution ≥60 chars.** Short solutions don't transfer knowledge. Expand with the "why" or an example.

## Reviewing and promoting candidates

```bash
node scripts/lessons.mjs review        # list candidates grouped by tag
node scripts/lessons.mjs promote --ids <id1>,<id2>        # promote to active
node scripts/lessons.mjs promote --ids <id1> --archive "<id2>:reason"  # archive bad ones
```

When reviewing, ask:

1. Is the problem clearly falsifiable (not vague)?
2. Does the solution give concrete, actionable guidance?
3. Is the trigger narrow enough to avoid false positives?
4. Is the trigger broad enough to catch all variants (not over-specified)?
5. Would a future session recognize this as relevant without the original context?

## Tuning existing lessons

```bash
node scripts/lessons.mjs doctor                         # audit all active lessons
node scripts/lessons.mjs edit --id <slug> --patch '{"field":"value"}'  # fix inline
```

**Common tuning moves:**

| Doctor warning                      | Typical fix                                                             |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `summary too long`                  | Shorten to ≤80 chars; move detail to problem                            |
| `no patterns — fires on every call` | Add `commandPatterns` or `pathPatterns`                                 |
| `solution restates problem`         | Rewrite solution to only contain the fix, not the re-statement          |
| `overspecified trigger`             | Generalize the regex to the hazardous argument, not the full invocation |
| `context bleed`                     | Remove "this repo", "last session", first-person references             |
| `solution-staleness`                | Remove or generalize version strings                                    |
| `directive with toolNames`          | Remove `tool` field or change type to `hint`                            |

**Priority tuning:** if `doctor` reports priority homogeneity, differentiate high-impact lessons to priority 7-9 and routine hints to 3-5. Injection order within a priority cluster is arbitrary.
