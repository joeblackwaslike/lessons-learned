---
name: lessons-learned
version: 0.1.0
description: 'Use when the user asks about the lessons-learned plugin or wants to work with it. Use when the user wants to add a lesson, capture a coding mistake for future prevention, scan session logs for new lesson candidates, promote or archive candidates from the scan output, browse active lessons, or tune injection settings. Use when the user types /lessons:add, /lessons:review, /lessons:manage, /lessons:config, /lessons:doctor, or /lessons:cancel. Use when the user asks what lessons are currently active, how to get started, or how lesson injection works. Use when the user wants to audit or QA the lesson store for dead triggers, unreachable lessons, truncated summaries, or near-duplicates. Use when the user wants to retract or cancel a lesson tag they just emitted. Do not wait for the user to name this plugin explicitly — if they ask about capturing mistakes, lesson candidates, the scan-promote pipeline, or lesson injection into context, this skill applies.'
---

# lessons-learned

A Claude Code plugin that automatically captures coding mistakes from session logs and injects relevant warnings before the same mistake can happen again.

---

## How it works

```
Session logs  →  scan  →  candidates (DB)  →  /lessons:review  →  active lessons
                                                                         ↓
                                               lesson-manifest.json  ←  build
                                                                         ↓
                                               Hook fires PreToolUse  →  injection
```

1. **Scan** — reads `~/.claude/projects/` JSONL files for `#lesson` tags (structured) and error→correction patterns (heuristic). New patterns land in the DB as `status='candidate'`.
2. **Review** — `/lessons:review` runs scan → LLM filter → conversational approval → batch promotion.
3. **Build** — `lessons build` compiles active lessons into `lesson-manifest.json`, the runtime index read by hooks.
4. **Inject** — `PreToolUse` and `SessionStart` hooks match the manifest against the current tool call and prepend relevant lessons to Claude's context.

---

## Lesson lifecycle

```
candidate  →  reviewed  →  active  →  archived
                ↑                        ↓
                └── restore ─────────────┘
```

- **candidate** — captured by scan, not yet injected
- **reviewed** — flagged for human review (confidence < 0.7 or manually staged)
- **active** — in the manifest, injected into sessions
- **archived** — retired, not injected, restorable

---

## Slash commands

| Command            | What it does                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `/lessons:add`     | Conversationally add a lesson — Claude asks for problem, solution, trigger, then writes it   |
| `/lessons:review`  | Scan for new candidates, LLM-filter them, present a numbered list, approve/archive → promote |
| `/lessons:manage`  | Browse and manage all lessons by status — promote, archive, edit, restore                    |
| `/lessons:config`  | View and tune configuration with plain-language explanations of every setting                |
| `/lessons:doctor`  | QA audit — finds dead triggers, unreachable hints, guard false positives, truncated/long summaries, casing errors, near-duplicates. Offers automatic and interactive fixes. |
| `/lessons:cancel`  | Retract a lesson tag after the fact — archives DB records (any status) and emits `#lesson:cancel` markers for lessons emitted this session but not yet scanned. |

---

## Common workflows

**Routine maintenance (weekly-ish)**

```
/lessons:review
```

Scans, filters noise, presents candidates for approval.

**Periodic QA (after bulk imports or edits)**

```
/lessons:doctor
```

Audits 8 quality dimensions — dead triggers, unreachable hints, guard false positives,
truncated summaries, casing errors, near-duplicates. Applies mechanical fixes automatically,
reviews judgment calls interactively.

**Retract a lesson you just emitted**

```
/lessons:cancel
```

Shows recently emitted lessons (DB + unscanned this session), lets you pick which to retract. Emits `#lesson:cancel` markers for unscanned ones so the scanner skips them.

**Quick manual capture**

```
/lessons:add
```

Claude asks 5 questions and writes the lesson. ~2 minutes.

**Tune what gets injected**

```
/lessons:config
```

Adjust `maxLessonsPerInjection`, `minConfidence`, `injectionBudgetBytes`.

**Fix or retire a lesson**

```
/lessons:manage
→ "edit priority on pytest-tty-hanging"
→ "archive git-stash-untracked — superseded"
```

---

## Reference files

Load these when you need deeper detail — don't load all of them upfront:

| File                            | Load when...                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `references/lesson-fields.md`   | User asks about a specific field, or you're building a lesson JSON payload             |
| `references/writing-guide.md`   | User is adding a lesson manually, or you're enriching candidates during review         |
| `references/lesson-emission.md` | User asks about the `#lesson` tag format, or you need to emit a lesson after a mistake |
| `references/cli-reference.md`   | User asks about CLI subcommands or you need a specific flag                            |
| `references/data-files.md`      | User asks about data directory contents or file purposes                               |
