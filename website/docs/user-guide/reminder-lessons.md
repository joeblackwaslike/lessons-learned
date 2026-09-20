---
sidebar_position: 10
title: Reminder Lessons
description: How to write reminder lessons — PostToolUse injections that enforce mandatory follow-on actions based on what a tool produced.
---

# Reminder Lessons

A `reminder` lesson fires **after** a tool result returns, before the agent decides what to do next. Use it when the trigger is what the tool _produced_ rather than what you were about to do — "you just did X, now do Y."

---

## When to use `reminder`

| Situation                                             | Type to use    |
| ----------------------------------------------------- | -------------- |
| Warn before running a risky command                   | `hint`         |
| Block a dangerous command entirely                    | `guard`        |
| Remind at session start, once                         | `protocol`     |
| Enforce a mandatory next step _after_ seeing a result | **`reminder`** |

A reminder is the right choice when:

- A pipeline step signals completion and the agent must immediately act on it — for example, a CI gate that passed and now requires the agent to drive the PR to merge rather than stopping.
- Writing or editing a specific file obligates the agent to take a follow-on action — for example, writing a plan file requires entering plan mode.
- The trigger is a substring in tool stdout, not in the command you ran.

---

## How it works

`posttooluse-lesson-remind.mjs` fires after every tool call. It loads the manifest, finds `reminder`-type lessons whose `toolNames` match the tool that just ran, and tests each lesson's `outputPatterns` against the tool's stdout (`tool_response`). On the first match, it injects a blockquote into the agent's context:

```text
> **[Reminder]** Drive PR to merge after no-mistakes pipeline passes
>
> After no-mistakes creates a PR (outcome: passed in output), the agent treats PR
> creation as task-complete and ends its turn instead of immediately driving the
> review loop to merge.
>
> Find the PR: gh pr list --head $(git branch --show-current) --json number,url
> ...
```

Dedup is per `(session, lesson, tool invocation)` — the same lesson fires at most once per session.

---

## Anatomy of a reminder lesson

```json
{
  "type": "reminder",
  "toolNames": ["Bash"],
  "outputPatterns": ["outcome: passed", "pr_state: open"],
  "priority": 10,
  "summary": "Drive PR to merge after no-mistakes pipeline passes",
  "problem": "After no-mistakes creates a PR (outcome: passed in output), the agent treats PR creation as task-complete and ends its turn instead of immediately driving the review loop to merge.",
  "solution": "Find the PR: gh pr list --head $(git branch --show-current) --json number,url\nThen: gh pr view <N> --json reviewDecision,reviews,statusCheckRollup\nOwn the whole review loop — triage bot feedback, fix issues, re-poll, merge.\nDo NOT return to the user until merged or blocked by a human decision."
}
```

### Key fields

| Field             | Required | Notes                                                                                      |
| ----------------- | -------- | ------------------------------------------------------------------------------------------ |
| `type`            | yes      | Must be `"reminder"`                                                                       |
| `toolNames`       | yes      | Which tools trigger the PostToolUse check — `Bash`, `Write`, `Edit`, etc.                  |
| `outputPatterns`  | yes\*    | Regex array matched against tool stdout. At least one must match for the lesson to fire.   |
| `commandPatterns` | no       | Also usable — fires if any command pattern matches the Bash command that was run.          |
| `pathPatterns`    | no       | Also usable — fires if any path pattern matches the file that was written or edited.       |
| `summary`         | yes      | One-line description shown in the injected blockquote header. ≤80 chars.                   |
| `problem`         | yes      | Why the agent fails without this reminder.                                                 |
| `solution`        | yes      | Concrete next-step commands or actions. This is what the agent will read after the result. |
| `priority`        | no       | Default 5. Use 9–10 for mandatory workflow gates.                                          |

\* `outputPatterns`, `commandPatterns`, and `pathPatterns` are OR-gated — the lesson fires if any populated set matches. A reminder with none of them set will fire on every call to the listed tools, which is almost never what you want.

---

## Two real examples

### Example 1 — Drive PR to merge after pipeline passes

**Problem:** `no-mistakes` outputs `outcome: passed` when the pipeline completes and a PR is created. Without a reminder, the agent treats PR creation as task-complete and returns to the user. The PR stalls unmerged.

