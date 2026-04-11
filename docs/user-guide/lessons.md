# Working with Lessons

A lesson is a structured record of a mistake and its fix, annotated with trigger patterns that control when it fires.

---

## Lesson anatomy

```json
{
  "id": "01JQSEED00000000000000001",
  "slug": "pytest-tty-hanging-k9m2",
  "summary": "pytest hangs in non-interactive envs due to TTY detection",
  "mistake": "Running bare `pytest` in Claude Code causes the process to hang waiting for TTY input.",
  "remediation": "Use `python -m pytest --no-header -p no:faulthandler`",
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

| Field         | Required | Description                                                                                    |
| ------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `summary`     | ✓        | One-line description. Used as fallback injection when full text exceeds budget. Max 120 chars. |
| `mistake`     | ✓        | Root cause explanation. Describes _why_ something fails, not just that it does. Min 20 chars.  |
| `remediation` | ✓        | Concrete fix. Actionable commands or code. Copy-pasteable. Min 20 chars.                       |
| `triggers`    | ✓        | What tool calls activate this lesson. See trigger types below.                                 |
| `priority`    | ✓        | 1–10. Higher wins budget conflicts.                                                            |
| `confidence`  | ✓        | 0.0–1.0. Below `minConfidence` (default 0.5), excluded from the manifest.                      |

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

!!! tip "Use negative lookahead to suppress when fix is applied"
`json
    "commandPatterns": ["\\bpytest\\b(?!.*(--no-header|-p no:faulthandler))"]
    `
This pattern fires on `pytest tests/` but not on `pytest --no-header tests/` — suppressing injection once the fix is already in place.

### Priority guide

| Range | Meaning                                   |
| ----- | ----------------------------------------- |
| 9–10  | Data loss, session hangs, security issues |
| 7–8   | Common recurring mistakes, wrong defaults |
| 4–6   | Good-to-know patterns                     |
| 1–3   | Situational, low-frequency                |

### Lesson types

The `type` field controls how a lesson affects tool calls:

| Type        | Behavior                                                    |
| ----------- | ----------------------------------------------------------- |
| `hint`      | Inject as `additionalContext` on matching tool call         |
| `guard`     | Deny the tool call entirely; message shown to the agent     |
| `protocol`  | Inject at session start (reasoning reminders)               |
| `directive` | Inject at session start and on matching tool calls          |

**Guard lessons** (blocking): set `type: "guard"` to deny a tool call entirely. The `message` field is shown to the agent as the denial reason. Use `{command}` in the message for a substituted snippet of the actual command (truncated to 120 chars):

```yaml
type: guard
message: "pytest without --no-header hangs. Rerun as: {command} --no-header -p no:faulthandler"
```

Use guard sparingly — only for commands with known data-loss or irreversible consequences.

---

## Adding a lesson

=== "Slash command (recommended)"

    ```
    /lessons:add
    ```

    Claude asks five questions conversationally: mistake, fix, trigger, summary, and optional tags/priority. Takes ~2 minutes.

=== "CLI interactive"

    ```bash
    node scripts/lessons.mjs add
    ```

=== "CLI JSON"

    ```bash
    node scripts/lessons.mjs add --json '{
      "summary": "git stash drops untracked files silently",
      "mistake": "git stash only stashes tracked modified files — untracked files are silently left behind",
      "remediation": "Use git stash -u (--include-untracked) to include untracked files",
      "trigger": "git stash",
      "tags": ["tool:git", "severity:data-loss"],
      "priority": 8
    }'
    ```

=== "Direct edit"

    Edit `data/lessons.json` directly, then rebuild:

    ```bash
    node scripts/lessons.mjs build
    ```

### Validation rules

The CLI enforces these before writing:

- `summary`, `mistake`, `remediation` each ≥ 20 characters
- No unfilled template placeholders (`<what_went_wrong>` etc.)
- `summary` must not end with `...`
- Trigger must not be a prose gerund (e.g. "running pytest")
- Jaccard similarity of `mistake` vs. all existing lessons < 0.5 (no near-duplicates)

---

## Listing lessons

```bash
node scripts/lessons.mjs list           # formatted table
node scripts/lessons.mjs list --json    # JSON array
```

Or from Claude Code:

```
/lessons:manage → "show active"
```

---

## Editing a lesson

From the CLI:

```bash
node scripts/lessons.mjs edit --id <id> --patch '{"priority": 9}'
```

Or conversationally:

```
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
