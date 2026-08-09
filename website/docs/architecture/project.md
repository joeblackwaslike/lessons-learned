---
sidebar_position: 2
title: Project Overview
description: Mission, component map, and end-to-end pipeline overview for the lessons-learned plugin.
---

# Project Overview

**Last updated:** 2026-08-08

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
  hooks.json                          Hook wiring — SessionStart, PreToolUse, PostToolUse, PreCompact, SubagentStart
  pretooluse-lesson-inject.mjs        Main injection pipeline (6 stages)
  posttooluse-directive-reinject.mjs  Re-injects directive lessons at context-usage thresholds
  session-start-lesson-protocol.mjs   Injects #lesson protocol + session-start lessons
  session-start-reset.mjs             Clears per-session dedup state on clear/compact
  session-start-scan.mjs              Fires background scan on startup (fire-and-forget)
  precompact-handoff.mjs              Optional: blocks /compact to generate a session handoff
  subagent-start-lesson-protocol.mjs  Protocol injection for subagents
  lib/
    dedup.mjs                         3-layer dedup (env var, temp file, O_EXCL lock)
    output.mjs                        JSON output formatter for hook responses
    normalize-tool.mjs                Maps Codex/Gemini tool names to canonical CC names
    stdin.mjs                         Hook stdin payload parsing
    session-start.mjs                 Shared SessionStart/SubagentStart injection logic
    precompact.mjs                    Transcript parsing for handoff generation

core/
  match.mjs                           Lesson matching (command regex, path glob, tool name, scope)
  select.mjs                          Budget-aware selection and citation-fallback rendering

scripts/
  lessons.mjs                         Single CLI entry point — all management subcommands
  scanner/
    structured.mjs                    Tier 1: parses #lesson tags from JSONL lines
    detector.mjs                      Tier 2: sliding-window heuristic detection
    structural.mjs                    Tier 3: lexical pattern detection over semantic windows
    embedder.mjs                      Tier 3: Ollama embedding wrapper for near-duplicate detection
    deep-scan.mjs                     Tier 4: LLM-assisted extraction (requires ANTHROPIC_API_KEY)
    extractor.mjs                     Extracts normalized candidates from all tiers
    incremental.mjs                   Byte-offset state for incremental file scanning

data/
  lessons.db                          Source of truth — all lesson and candidate records (SQLite)
  lesson-manifest.json                Pre-compiled runtime manifest (generated)
  config.json                         Injection and scanning configuration
  scan-state.json                     Per-file byte offsets for incremental scanning
  obsoleted-lessons.json              Append-only ledger of lessons the model has outgrown
  lesson-sources.json                 External lesson libraries consulted for seed content
```

---

## End-to-End Pipeline

### Capture (session → candidate)

1. Claude makes a mistake and corrects it during a session.
2. Claude emits a `#lesson … #/lesson` tag in its response (Tier 1, structured).
   — OR —
   The heuristic detector observes a tool-result error followed by a corrected assistant response (Tier 2).
   — OR —
   The structural (Tier 3) or LLM-assisted deep scan (Tier 4, requires `ANTHROPIC_API_KEY`) detects a pattern the first two tiers miss.
3. On the next session startup, `session-start-scan.mjs` fires and spawns `lessons.mjs scan --auto` as a detached background process.
4. The scanner reads JSONL files incrementally (resuming from saved byte offsets), extracts candidates, and writes them to `lessons.db` with `status='candidate'`.

### Promotion (candidate → lesson)

**Tier 1:** Interactive scan (`lessons scan`) auto-promotes structured candidates that pass intake validation and are not fuzzy duplicates.

**Tier 2+:** Human review via `/lessons:review` (conversational) or `node scripts/lessons.mjs scan aggregate` to list candidates followed by `node scripts/lessons.mjs promote --ids <id>` to promote one. The lesson row's `status` flips to `active` and the manifest is rebuilt.

### Injection (lesson → context)

When Claude invokes a tool, `pretooluse-lesson-inject.mjs` runs:

1. **Parse** the hook payload — tool name, command, file path, session ID.
2. **Load** `lesson-manifest.json` (pre-compiled, fast).
3. **Match** lessons against the tool call — command regex, path glob, exact tool name, model-pattern AND-gate, and project scope.
4. **Score and cap** — sort by priority, apply the injection budget (default: 3 lessons / 4 KB).
5. **Dedup** — skip slugs already injected this session (3-layer: env var → temp file → O_EXCL lock).
6. **Output** — emit `{ hookSpecificOutput: { additionalContext: "..." } }` for Claude to receive as pre-tool context, or a block decision for `guard` lessons.

### Session start

On `startup`, `resume`, `clear`, and `compact`, `session-start-reset.mjs` and `session-start-lesson-protocol.mjs` fire — the reset hook clears dedup state, and the protocol hook injects the `#lesson` reporting protocol and any session-start lessons. `session-start-scan.mjs` additionally fires on `startup` only, spawning the background scan.

---

## Lesson Scope

Every lesson has a `scope` column:

| Scope            | Value                                             | Injected when                                         |
| ---------------- | ------------------------------------------------- | ----------------------------------------------------- |
| Global           | `null`                                            | Any project, any session                              |
| Project-specific | a project-ID string (e.g. `Users-joe-github-foo`) | Only when hook `cwd` derives to a matching project ID |

**How scope is assigned:** Scope is not automatically inferred from `projectCount` at promotion time for every lesson — `/lessons:review` performs scope detection when promoting scanned candidates, and `/lessons:scope` can retroactively scope an already-active (typically manually-added) lesson that appears project-specific. Project-specific lessons live in the same `lessons.db` store as global ones, identified by the `scope` column, and are filtered at injection time based on `cwd`.

---

## Scanning Tiers

| Tier            | Source                                                 | Fidelity                               | Promotion                                             |
| --------------- | ------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------- |
| T1 (structured) | `#lesson` tags emitted by Claude                       | High — Claude authored them            | Auto-promote on interactive scan                      |
| T2 (heuristic)  | Sliding-window error→correction detection              | Medium — pattern-matched, may be noisy | Manual review via `/lessons:review` / `promote --ids` |
| T3 (structural) | Lexical pattern detection over semantic windows        | Medium — needs human triage            | Reviewed via `windows` subcommand                     |
| T4 (deep scan)  | LLM-assisted extraction (requires `ANTHROPIC_API_KEY`) | High, but API-cost-gated               | Manual review via `/lessons:review` / `promote --ids` |

All tiers write to `lessons.db` with `status='candidate'`.

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

See the [Configuration Reference](../reference/configuration.md) for the full field list, including scan and scoring settings.

---

## Design Decisions

**One manifest, not per-project files.** All lessons — global and project-specific — live in a single `lessons.db` and compile to a single `lesson-manifest.json`. Per-project lesson files would require the hook to discover and merge them at runtime, adding latency and complexity.

**Deterministic by default, LLM-assisted as an opt-in tier.** Tier 1/2 candidate evaluation is fully deterministic (field length, placeholder detection, Jaccard similarity), keeping the default pipeline fast, offline-capable, and free of API costs. Tier 4 deep scan is the one LLM-dependent stage, gated behind `ANTHROPIC_API_KEY` being set — it never runs by default.

**Fire-and-forget scan.** The background scan spawns a detached child process and immediately unrefs it so the hook returns instantly. Session startup latency is not affected by scan duration.

**3-layer dedup.** The injection dedup uses an env var (fastest, in-process), a temp file (survives subagent boundaries), and an O_EXCL file lock (prevents race conditions with parallel tool calls). Each layer is a fallback for the previous.
