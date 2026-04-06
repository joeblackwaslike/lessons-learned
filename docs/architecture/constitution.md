# lessons-learned — Project Constitution

> Stable principles that apply to every feature, lesson, and implementation decision in this repository. When something here conflicts with a one-off spec, the constitution wins unless explicitly amended.

**Version:** 1.0.0 | **Ratified:** 2026-04-01

---

## Mission

Prevent Claude from repeating the same mistakes across sessions by automatically capturing error→correction sequences and injecting the relevant lesson before the next tool call that would trigger the same mistake.

---

## Core Principle

**Lessons are injected, not enforced.**

The plugin adds context to Claude's reasoning — it never blocks tool calls except in explicitly designated cases where a command is known to be destructive and the block is the lesson. Claude remains in control; the plugin informs.

---

## Lesson Quality Bar

A lesson earns a place in the store only if:

1. **It is specific.** Vague lessons ("be careful with git") have no trigger and inject into every session. A lesson must describe an exact mistake with an exact fix.
2. **It is actionable.** The remediation must be something Claude can do differently right now — not an observation, not a principle, not a recommendation to "check the docs."
3. **It has a trigger.** Almost every lesson must have a `commandPattern`, `pathPattern`, or `toolName` that scopes when it fires. Session-start injection is reserved for reasoning-level reminders that have no natural trigger.
4. **It is not a duplicate.** Jaccard similarity ≥ 0.5 against existing lessons disqualifies a new lesson. Update the existing lesson instead.
5. **It clears intake validation.** Minimum field lengths, no unfilled template placeholders, no prose gerunds as triggers.

---

## Injection Philosophy

**Inject at the point of relevance, not on every turn.**

- `commandPatterns` — fires when a Bash command matches, immediately before execution
- `pathPatterns` — fires when a file path is read, edited, or written
- `toolNames` — fires on any use of a specific tool (broad; use sparingly)
- `sessionStart: true` — fires once per session startup; reserved for reasoning reminders with no valid trigger

**Budget discipline:** At most 3 lessons per tool call, capped at 4KB total injection. High-priority lessons displace low-priority ones. Each lesson is injected at most once per session (dedup by slug).

**Blocking is exceptional.** `block: true` on a lesson denies the tool call entirely. This is reserved for commands with known data-loss or irreversible consequences where the lesson _is_ the prevention. Use it rarely and deliberately.

---

## Lesson Scope

Lessons have a scope that determines where they are injected:

- **Global** (`scope.type: 'global'`): injected in any project. Appropriate for tool-level mistakes that apply universally (git, pytest, TypeScript, etc.).
- **Project-specific** (`scope.type: 'project'`): injected only when the hook's `cwd` is within a specific project path. Appropriate for mistakes tied to a project's specific conventions, stack, or architecture.

**How scope is determined:** The scanner tracks which project directory each candidate originated from. A candidate observed in only one project is a project-specific candidate. A candidate observed in two or more projects is a global candidate. This is not a manual classification — it is a direct output of the cross-project scan.

---

## Scanning Tiers

**Tier 1 (structured):** Claude emits `#lesson … #/lesson` tags when it recognizes a mistake during a session. These are high-fidelity candidates — authored by Claude in the moment of correction, with structured fields. Tier 1 candidates auto-promote on interactive scan.

**Tier 2 (heuristic):** Sliding-window pattern detection over session JSONL files, looking for error→correction sequences in tool results and assistant messages. Lower fidelity — requires human review via `lessons scan promote` before entering the store.

---

## What Belongs in the Store vs. CLAUDE.md

| Content                                    | Where                         |
| ------------------------------------------ | ----------------------------- |
| Repeatable mistake with a specific trigger | Lesson store (`lessons.json`) |
| One-time setup note or project convention  | `CLAUDE.md`                   |
| Reasoning reminder with no trigger         | `sessionStart: true` lesson   |
| Architectural decision or constraint       | `docs/architecture/`          |

Do not put lessons in `CLAUDE.md`. CLAUDE.md is loaded on every session unconditionally — it has no trigger awareness and cannot be deduped. Lessons in the wrong place become noise.

---

## Non-Goals

- **No LLM in the pipeline.** Lesson evaluation uses deterministic rules only (validation, Jaccard similarity, content hash). No API calls to score or rewrite candidates.
- **No per-user or per-team lesson stores.** The store is per-installation. Multi-user sharing is not in scope.
- **No telemetry.** No usage data leaves the local machine.
- **No lesson authoring UI.** The CLI (`lessons.mjs`) is the interface. A GUI would add surface area without improving quality.
- **No automatic promotion of Tier 2 candidates in background mode.** The `--auto` background scan never auto-promotes — only interactive scans with explicit human review do.
