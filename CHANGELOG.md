# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **Context Anti-Compact (beta)** — new `PreCompact` hook that intercepts `/compact` before it runs, generates a structured session handoff via `claude -p`, and blocks compaction (exit code 2). Preserves full session context in a copyable handoff prompt rather than allowing lossy built-in compression. Opt-in via `LESSONS_PRECOMPACT_HANDOFF=1`. Falls back to structured extraction (active issues, recent commits, conversation entries) if `claude -p` is unavailable. See [Context Anti-Compact](docs/user-guide/anti-compact.md) for details.
- **Differentiated session-start preambles** — directives and protocols now inject under distinct section headers with purpose-specific framing. Directives appear under `## Non-Negotiable Directives` with an `<IMPORTANT>` wrapper. Protocols appear under `## Active Protocols` with coordination-pattern framing. Both are sorted by priority descending.

### Changed

- Beads issue prefix renamed from `lessons-learned` to `ll` for shorter references in session context.

### Removed

- **Archived 5 model-obsolete lessons** — an eval re-baseline (2026-06-16) confirmed current models (Opus 4.x generation, `claude-sonnet-4-6`) no longer make these mistakes: `git stash` untracked-file loss, `xargs` word-splitting on spaces, unquoted bash `[[ ]]` comparisons, `pip install` targeting the wrong virtualenv, and `mock.patch` namespace targeting. Each scored **`CONTROL_CORRECT`** in the eval — the control agent (no lesson) avoided the failure on its own; `xargs` stayed correct even under an adversarial prompt designed to provoke it. This is the lesson system working as intended: pruning guidance that newer models have internalized, so injection stays focused on mistakes models _still_ make. Reversible (`lessons restore`), and recorded in [`data/obsoleted-lessons.json`](data/obsoleted-lessons.json) for re-testing against other models (Codex, Gemini). See [Pruning Obsolete Lessons](docs/developer-guide/pruning-obsolete-lessons.md).

---

[Unreleased]: https://github.com/joeblackwaslike/lessons-learned/compare/HEAD...HEAD
