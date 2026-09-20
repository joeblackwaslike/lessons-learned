# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **`reminder` lesson type** — PostToolUse hook fires after a tool result returns, before the agent continues. Use for "you just did X, now do Y" mandatory next-step patterns. Matched via `toolNames` + `outputPatterns` (regex against tool output).
- **`outputPatterns` field** — regex array matched against `tool_response` stdout; compiled to `outputRegexSources` in manifest.
- **`cli` artifact type for `requires`** — lessons can now require a named CLI tool (`{"type":"cli","name":"no-mistakes"}`) to be installed before they fire.
- Eval scenarios TC-D2, TC-D11–D14, TC-G8–G12, TC-H62–H81 covering remaining directive, guard, and hint coverage gaps.

### Removed

- 13 hint/guard lessons retired as `CONTROL_CORRECT` after Sonnet re-evaluation (H62–H81 batch). Each scored correctly in the control arm without lesson injection. Recorded in `data/obsoleted-lessons.json`.

---

## [0.5.0] - 2026-08-31

### Added

- **`lessons backup` / `lessons restore --db`** — out-of-tree snapshot/restore for `lessons.db` using SQLite `VACUUM INTO`. A daily launchd LaunchAgent runs backup automatically on macOS.
- **Full-file dump guard** — blocks bare `cat`/`head`/`tail` calls that dump entire files into context (saves 6–8K tokens per incident).
- 11 new lessons from production incidents: 8 from a cc-recall quota incident (delegation anti-patterns, ghost sessions, session persistence flags), 2 PR-driving process guards, 1 paginated-read count guard.
- `fast-path exit` in PreToolUse hook — short-circuits when all hint matches for the current tool call are already in the dedup set.

### Changed

- **Heuristic scanner redesigned** — uses agent reasoning output as the problem source instead of raw tool call context. Produces more precise, actionable candidates.
- Session-start injection bounded: `sessionStartBudgetBytes` and `maxSessionStartLessons` caps now propagate to the compiled manifest.
- P10 search-before-planning directive scoped to implementation work only (was firing on every task including questions and explorations).

### Fixed

- **PostToolUse reinject runaway** — the directive-refresh hook was firing every 20 tool calls via a fallback path because `context_window.used_percentage` is never populated by the runtime. In a 1,193-tool session this produced 1.2 MB of duplicate injection. Hook removed; PostToolUse re-injection restored separately with a working context% source and per-session fire cap. See `docs/postmortems/2026-08-30-posttooluse-reinject-runaway.md`.
- Session-start hooks given missing timeouts (prevented hang on slow startup).
- `sessionStartBudgetBytes` / `maxSessionStartLessons` not propagating from config to manifest.
- Eval judge/probe/generation scripts migrated off meridian proxy to isolated `claude -p`.
- `ANTHROPIC_BASE_URL` no longer leaks from ambient env into deep-scan child process.
- 2 Bash tool-name-only lessons eliminated (were matching every Bash call, causing over-injection).

### Removed

- 3 narrow directive/protocol lessons disabled (context bloat reduction).

---

## [0.4.0] - 2026-06-26

### Added

- **Docusaurus 3.10.1 documentation site** (`website/`) — user guide, developer guide, architecture reference, PRDs, post-mortems, interactive `how-it-works.html` with D3 visualization.
- **GitHub Pages CI** (`docs.yml`) — deploys the site on every GitHub Release publication.
- **`claude-plugin` directive** — fires when agent uses the `claude plugin` CLI (install, update, list, etc.).
- `modelPatterns` AND-gate — fire a lesson only when the command/path matches a model-specific regex; use alongside `provider:X`/`model:X` tags for model-specific lessons. Doctor check added for missing AND-gates.

### Changed

- `AGENTS.md` promoted as canonical source of truth; `CLAUDE.md` imports via `@AGENTS.md`.
- Docs migrated from MkDocs to Docusaurus; old MkDocs config and requirements removed.
- Eval agent model pinned to `claude-sonnet-4-6` to prevent silent Opus fallback skewing results.

### Removed

- **30+ lessons archived** as `CONTROL_CORRECT` after a full Sonnet re-baseline (June 2026). Current models handle these mistakes without guidance. All archived lessons recorded in `data/obsoleted-lessons.json` for regression testing against other models (Codex, Gemini). Reversible via `lessons restore`.
- Anti-compact hook removed from this repo — deprecated in favor of the standalone `anti-compact` plugin.

---

## [0.3.0] - 2026-05-21

### Added

- **Eval framework** — promptfoo-based evaluation suite with a custom `claude-agent` provider, LLM judge, trajectory assertions, and 85 scenarios covering hints, guards, protocols, and directives. Results cached per-scenario; reproducible across runs.
- **Tier 4 LLM deep scan** (`scan --deep`) — uses Claude Haiku to extract typed lesson candidates from session transcripts. Fires automatically at session start when `ANTHROPIC_API_KEY` is set. Throttled; transcripts truncated to control cost.
- **`requires` field** — exclude a lesson from the compiled manifest unless the named artifact is installed. Supports plugin, MCP server, skill, and CLI tool types; supports OR-arrays (e.g. a tool that ships as both a plugin and an MCP server).
- **`duplicatedBy` field** — suppress a workaround lesson when the real fix is installed. Inverse of `requires`.
- **Serena MCP tool support** — PreToolUse injection hook fires on `mcp__serena__*` tool names.
- **PostToolUse directive re-injection** (PRD-005) — re-injects directives at 30%, 52%, and 70% context-window thresholds to counter context-pressure drift.
- **Subagent injection** (`subagent-start-lesson-protocol.mjs`) — injects directives into spawned subagents at their session start.
- **Compact session detection** — `session_type: compact` triggers protocol-only injection (reduces bloat during context compaction).
- `lessons preflight` — pre-PR gate: doctor checks + manifest freshness validation.
- `doctor` expanded to 10 meta-checks including staleness detection, temporal-language flags, and store-level coverage gaps.
- Intake validation added to `lessons add` (Jaccard similarity dedup, placeholder detection, gerund-trigger guard).

