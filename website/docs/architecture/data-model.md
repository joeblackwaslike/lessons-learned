---
sidebar_position: 3
title: Data Model
description: Lesson schema, manifest format, scan state, and candidate format for the lessons-learned plugin.
---

# Data Model

**Last updated:** 2026-08-08

For the full field-by-field JSON Schema, see [Schema Reference](../reference/schemas.md) — this
page covers the same records from a system-design angle. See also
[Developer Guide: Data Model](../developer-guide/data-model.md) for the lesson-author-facing view.

---

## Overview

All data lives in `data/` as a SQLite database and JSON support files.

| File                     | Purpose                                                                                             | Edit directly?                          |
| ------------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `lessons.db`             | Source of truth — all lesson and candidate records (SQLite)                                         | No — use `node scripts/lessons.mjs`     |
| `lesson-manifest.json`   | Pre-compiled runtime manifest                                                                       | No — run `lessons build`                |
| `config.json`            | Injection and scanning configuration                                                                | Yes                                     |
| `scan-state.json`        | Per-file byte offsets for incremental scanning                                                      | No — managed by scanner                 |
| `obsoleted-lessons.json` | Append-only ledger of lessons archived because the eval suite showed the model already handles them | Yes — appended by `lessons` maintainers |

There is no `lessons.json` or `cross-project-candidates.json` file — both candidates and active
lessons are rows in `lessons.db`, distinguished by `status`.

### `lessons.db` is intentionally untracked in git

`lessons.db` is never committed — `.gitignore`'s `*.db` rule covers it deliberately, not by
accident. Every fresh install/clone should only ever inherit the curated `lesson-manifest.json`
(active lessons above the confidence/priority thresholds, not flagged `needsReview`), never the
full DB — which also holds unreviewed candidates and any personal/experimental lessons that
shouldn't ship to other users. Tracking the raw `.db` file would also produce unmergeable binary
diffs across this repo's git worktrees.

This means `lessons.db` has no git history and no built-in redundancy — it is a single point of
failure for candidates and archived-lesson reasoning that never made it into the manifest. Back
it up with `node scripts/lessons.mjs backup` (or `/lessons:backup`), which snapshots it via
SQLite's `VACUUM INTO` to an out-of-tree directory (default `~/.lessons-learned-backups/`,
override with `LESSONS_BACKUP_DIR`), keeping the most recent 14 snapshots (`LESSONS_BACKUP_KEEP`).
Restore with `node scripts/lessons.mjs restore --db [--file <path>]`. A daily `launchd`
LaunchAgent runs this automatically on Joe's machine; see `AGENTS.md`'s "Lesson store" section.

---

## Lesson record (SQLite `lessons.db`)

All lesson fields are stored in the `lessons` table. Key columns:

```sql
id                  TEXT PRIMARY KEY          -- ULID, generated on add
slug                TEXT NOT NULL UNIQUE      -- kebab-case summary + 4-char random suffix
status              TEXT                      -- candidate | reviewed | active | disabled | archived
type                TEXT NOT NULL DEFAULT 'hint'
                    -- directive | guard | hint | protocol (see Type taxonomy below)
summary             TEXT NOT NULL             -- >= 20 chars, no "..." suffix
problem             TEXT NOT NULL             -- >= 20 chars
solution            TEXT NOT NULL             -- >= 20 chars
toolNames           TEXT NOT NULL DEFAULT '[]'   -- JSON array, exact tool name match
commandPatterns     TEXT NOT NULL DEFAULT '[]'   -- JSON array of regex strings
pathPatterns        TEXT NOT NULL DEFAULT '[]'   -- JSON array of glob strings
commandMatchTarget  TEXT                      -- NULL | 'full' | 'executable'
modelPatterns       TEXT NOT NULL DEFAULT '[]'   -- JSON array of regex strings, AND-gated
scope               TEXT                      -- NULL = global; project-ID string = scoped
priority            INTEGER NOT NULL DEFAULT 5  -- 1-10
confidence          REAL NOT NULL DEFAULT 0.8   -- 0.0-1.0
tags                TEXT NOT NULL DEFAULT '[]'  -- JSON array of "category:value" strings
requires            TEXT                      -- NULL | JSON descriptor/array (inclusion guard)
duplicatedBy        TEXT                      -- NULL | JSON descriptor (exclusion guard)
```

### Type taxonomy

`type` is the single signal controlling injection behavior:

| Type        | Injection behavior                                            |
| ----------- | ------------------------------------------------------------- |
| `hint`      | Inject as `additionalContext` on PreToolUse match             |
| `guard`     | Deny the tool call entirely (block); message shown to agent   |
| `protocol`  | Inject at session start (protocol/reasoning reminders)        |
| `directive` | Inject at session start AND re-injected at context thresholds |

For `guard` lessons, the rendered message supports a `{command}` placeholder that is substituted
with the actual command (truncated to 120 chars) at block time.

### Key field constraints

