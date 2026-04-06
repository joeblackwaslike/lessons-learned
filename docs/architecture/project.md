# Project Overview

**Last updated:** 2026-04-01

---

## Mission

Prevent Claude from repeating the same mistakes across sessions. The plugin captures error→correction sequences automatically, stores them as structured lessons, and injects the relevant lesson as `additionalContext` before the next tool call that would trigger the same mistake.

---

## Problem Statement

Claude Code sessions are stateless. A mistake corrected in one session — wrong flag, wrong namespace, wrong tool invocation — will be repeated identically in the next session because nothing persists the correction. The user ends up re-correcting the same class of errors repeatedly, paying a turn cost every time.

The gap this plugin fills:

- **Automatic capture.** Claude emits structured `#lesson` tags when it recognizes a mistake. The scanner harvests these across all session files without manual intervention.
- **Scoped injection.** Lessons fire at the point of relevance — when the matching command, file path, or tool is invoked — not on every turn. A pytest lesson only injects when Claude is about to run pytest.
- **Cross-session memory without conversation context.** The manifest is loaded by hooks, not by Claude's context window. Lessons survive context compaction, new sessions, and model upgrades.

---

## Component Map

```
hooks/
  hooks.json                         Hook wiring — SessionStart, PreToolUse, SubagentStart
  pretooluse-lesson-inject.mjs       Main injection pipeline (6 stages)
  session-start-lesson-protocol.mjs  Injects #lesson protocol + sessionStart lessons
  session-start-reset.mjs            Clears per-session dedup state on clear/compact
  session-start-scan.mjs             Fires background scan on startup (fire-and-forget)
  subagent-start-lesson-protocol.mjs Protocol injection for subagents
  lib/
    dedup.mjs                        3-layer dedup (env var, temp file, O_EXCL lock)
    output.mjs                       JSON output formatter for hook responses
    matcher.mjs                      Lesson matching (command regex, path glob, tool name)

scripts/
  lessons.mjs                        Single CLI entry point — all management subcommands
  scanner/
    structured.mjs                   Tier 1: parses #lesson tags from JSONL lines
    detector.mjs                     Tier 2: sliding-window heuristic detection
    extractor.mjs                    Extracts normalized candidates from both tiers
    incremental.mjs                  Byte-offset state for incremental file scanning

data/
  lessons.json                       Source of truth — full lesson records
  lesson-manifest.json               Pre-compiled runtime manifest (generated)
  config.json                        Injection and scanning configuration
  cross-project-candidates.json      T2 scan candidates awaiting review
  scan-state.json                    Per-file byte offsets for incremental scanning
```

---

## End-to-End Pipeline

### Capture (session → candidate)

1. Claude makes a mistake and corrects it during a session.
2. Claude emits a `#lesson … #/lesson` tag in its response (Tier 1, structured).
   — OR —
   The heuristic detector observes a tool-result error followed by a corrected assistant response (Tier 2).
3. On the next session startup, `session-start-scan.mjs` fires and spawns `lessons.mjs scan --auto` as a detached background process.
4. The scanner reads JSONL files incrementally (resuming from saved byte offsets), extracts candidates, and writes them to `cross-project-candidates.json`.

### Promotion (candidate → lesson)

**Tier 1:** Interactive scan (`lessons scan`) auto-promotes structured candidates that pass intake validation and are not fuzzy duplicates.

**Tier 2:** Human review via `lessons scan promote <index>`. The user supplies a summary and command pattern; the lesson is written to `lessons.json` and the manifest is rebuilt.

### Injection (lesson → context)

When Claude invokes a tool, `pretooluse-lesson-inject.mjs` runs:

1. **Parse** the hook payload — tool name, command, file path, session ID.
2. **Load** `lesson-manifest.json` (pre-compiled, fast).
3. **Match** lessons against the tool call — command regex, path glob, exact tool name.
4. **Score and cap** — sort by priority, apply 3-lesson / 4KB budget.
5. **Dedup** — skip slugs already injected this session (3-layer: env var → temp file → O_EXCL lock).
6. **Output** — emit `{ hookSpecificOutput: { additionalContext: "..." } }` for Claude to receive as pre-tool context.

### Session start

On `startup`, two hooks fire sequentially:

- `session-start-reset.mjs` clears the dedup state file for the new session.
- `session-start-lesson-protocol.mjs` injects the `#lesson` reporting protocol and any `sessionStart: true` lessons (reasoning reminders with no trigger).

On `clear` or `compact`, only the reset hook fires (no new scan, no protocol re-injection).

---

## Lesson Scope

Every lesson has a `scope` field:

| Scope            | Value                                    | Injected when                                   |
| ---------------- | ---------------------------------------- | ----------------------------------------------- |
| Global           | `{ type: 'global' }`                     | Any project, any session                        |
| Project-specific | `{ type: 'project', path: '/abs/path' }` | Only when hook `cwd` is within the project path |

**How scope is assigned:** The scanner tracks `projectCount` per candidate — the number of distinct project directories where the pattern was observed. `projectCount >= 2` → global. `projectCount === 1` → project-specific. This is not a manual classification; it is derived from scan data.

Project-specific lessons live in the same global `lessons.json` store, identified by scope. They are included in the manifest and filtered at injection time based on `cwd`.

---

## Scanning Tiers

| Tier            | Source                                    | Fidelity                               | Promotion                                |
| --------------- | ----------------------------------------- | -------------------------------------- | ---------------------------------------- |
| T1 (structured) | `#lesson` tags emitted by Claude          | High — Claude authored them            | Auto-promote on interactive scan         |
| T2 (heuristic)  | Sliding-window error→correction detection | Medium — pattern-matched, may be noisy | Manual review via `lessons scan promote` |

T2 candidates require `sessionCount >= 2` to surface as cross-project (global) candidates. Single-session T2 candidates surface only via `lessons scan candidates --project`.

---

## Configuration

`data/config.json` controls:

| Field                            | Default | Purpose                                                 |
| -------------------------------- | ------- | ------------------------------------------------------- |
| `injectionBudgetBytes`           | 4096    | Max total bytes injected per tool call                  |
| `maxLessonsPerInjection`         | 3       | Max lessons per tool call                               |
| `minConfidence`                  | 0.5     | Lessons below this are excluded from manifest           |
| `minPriority`                    | 1       | Lessons below this are excluded from manifest           |
| `compactionReinjectionThreshold` | 7       | Priority above which lessons re-inject after compaction |

---

## Design Decisions

**One manifest, not per-project files.** All lessons — global and project-specific — live in a single `lessons.json` and compile to a single `lesson-manifest.json`. Per-project lesson files would require the hook to discover and merge them at runtime, adding latency and complexity.

**No LLM in the pipeline.** Candidate evaluation is fully deterministic (field length, placeholder detection, Jaccard similarity). This keeps the pipeline fast, offline-capable, and free of API costs.

**Fire-and-forget scan.** The background scan spawns a detached child process and immediately unrefs it so the hook returns instantly. Session startup latency is not affected by scan duration.

**3-layer dedup.** The injection dedup uses an env var (fastest, in-process), a temp file (survives subagent boundaries), and an O_EXCL file lock (prevents race conditions with parallel tool calls). Each layer is a fallback for the previous.
