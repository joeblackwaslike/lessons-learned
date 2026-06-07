---
sidebar_position: 2
title: Working with Lessons
description: Lesson anatomy, trigger types, adding, editing, and managing the lesson store.
---

# Working with Lessons

A lesson is a structured record of a mistake and its fix, annotated with trigger patterns that control when it fires.

---

## Lesson anatomy

```json
{
  "id": "01JQSEED00000000000000001",
  "slug": "pytest-tty-hanging-k9m2",
  "summary": "pytest hangs in non-interactive envs due to TTY detection",
  "problem": "Running bare `pytest` in Claude Code causes the process to hang waiting for TTY input.",
  "solution": "Use `python -m pytest --no-header -p no:faulthandler`",
  "triggers": {
    "commandPatterns": ["\\bpytest\\b(?!.*(--no-header|-p no:faulthandler))"],
    "toolNames": ["Bash"]
  },
  "tags": ["lang:python", "tool:pytest", "severity:hang"],
  "priority": 8,
  "confidence": 0.95
}
```

### Core fields

| Field        | Required | Description                                                                                    |
| ------------ | -------- | ---------------------------------------------------------------------------------------------- |
| `summary`    | yes      | One-line description. Used as fallback injection when full text exceeds budget. Max 120 chars. |
| `problem`    | yes      | Root cause explanation. Describes _why_ something fails, not just that it does. Min 20 chars.  |
| `solution`   | yes      | Concrete fix. Actionable commands or code. Copy-pasteable. Min 20 chars.                       |
| `triggers`   | yes      | What tool calls activate this lesson. See trigger types below.                                 |
| `priority`   | yes      | 1–10. Higher wins budget conflicts.                                                            |
| `confidence` | yes      | 0.0–1.0. Below `minConfidence` (default 0.5), excluded from the manifest.                      |

### Trigger types

```json
"triggers": {
  "commandPatterns": ["\\bpytest\\b(?!.*(--no-header))"],
  "pathPatterns": ["**/*.test.py", "pytest.ini"],
  "toolNames": ["Bash"],
  "sessionStart": false
}
```

| Type                 | Fires when                        | Use for                                                    |
| -------------------- | --------------------------------- | ---------------------------------------------------------- |
| `commandPatterns`    | Bash command matches regex        | Tool-specific commands like `pytest`, `git stash`          |
| `pathPatterns`       | Read/Edit/Write path matches glob | File-type warnings like "don't edit this file directly"    |
| `toolNames`          | Exact tool name match             | Broad reminders for any use of a tool                      |
| `sessionStart: true` | Session startup                   | Cross-cutting reasoning reminders with no specific trigger |

::: tip Use negative lookahead to suppress when fix is applied

```json
"commandPatterns": ["\\bpytest\\b(?!.*(--no-header|-p no:faulthandler))"]
```

This pattern fires on `pytest tests/` but not on `pytest --no-header tests/` — suppressing injection once the fix is already in place.
:::

### Advanced fields

These fields give you finer control over when a lesson fires and whether it appears in the manifest at all.

#### `modelPatterns`

An array of regexes tested against the command or file path as an AND gate. When non-empty, the lesson only fires if at least one pattern matches. Use this to restrict a lesson to a specific model or provider.

```json
{
  "modelPatterns": ["o3", "o4-mini", "reasoning_effort"]
}
```

Pair with tags like `model-version:o3` or `provider:openai` to make the intent explicit.

#### `requires`

Excludes a lesson from the manifest unless a specific artifact (plugin, MCP server, or skill) is installed. Accepts a single object or an array (OR logic — any match satisfies the requirement).

```json
{ "requires": { "type": "plugin", "name": "serena" } }
```

```json
{
  "requires": [
    { "type": "plugin", "name": "serena" },
    { "type": "mcp-server", "name": "serena" }
  ]
}
```

Valid shapes: `{"type":"plugin","name":"..."}`, `{"type":"mcp-server","name":"..."}`, `{"type":"skill","name":"..."}`.

Use `requires` when a lesson only makes sense if the referenced tool is present — for example, a lesson about Serena's `replace_content` is useless if Serena isn't installed.

#### `duplicatedBy`

The inverse of `requires`. Excludes a lesson from the manifest **when** the named artifact IS installed. Accepts a single object (not an array).

```json
{ "duplicatedBy": { "type": "plugin", "name": "serena" } }
```

Use this to suppress a workaround lesson once the real fix (the plugin that makes it unnecessary) is installed.

### Priority guide

| Range | Meaning                                   |
| ----- | ----------------------------------------- |
| 9–10  | Data loss, session hangs, security issues |
| 7–8   | Common recurring mistakes, wrong defaults |
| 4–6   | Good-to-know patterns                     |
| 1–3   | Situational, low-frequency                |

### Lesson types