| Field               | Constraint                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `summary`           | >= 20 chars, no `...` suffix, no template placeholders                                                   |
| `problem`           | >= 20 chars, no template placeholders                                                                    |
| `solution`          | >= 20 chars, no template placeholders                                                                    |
| `commandPatterns`   | Must be valid regex; invalid patterns are dropped (with a warning) at build time                         |
| `type = 'protocol'` | Use sparingly — fires on every session startup, no dedup within a session                                |
| `confidence`        | Below `minConfidence` → excluded from the manifest at build time                                         |
| `requires`          | Excludes the lesson from the manifest unless the named plugin/skill/mcp-server/github-issue is installed |
| `duplicatedBy`      | Excludes the lesson from the manifest when the named artifact IS installed                               |

---

## Lesson manifest (`lesson-manifest.json`)

Generated by `lessons build`. This is the file the injection hook reads at runtime.

```jsonc
{
  "type": "lessons-learned-manifest",
  "version": 1,
  "generatedAt": "2026-08-01T00:00:00Z",
  "config": {
    "injectionBudgetBytes": 4096,
    "maxLessonsPerInjection": 3,
    "minConfidence": 0.5,
    "minPriority": 1,
    "compactionReinjectionThreshold": 7,
  },
  "lessons": {
    "<ulid>": {
      "slug": "pytest-tty-hanging-k9m2",
      "type": "guard", // directive | guard | hint | protocol
      "priority": 8,
      "toolNames": ["Bash"],
      // Regex stored as { source, flags } for JSON-safe serialization
      // Reconstructed with new RegExp(source, flags) at match time
      "commandRegexSources": [{ "source": "\\bpytest\\b(?!...)", "flags": "" }],
      "commandMatchTarget": "executable",
      "pathRegexSources": [],
      "modelRegexSources": [],
      "tags": ["lang:python", "tool:pytest", "severity:hang"],
      "scope": null,
      "message": "## REQUIRED: pytest flags...",
      "summary": "pytest hangs in non-interactive envs due to TTY detection",
      "problem": "pytest attaches to a TTY by default...",
      "solution": "Run with --no-header...",
    },
  },
}
```

Lessons are excluded from the manifest if `confidence < minConfidence`, `priority < minPriority`,
a `duplicatedBy` artifact is detected as installed, or a `requires` artifact is NOT detected as
installed. `disabled`-status lessons are always excluded from matching regardless of these checks.

---

## Config (`config.json`)

```jsonc
{
  "injectionBudgetBytes": 4096, // Max bytes of additionalContext per tool call
  "maxLessonsPerInjection": 3, // Max lessons injected per tool call
  "minConfidence": 0.5, // Exclude lessons below this from manifest
  "minPriority": 1, // Exclude lessons below this from manifest
  "compactionReinjectionThreshold": 7, // Lessons above this priority re-inject after context compaction

  "scanPaths": ["~/.claude/projects/"],
  "autoScanIntervalHours": 24,
  "maxCandidatesPerScan": 50,

  "scoring": {
    "multiSessionBonus": 2, // Priority boost when seen in 2+ sessions
    "multiProjectBonus": 1, // Priority boost per additional project
    "hangTimeoutBonus": 1,
    "userCorrectionBonus": 1,
    "singleOccurrencePenalty": -1,
  },
}
```

---

## Candidate records (`lessons.db`, `status = 'candidate'`)

Candidates are ordinary rows in the `lessons` table with `status='candidate'` — there is no
separate candidate file. `node scripts/lessons.mjs scan aggregate` reads them and prints a ranked
JSON view to stdout (this replaced the old `scan candidates` name, which is now a deprecated
alias):

```jsonc
{
  "generatedAt": "2026-08-01T00:00:00Z",
  "totalCandidates": 1,
  "candidates": [
    {
      "index": 1, // 1-based position in THIS output only — not stored, not usable by any command
      "id": "01JQSEED00000000000000001", // the real, stable handle — use this with `promote --ids`
      "slug": "git-stash-untracked-5x3q",
      "tool": "Bash",
      "confidence": 0.85, // base confidence + 0.1 per extra project seen, capped at 1.0
      "priority": 7, // base priority + projectCount, capped at 10
      "occurrenceCount": 3,
      "sessionCount": 2,
      "projectCount": 1,
      "problem": "...",
      "solution": "...",
      "tags": [],
      "sourceSessionIds": ["..."],
      "createdAt": "...",
    },
  ],
}
```

To promote a candidate, use its `id` (not `index`): `node scripts/lessons.mjs promote --ids <id>`.
`scan promote <index>` has been removed — indexes are ephemeral (recomputed on every `aggregate`
call) and were never a safe handle for a follow-up command.

---

## Scan state (`scan-state.json`)

```jsonc
{
  "files": {
    "/abs/path/to/session.jsonl": 184320, // Last byte offset read
  },
  "lastFullScanAt": "2026-08-01T00:00:00Z",
}
```

The scanner resumes each file from its saved offset, processing only new bytes. A `--full` flag resets all offsets to 0.

---

## Tag taxonomy

Tags follow `category:value` format. Established categories:

| Category    | Examples                                                         |
| ----------- | ---------------------------------------------------------------- |
| `lang`      | `python`, `typescript`, `javascript`, `go`                       |
| `tool`      | `pytest`, `git`, `npm`, `docker`                                 |
| `severity`  | `hang`, `data-loss`, `silent-failure`, `error`                   |
| `topic`     | `testing`, `auth`, `networking`, `types`                         |
| `candidate` | `node-gotchas-skill` — flagged for future skill file aggregation |
