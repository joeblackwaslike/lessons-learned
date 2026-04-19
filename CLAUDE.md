# lessons-learned

![GitHub last commit](https://img.shields.io/github/last-commit/joeblackwaslike/lessons-learned?style=flat-square&link=https%3A%2F%2Fgithub.com%2Fjoeblackwaslike%2Flessons-learned%2Fcommits%2Fmain%2F)

A Claude Code plugin that automatically captures reasoning, coding, and other mistakes and injects relevant lessons into the session and before tool calls to prevent recurrence. This plugin is the the result of countless hours spent iteratively refining claude. The goal is continuous learning to fortify agent behavior to prepare for autonomous long horizon sessions.

## Plugin Development

When working on or developing this plugin (modifying hooks, commands, skills, or plugin.json), load these before making any structural changes:

- `plugin-dev@claude-plugins-official` — canonical directory layout, manifest spec, hook wiring format, command frontmatter rules
- `skill-creator@claude-plugins-official` — skill description quality, progressive disclosure, trigger reliability, writing style

Also consult `docs/architecture/` for design context:

- `constitution.md` — stable principles governing lesson quality and injection philosophy (start here)
- `project.md` — mission, component map, and end-to-end pipeline overview
- `data-model.md` — lesson schema, manifest format, scan state, candidate format
- `testing-plan.md` — test strategy, unit/integration/E2E coverage targets
- `quality-checkd.md` -

## Architecture

```
hooks/                          # Claude Code hook handlers
  hooks.json                    # Hook wiring (SessionStart, PreToolUse, SubagentStart)
  pretooluse-lesson-inject.mjs  # Matches lessons against tool calls, injects context
  session-start-lesson-protocol.mjs  # Injects #lesson protocol + session-start lessons
  session-start-reset.mjs       # Clears per-session dedup state on reset
  session-start-scan.mjs        # Fires background scan on startup
  precompact-handoff.mjs        # PreCompact hook: context banner or handoff generation
  subagent-start-lesson-protocol.mjs
  lib/                          # Hook shared utilities (dedup, output, matching)

scripts/
  lessons.mjs                   # The only CLI entry point — all management subcommands
  scanner/                      # Lesson scanning library (structured + heuristic)

data/
  lessons.db                    # SQLite source of truth — all lessons and candidates
  lesson-manifest.json          # Pre-compiled runtime manifest (generated, don't edit)
  config.json                   # Injection and scanning configuration
  scan-state.json               # Byte offsets for incremental scanning (generated)
```

## CLI

All management goes through one entry point:

```bash
node scripts/lessons.mjs <subcommand> [options]
```

| Subcommand       | Purpose                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `add`            | Add a new lesson (interactive, `--json`, `--file`, or stdin)            |
| `build`          | Rebuild `lesson-manifest.json` from the DB (`lessons.db`)               |
| `edit`           | Edit a lesson field in-place (`--id <id> --patch '{"field":"value"}'}`) |
| `list`           | List all lessons with patterns and metadata                             |
| `onboard`        | Interactive onboarding for the lesson system                            |
| `promote`        | Promote candidates to active, archive, or patch fields (`--ids`)        |
| `review`         | Review candidates against validation rules, grouped by tag              |
| `scan`           | Incrementally scan session logs for new candidates                      |
| `scan aggregate` | List ranked candidates from the DB (JSON output)                        |

Run any subcommand with `--help` for full options.

## Lesson store

All lessons are stored in `data/lessons.db` (SQLite). Use the CLI to make changes — never edit the DB directly. After any structural change run:

```bash
node scripts/lessons.mjs build
```

To edit a lesson field:

```bash
node scripts/lessons.mjs edit --id <id> --patch '{"fieldName": "value"}'
```

Key lesson fields:

| Field                | Description                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `summary`            | One-line description shown in injection output (≤80 chars)                                                                                           |
| `problem`            | What went wrong and why                                                                                                                              |
| `solution`           | The correction                                                                                                                                       |
| `type`               | `hint` (inject as context), `guard` (block + warn), `protocol` (session-start), `directive` (always-on protocol)                                     |
| `toolNames`          | **Required.** Exact tool name match — lesson never fires without this                                                                                |
| `commandPatterns`    | Regex array matched against Bash commands                                                                                                            |
| `pathPatterns`       | Glob array matched against Read/Edit/Write file paths                                                                                                |
| `commandMatchTarget` | `"full"` (default) or `"executable"` — executable strips quoted strings before matching, preventing guards from triggering on `--patch '...'` values |
| `scope`              | `null` = global (default), `"<project-id>"` = this project only                                                                                      |
| `priority`           | Integer, higher = injected first (default 5)                                                                                                         |
| `confidence`         | Float 0–1, controls review threshold (default 0.8)                                                                                                   |
| `tags`               | Array of `category:value` tags for classification                                                                                                    |

**Patchable fields** (usable with `edit --patch`):
`summary`, `problem`, `solution`, `type`, `scope`, `toolNames`, `commandPatterns`, `commandMatchTarget`, `pathPatterns`, `priority`, `confidence`, `tags`

**Valid canonical toolNames** (exact casing required — mismatched casing silently never fires):
`Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Agent`, `TodoWrite`, `WebFetch`, `WebSearch`

## Intake validation rules

`lessons add` enforces these before writing:

- `summary`, `problem`, `solution` each ≥ 20 chars
- No unfilled template placeholders (`<what_went_wrong>` etc.)
- Summary must not end with `...` (truncation indicator)
- Trigger must not be a prose gerund (e.g. "running pytest")
- Jaccard similarity of `problem` vs all existing lessons must be < 0.5

## Injection mechanics

`matchLessons()` in `core/match.mjs` runs at every PreToolUse. The matching order is:

1. **`toolNames` check first** — if the lesson's `toolNames` array doesn't include the current tool name, the lesson is skipped entirely. **A lesson with `commandPatterns` or `pathPatterns` but no `toolNames` can never fire.**
2. `commandPatterns` tested against the command string (or the executable-only portion if `commandMatchTarget: "executable"`)
3. `pathPatterns` tested against the file path argument
4. `scope` filter — scoped lessons only match when `cwd`-derived project ID matches

`protocol` and `directive` lessons bypass step 1–4 entirely — they inject at session start regardless of tool calls.

## Lesson type behavior

| Type        | When injected                 | Effect                                     |
| ----------- | ----------------------------- | ------------------------------------------ |
| `hint`      | PreToolUse — on trigger match | Prepends warning to Claude's context       |
| `guard`     | PreToolUse — on trigger match | Blocks the tool call + injects reason      |
| `protocol`  | SessionStart                  | Injected once at session start             |
| `directive` | SessionStart                  | Always-on, higher priority than `protocol` |

Guards should always set `commandMatchTarget: "executable"` to avoid matching trigger words inside `--patch '...'` JSON arguments or other quoted strings.

## Injection behaviors

**Citation fallback**: When a lesson's full body exceeds the remaining byte budget, injection falls back to a compact citation format instead of dropping the lesson entirely:

```
**Lesson**: <summary>
**Problem**: <problem, first line, capped 200 chars>
**Solution**: <solution, first line, capped 200 chars>
```

**Session-start clustering**: `directive` and `protocol` lessons are grouped by their first tag before injection. When multiple tag groups exist, a `### <tag>` header precedes each group. Alphabetical order, with untagged lessons last. Single-group outputs have no headers.

**Review grouping**: `lessons review` groups candidates by first tag with `── <tag> (<count>) ─────` headers, sorted alphabetically with `(untagged)` last.

**PreCompact handoff** (`/lessons:handoff`): Intercepts `/compact` to generate a session handoff summary. Three modes:

- No env var set: emits a context-capacity warning banner, allows compaction
- `LESSONS_PRECOMPACT_HANDOFF=1`: generates handoff, blocks compaction (exit 2)
- On-demand via `/lessons:handoff` command: generates handoff, allows compaction

## `#lesson` tag format

Emit this in any response when you discover a problem→solution sequence:

```text
#lesson
tool: Bash
trigger: git stash
problem: git stash silently omits untracked files, risking data loss
solution: Use `git stash -u` to include untracked files
tags: tool:git, severity:data-loss
#/lesson
```

Optional `scope: project` field restricts the lesson to the current project (omit for global):

```text
#lesson
tool: Bash
trigger: just test
problem: just recipe leaks env vars into sub-shells
solution: Use `just --set KEY val` instead of export
tags: tool:just
scope: project
#/lesson
```

To retroactively cancel a lesson tag emitted earlier in the same session:

```text
#lesson:cancel
problem: first ~60 chars of the problem field to cancel
#/lesson:cancel
```

Use `/lessons:cancel` for an interactive cancel workflow (also handles DB records).

## Project scope

Project ID is derived from `~/.claude/projects/<folder>` — the folder name is the absolute project path with `/` replaced by `-` and the leading `-` stripped. The hook derives it from `cwd` at inject time; the scanner derives it from the session file path.

```js
// How projectId is computed from cwd:
cwd.replace(/\//g, '-').replace(/^-/, '');
// e.g. /Users/joe/github/foo → Users-joe-github-foo
```

## Two-tier scanning

- **Tier 1 (structured)**: extracts `#lesson … #/lesson` tags emitted by Claude during sessions → stored as `candidate`
- **Tier 2 (heuristic)**: sliding-window pattern detection for error→correction sequences → stored as `candidate`

**Scan timing**: the background scan fires at **session start** (not end). JSONL files from previous sessions are processed; the **current session's JSONL is not scanned until the next session starts**. Lessons emitted this session are invisible to the DB until then — use `/lessons:cancel` with `#lesson:cancel` markers to suppress them before they land.

Both tiers write to `candidate` status. Use `/lessons:review` to promote candidates to `active`.

## Do not edit

- `data/lesson-manifest.json` — generated by `lessons build`, always regenerate instead of hand-editing
- `data/scan-state.json` — byte offsets for incremental scanning

## Running Tests

```bash
node --test 'tests/**/*.test.mjs'               # all tests
node --test 'tests/unit/**/*.test.mjs'          # unit only (fast, no I/O)
node --test 'tests/integration/**/*.test.mjs'   # integration only
node --test 'tests/e2e/**/*.test.mjs'           # E2E cross-agent only
node --test --experimental-test-coverage 'tests/**/*.test.mjs'  # with coverage
```

Or via npm scripts: `npm test`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`.

Test isolation uses env vars — tests never touch `data/`:

- `LESSONS_MANIFEST_PATH` — override manifest for hook subprocess tests
- `LESSONS_DATA_DIR` — override data directory for CLI and scan tests
- `LESSONS_AGENT_PLATFORM` — set to `codex` or `gemini` for cross-agent E2E tests

## package.json scripts

| Script            | Command                          |
| ----------------- | -------------------------------- |
| `npm run lessons` | `node scripts/lessons.mjs`       |
| `npm run build`   | `node scripts/lessons.mjs build` |
| `npm run scan`    | `node scripts/lessons.mjs scan`  |
| `npm test`        | Run all tests                    |

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->

## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**

- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