**Fix:** Match on the pipeline success output and inject the full PR-to-merge workflow.

```json
{
  "type": "reminder",
  "toolNames": ["Bash"],
  "outputPatterns": ["outcome: passed", "pr_state: open"],
  "priority": 10,
  "summary": "Drive PR to merge after no-mistakes pipeline passes",
  "problem": "After no-mistakes creates a PR (outcome: passed in output), the agent treats PR creation as task-complete and ends its turn instead of immediately driving the review loop to merge.",
  "solution": "Find the PR: gh pr list --head $(git branch --show-current) --json number,url\nThen: gh pr view <N> --json reviewDecision,reviews,statusCheckRollup\nOwn the whole review loop — triage bot feedback, fix issues, re-poll, merge.\nDo NOT return to the user until merged or blocked by a human decision."
}
```

**Why `outputPatterns` instead of `commandPatterns`:** The trigger isn't what command was run — it's what the command returned. `outcome: passed` appears in the output of a successful `no-mistakes axi run` invocation. Using `commandPatterns` on the `no-mistakes` command would fire before the result is known; `outputPatterns` fires only when the result confirms success.

---

### Example 2 — Enter plan mode when writing a plan file

**Problem:** Writing a file under `.claude/plans/` while not in plan mode causes `ExitPlanMode` to fail silently, or the plan executes without user sign-off.

**Fix:** Fire after the Write or Edit tool succeeds on a plan path, reminding the agent to call `EnterPlanMode`.

```json
{
  "type": "reminder",
  "toolNames": ["Write", "Edit"],
  "pathPatterns": ["\\.claude/plans/"],
  "priority": 10,
  "summary": "Enter plan mode before writing a plan file",
  "problem": "Writing a file under ~/.claude/plans/ while NOT in plan mode and then calling ExitPlanMode causes it to fail silently or the model executes the plan without user sign-off.",
  "solution": "Call EnterPlanMode immediately after writing the plan file if not already in plan mode. Never call ExitPlanMode unless EnterPlanMode was called first in the same session."
}
```

**Why `pathPatterns` here instead of `outputPatterns`:** The trigger is which file was written — the path tells us everything we need to know. `outputPatterns` would require matching on the Write tool's stdout, which is minimal and unreliable. Use `pathPatterns` when the path is the signal; use `outputPatterns` when the content of the output is the signal.

---

## Writing good `outputPatterns`

A good output pattern is:

- **Distinctive.** It should not appear in unrelated tool output. `passed` alone is too broad; `outcome: passed` is specific to the `no-mistakes` pipeline format.
- **Stable.** If the output format might change, make the pattern match the invariant part. Avoid version strings or timestamps.
- **Short.** Match the minimum substring that identifies the condition. The regex is tested against the full stdout — you do not need to anchor to line start.

Test your pattern before committing:

```bash
echo "outcome: passed, pr_state: open, pr_url: ..." | grep -E "outcome: passed"
```

---

## Adding a reminder lesson

Use the slash command:

```text
/lessons:add
```

Select **reminder** at the type prompt, then provide the output pattern that should trigger it, the tool(s) to watch, and the mandatory next-step solution.

Or use the CLI directly:

```bash
node scripts/lessons.mjs add --json '{
  "type": "reminder",
  "toolNames": ["Bash"],
  "outputPatterns": ["outcome: passed"],
  "summary": "Drive PR to merge after no-mistakes passes",
  "problem": "...",
  "solution": "...",
  "priority": 10
}'
```

After adding, rebuild the manifest:

```bash
node scripts/lessons.mjs build
```

---

## Common mistakes

**Firing on every tool call:** A reminder with `toolNames: ["Bash"]` and no patterns fires after every Bash command. Always add at least one of `outputPatterns`, `commandPatterns`, or `pathPatterns`.

**Weak patterns causing false positives:** `passed` matches too broadly. Use `outcome: passed` or a more specific substring.

**Putting workflow instructions in `problem`:** The `problem` field explains _why_ the lesson exists. The `solution` field is what the agent reads when the reminder fires — put the actionable commands there.

**Using `reminder` for pre-execution warnings:** If you want to warn before a tool call runs, use `hint`. `reminder` fires _after_ — the tool has already run.