### Fixed

- Eval arms isolated with `CLAUDE_CONFIG_DIR` fake HOME to prevent hook cross-contamination between arms.
- 4 Edit/Write guard lessons demoted to hints (were hard-blocking all file edits indiscriminately).
- Edit/Write tool lessons content-gated to stop over-blocking and injection noise.
- PreToolUse hook now blocks via `permissionDecision: deny` instead of stdout+exit2 (correct hook protocol).
- Bare-word `commandPatterns` anchored at DB write layer to prevent substring false-positives.
- `snoowrap` guard rescoped; legacy bare-word patterns re-anchored.

---

## [0.2.0] - 2026-04-26

### Added

- **PreCompact handoff hook** — injects a structured context summary before Claude's context compaction fires, preserving reasoning continuity. Includes `HANDOFF_ONLY` mode and `/lessons:handoff` command.
- **Tier 3 structural scanner** — lexical pattern detection over semantic windows replaces the ANN/sqlite-vec approach. Results stored as pending windows, reviewed and promoted via `lessons windows`.
- **Session-start clustering** — `directive` and `protocol` lessons grouped by their primary tag before injection; section headers with purpose-specific framing (`## Non-Negotiable Directives` with `<IMPORTANT>` wrapper, `## Active Protocols` with coordination framing). Sorted by priority descending.
- **Citation fallback** — when a lesson's full body exceeds the remaining byte budget, injects a compact `summary / problem (first line) / solution (first line)` form instead of silently dropping the lesson.
- `/lessons:windows` — list and archive pending Tier 3 structural windows.
- `/lessons:review` groups candidates by primary tag with visual hierarchy and pagination.
- `CLAUDE_PLUGIN_ROOT` environment variable — enables portable command path resolution without hardcoded absolute paths.
- 4 new directives, generalized `community-solutions` lesson.
- Dolt exclusive lock hint; hook zombie process lesson from structural scan.

### Fixed

- Hook output label noise suppressed; `NODE_NO_WARNINGS` added to hook env.
- Semantic offset tracked independently from regular scan offset (fixes cross-contamination in incremental scans).
- Pre-commit hook uses `node_modules/.bin` path to avoid nvm PATH issue.
- TypeScript and ESLint errors from the April sprint resolved.
- `suppressOutput` removed from lesson injection — makes injection visible in Claude Code UI.
- Plugin command paths replaced hardcoded paths with `CLAUDE_PLUGIN_ROOT`.
- `plugin.json` manifest updated to register all new commands.

---

## [0.1.0] - 2026-04-06

Initial public release.

### Added

- **Lesson store** — SQLite-backed (`data/lessons.db`) as the authoritative source, compiled to `data/lesson-manifest.json` at build time. Never edited directly.
- **`#lesson` tag protocol** — emit structured `tool/trigger/problem/solution/tags` blocks in any response; scanner extracts them automatically.
- **Four lesson types**: `hint` (PreToolUse context injection), `guard` (PreToolUse block + warn), `protocol` (session-start, once), `directive` (session-start, always-on).
- **PreToolUse matching engine** — `toolNames` check first; then `commandPatterns`, `pathPatterns`; then scope filter. A lesson with patterns but no `toolNames` never fires.
- **`commandMatchTarget: "executable"`** — strips quoted strings before pattern matching so guards don't trigger on `--patch '{...}'` JSON arguments.
- **`scope` field** — restrict a lesson to one project via `cwd`-derived project ID.
- **`priority` and `confidence` fields** — control injection order and review thresholds.
- **Four scanning tiers**: Tier 1 (structured `#lesson` tags), Tier 2 (heuristic error→correction sliding window), Tier 3 (structural pattern matching), Tier 4 (LLM-assisted, requires API key).
- **`type` taxonomy** as the authoritative injection signal (replaces legacy boolean flags).
- Environment variable overrides for all configuration fields.
- `/lessons:doctor` — QA audit with 12 anti-pattern checks (dead triggers, weak problem/solution pairs, overbroad guards, invalid `requires`/`duplicatedBy`, coverage gaps).
- `/lessons:scope` — assign or inspect the project scope of a lesson.
- `/lessons:cancel` — cancel a `#lesson` tag emitted earlier in the session; `#lesson:cancel` scanner support.
- `/lessons:help` — numbered recipe shortcuts for common workflows.
- `/lessons:review` — candidate review pipeline with scope detection and automatic doctor run on completion.
- `/lessons:onboard` — interactive onboarding with modes, early exit, and resume.
- `toolNames: ["Bash"]` enforcement on all lessons with `commandPatterns` (25 lessons fixed at launch audit).

### Changed

- Schema field names: `mistake` → `problem`, `remediation` → `solution` throughout.
- 8 behavioral hint lessons reclassified as directives for always-on session-start injection.

---

[Unreleased]: https://github.com/joeblackwaslike/lessons-learned/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/joeblackwaslike/lessons-learned/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/joeblackwaslike/lessons-learned/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/joeblackwaslike/lessons-learned/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/joeblackwaslike/lessons-learned/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/joeblackwaslike/lessons-learned/releases/tag/v0.1.0