The `type` field controls how a lesson affects tool calls:

| Type        | Behavior                                                |
| ----------- | ------------------------------------------------------- |
| `hint`      | Inject as `additionalContext` on matching tool call     |
| `guard`     | Deny the tool call entirely; message shown to the agent |
| `protocol`  | Inject at session start (reasoning reminders)           |
| `directive` | Inject at session start and on matching tool calls      |

**Guard lessons** (blocking): set `type: "guard"` to deny a tool call entirely. The `message` field is shown to the agent as the denial reason. Use `{command}` in the message for a substituted snippet of the actual command (truncated to 120 chars):

```yaml
type: guard
message: 'pytest without --no-header hangs. Rerun as: {command} --no-header -p no:faulthandler'
```

Use guard sparingly — only for commands with known data-loss or irreversible consequences.

### Mid-session re-injection

`directive` and `protocol` lessons are injected once at session start, but their influence fades as the context window fills. To counteract this, a PostToolUse hook monitors context usage and re-injects them automatically at three thresholds:

| Injection | Threshold | Rationale                                              |
| --------- | --------- | ------------------------------------------------------ |
| First     | 30%       | Pre-degradation — model is maximally receptive         |
| Second    | 52%       | Early rot zone — catch drift before it compounds       |
| Third     | 70%       | Deep rot — last refresh before auto-compaction at ~80% |

When a threshold is crossed you'll see a `## [lessons-learned] Directive & Protocol Refresh` block appear in context, formatted identically to the session-start injection. Each threshold fires at most once per session.

**Fallback**: if context percentage isn't available, the hook fires every 20 tool calls instead.

Both values are configurable — see [Configuration → Re-injection settings](../reference/configuration.md#re-injection-settings) for `LESSONS_REINJECT_THRESHOLDS` and `LESSONS_REINJECT_TOOL_COUNT`.

---

## Adding a lesson

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
  <TabItem value="slash" label="Slash command (recommended)" default>

```text
/lessons:add
```

Claude asks five questions conversationally: problem, solution, trigger, summary, and optional tags/priority. Takes ~2 minutes.

  </TabItem>
  <TabItem value="cli-interactive" label="CLI interactive">

```bash
node scripts/lessons.mjs add
```

  </TabItem>
  <TabItem value="cli-json" label="CLI JSON">

```bash
node scripts/lessons.mjs add --json '{
  "summary": "git stash drops untracked files silently",
  "problem": "git stash only stashes tracked modified files — untracked files are silently left behind",
  "solution": "Use git stash -u (--include-untracked) to include untracked files",
  "trigger": "git stash",
  "tags": ["tool:git", "severity:data-loss"],
  "priority": 8
}'
```

  </TabItem>
  <TabItem value="direct" label="Direct edit">

Edit `data/lessons.json` directly, then rebuild:

```bash
node scripts/lessons.mjs build
```

  </TabItem>
</Tabs>

### Validation rules

The CLI enforces these before writing:

- `summary`, `problem`, `solution` each ≥ 20 characters
- No unfilled template placeholders (`<what_went_wrong>` etc.)
- `summary` must not end with `...`
- Trigger must not be a prose gerund (e.g. "running pytest")
- Jaccard similarity of `problem` vs. all existing lessons < 0.5 (no near-duplicates)

---

## Listing lessons

```bash
node scripts/lessons.mjs list           # formatted table
node scripts/lessons.mjs list --json    # JSON array
```

Or from Claude Code:

```text
/lessons:manage → "show active"
```

---

## Editing a lesson

From the CLI:

```bash
node scripts/lessons.mjs edit --id <id> --patch '{"priority": 9}'
```

Or conversationally:

```text
/lessons:manage → "edit priority on pytest-tty-hanging to 9"
```

After editing an active lesson, the manifest is rebuilt automatically.

---

## Archiving and restoring

Archive a lesson (removes it from injection without deleting it):

```bash
node scripts/lessons.mjs promote --archive "<id>:reason here"
```

Restore an archived lesson:

```bash
node scripts/lessons.mjs restore --ids <id>
```

---

## The seed lesson store

The plugin ships with 30 hand-authored lessons covering common failure patterns:

| Category        | Examples                                                                    |
| --------------- | --------------------------------------------------------------------------- |
| Python          | pytest TTY hang, `mock.patch` namespace, pip venv targeting                 |
| JavaScript/Node | vitest parallel isolation, npm link peer deps, Node.js deprecation warnings |
| Git             | `git stash` untracked files, heredoc commit messages                        |
| Browser/CDP     | Chrome DevTools `ECONNREFUSED`, async `eval` returning `undefined`          |
| Shell           | oh-my-zsh NVM warnings, pre-commit hook failures, Biome v2 config schema    |

Review the seed lessons in `/lessons:manage → "show active"` to see what's already covered.
