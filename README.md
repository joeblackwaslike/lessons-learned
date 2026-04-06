# lessons-learned

A Claude Code plugin that automatically captures coding mistakes from session logs and injects relevant lessons as context before tool calls — preventing the same mistakes from happening twice.

[![CI](https://github.com/joeblackwaslike/lessons-learned/actions/workflows/ci.yml/badge.svg)](https://github.com/joeblackwaslike/lessons-learned/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## How it works

**Capture** — During sessions, Claude emits structured `#lesson` tags when it makes and corrects a mistake. A background scanner also detects error→correction patterns heuristically from session logs.

**Inject** — Before every `Bash`, `Read`, `Edit`, `Write`, or `Glob` tool call, the `PreToolUse` hook matches the command or file path against the lesson store and injects up to 3 relevant lessons as `additionalContext`. At session start, the `#lesson` protocol format is injected so Claude knows how to emit new lessons.

**Loop** — New lessons flow from session logs back into the store via `lessons scan` and `lessons add`, tightening the feedback loop over time.

```
Session log  ──scan──►  candidates  ──review──►  lessons.json
                                                       │
                                                  lessons build
                                                       │
                                               lesson-manifest.json
                                                       │
tool call  ──PreToolUse hook──►  match  ──inject──►  additionalContext
```

## Features

### Core pipeline

| Feature                                                                                                                                                                               | Status     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **PreToolUse injection hook** — 6-stage match→dedup→select→inject pipeline fires before every `Bash`, `Read`, `Edit`, `Write`, `Glob` call                                            | ✅ Shipped |
| **Negative-lookahead patterns** — patterns like `\bpytest\b(?!.*(--no-header))` suppress injection when the fix is already applied                                                    | ✅ Shipped |
| **Injection budget** — configurable byte cap (default 4 KB) and lesson cap (default 3) per hook call, with `summary` fallback if a lesson exceeds remaining budget                    | ✅ Shipped |
| **Manifest pre-compilation** — `lesson-manifest.json` pre-compiles all regex sources and pre-renders injection text; the hot-path hook does zero file I/O beyond loading the manifest | ✅ Shipped |
| **Tool call blocking** — lessons can set `block: true` to deny the tool call entirely with a reason, not just warn                                                                    | ✅ Shipped |

### Dedup and session management

| Feature                                                                                                                                                                                | Status     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **3-layer dedup** — env var (`LESSONS_SEEN`) + session temp file + `O_EXCL` claim directory; each lesson injected at most once per session even with parallel subagents                | ✅ Shipped |
| **Context compaction re-injection** — high-priority lessons (≥ threshold, default 7) are cleared from dedup on `compact` events so they re-inject after Claude's context is summarized | ✅ Shipped |
| **Session reset** — all dedup state wiped on `clear` events                                                                                                                            | ✅ Shipped |

### Lesson discovery

| Feature                                                                                                                                                                                                | Status     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| **Tier 1 scanner** — structured `#lesson … #/lesson` tag parsing from session JSONL; simple regex grep, ~95% accuracy, ~200ms full scan                                                                | ✅ Shipped |
| **Tier 2 scanner** — heuristic sliding-window detection of error→correction sequences for historical sessions and compliance gaps                                                                      | ✅ Shipped |
| **Incremental scanning** — byte-offset tracking per file; only processes new data since last scan; constant ~1 MB memory regardless of log file size                                                   | ✅ Shipped |
| **Confidence + priority scoring** — composite scores from observable signals (multi-session, multi-project, hang/data-loss severity, user correction); low-confidence candidates flagged `needsReview` | ✅ Shipped |
| **Background scan on startup** — `session-start-scan.mjs` fires a background incremental scan on every session startup                                                                                 | ✅ Shipped |

### Session start protocol

| Feature                                                                                                                                                                 | Status     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **`#lesson` self-reporting protocol** — SessionStart hook injects a standing instruction so Claude emits structured `#lesson` tags when it makes and corrects a mistake | ✅ Shipped |
| **Subagent protocol injection** — SubagentStart hook ensures spawned subagents also receive the `#lesson` format instruction                                            | ✅ Shipped |
| **Session-start lessons** — lessons tagged `sessionStart: true` (e.g. cross-cutting reminders) are injected at session start rather than per-tool-call                  | ✅ Shipped |

### CLI management

| Feature                                                                                                                                               | Status     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **`lessons add`** — add lessons interactively, from `--json`, `--file`, or stdin with full intake validation (length, no placeholders, Jaccard dedup) | ✅ Shipped |
| **`lessons build`** — compile `lessons.json` → `lesson-manifest.json` with pre-compiled regex and pre-rendered injection text                         | ✅ Shipped |
| **`lessons list`** — list lessons with patterns, confidence, priority, and tags                                                                       | ✅ Shipped |
| **`lessons scan`** — incremental scan of session logs, candidate review, and `scan promote` for Tier 2 candidates                                     | ✅ Shipped |
| **`lessons review`** — review auto-discovered candidates against validation rules                                                                     | ✅ Shipped |
| **Slash commands** — `/lessons:add`, `/lessons:review`, `/lessons:manage`, `/lessons:config`                                                          | ✅ Shipped |

### Cross-agent support

| Feature                                                                                                                               | Status     |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **Claude Code** — native adapter (default)                                                                                            | ✅ Shipped |
| **OpenAI Codex** — tool name normalization (`shell→Bash`, `apply_patch→Edit`, etc.) via `LESSONS_AGENT_PLATFORM=codex`                | ✅ Shipped |
| **Gemini CLI** — tool name normalization (`run_shell_command→Bash`, `replace_in_file→Edit`, etc.) via `LESSONS_AGENT_PLATFORM=gemini` | ✅ Shipped |
| **Formal adapter interface** — documented adapter contract for adding new agent platforms without changing core logic                 | 🚧 Planned |

### Data and schemas

| Feature                                                                                                                                               | Status                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **JSON schemas** — `$schema` references on all data files (`config.json`, `lessons.json`, `lesson-manifest.json`) for IDE autocomplete and validation | ✅ Shipped                  |
| **30 curated seed lessons** — hand-authored lessons covering pytest, git, pip, npm, mock.patch, vitest, Node.js, browser automation, shell, and more  | ✅ Shipped                  |
| **Content patterns** — trigger on file content or command output in addition to command string and file path                                          | 🔬 Tentative (post-harvest) |

### Planned features

| Feature                                                                                                                                                                                                                                            | Status     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **CLI tool intelligence aggregation** — when 5+ lessons accumulate for a single tool (e.g. `tool:pytest`), auto-aggregate them into a coherent skill file in `skills/cli-intel/` that gets injected as a single unit instead of individual lessons | 📋 Phase 3 |
| **LLM-assisted candidate classification** — pipe Tier 2 heuristic candidates through the current Claude session for structured review and schema population                                                                                        | 📋 Phase 3 |
| **Project stack detection** — at runtime, detect presence of `pyproject.toml`, `package.json`, `go.mod` etc. and boost matching `lang:` lessons by +1 priority                                                                                     | 📋 Phase 4 |
| **`--auto` scan mode** — fully automated heuristic-only classification for Tier 2 candidates without interactive review                                                                                                                            | 📋 Phase 4 |

> **Status key:** ✅ Shipped · 🚧 Planned · 🔬 Tentative · 📋 Future phase

---

## Installation

**Requirements:** Node.js ≥ 18, Claude Code

Clone the repo and add the hooks to `~/.claude/settings.json`:

```bash
git clone https://github.com/joeblackwaslike/lessons-learned.git ~/lessons-learned
```

Then add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"/absolute/path/to/lessons-learned/hooks/session-start-reset.mjs\""
          },
          {
            "type": "command",
            "command": "node \"/absolute/path/to/lessons-learned/hooks/session-start-lesson-protocol.mjs\""
          }
        ]
      },
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "node \"/absolute/path/to/lessons-learned/hooks/session-start-scan.mjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Read|Edit|Write|Bash|Glob",
        "hooks": [
          {
            "type": "command",
            "command": "node \"/absolute/path/to/lessons-learned/hooks/pretooluse-lesson-inject.mjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "matcher": ".+",
        "hooks": [
          {
            "type": "command",
            "command": "node \"/absolute/path/to/lessons-learned/hooks/subagent-start-lesson-protocol.mjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Replace `/absolute/path/to/lessons-learned` with the actual path (e.g. `/Users/you/lessons-learned`).

## Cross-agent setup

The injection hook works across Claude Code, Codex, and Gemini CLI. Set `LESSONS_AGENT_PLATFORM` before the hook command to normalize tool names:

| Platform     | `LESSONS_AGENT_PLATFORM` |
| ------------ | ------------------------ |
| Claude Code  | _(default, unset)_       |
| OpenAI Codex | `codex`                  |
| Gemini CLI   | `gemini`                 |

## CLI

All management goes through a single entry point:

```bash
node scripts/lessons.mjs <subcommand> [options]
```

| Subcommand        | Purpose                                                           |
| ----------------- | ----------------------------------------------------------------- |
| `add`             | Add a new lesson interactively, from `--json`, `--file`, or stdin |
| `build`           | Rebuild `data/lesson-manifest.json` from `data/lessons.json`      |
| `list`            | List all lessons with patterns and metadata                       |
| `review`          | Review Tier 2 candidates against validation rules                 |
| `scan`            | Incrementally scan session logs for new candidates                |
| `scan candidates` | Full scan filtered to recurring cross-project patterns            |
| `scan promote N`  | Promote candidate N into the lesson store                         |

Run any subcommand with `--help` for full options. npm script aliases: `npm run scan`, `npm run build`.

## Lesson format

Lessons live in `data/lessons.json`. Key fields:

```json
{
  "id": "pytest-tty-hanging-k9m2",
  "summary": "pytest hangs in non-interactive envs due to TTY detection",
  "mistake": "Running pytest directly in a non-interactive environment causes it to hang waiting for TTY input due to its automatic terminal detection.",
  "remediation": "Use `python -m pytest --no-header -p no:faulthandler` or set TERM=dumb to disable TTY detection.",
  "triggers": {
    "commandPatterns": ["\\bpytest\\b(?!.*(--no-header|-p no:faulthandler|TERM=dumb))"],
    "toolNames": ["Bash"]
  },
  "tags": ["lang:python", "tool:pytest", "severity:hang"],
  "confidence": 0.95,
  "priority": 8
}
```

After editing `lessons.json` directly, always run:

```bash
node scripts/lessons.mjs build
```

### Emitting lessons from sessions

When Claude encounters and recovers from a mistake, it emits a structured tag:

```
#lesson
tool: Bash
trigger: git stash
mistake: git stash silently drops untracked files without -u flag
fix: Use `git stash -u` (or --include-untracked) to include untracked files
tags: tool:git, severity:data-loss
#/lesson
```

These are automatically picked up by the scanner on the next session start.

## Configuration

`data/config.json` controls injection and scanning behavior:

| Field                    | Default                   | Purpose                                |
| ------------------------ | ------------------------- | -------------------------------------- |
| `injectionBudgetBytes`   | `4096`                    | Max bytes injected per hook call       |
| `maxLessonsPerInjection` | `3`                       | Max lessons injected per tool call     |
| `minConfidence`          | `0.5`                     | Minimum confidence to inject           |
| `minPriority`            | `1`                       | Minimum priority to inject             |
| `scanPaths`              | `["~/.claude/projects/"]` | Directories scanned for session logs   |
| `autoScanIntervalHours`  | `24`                      | Minimum hours between background scans |

## Two-tier scanning

**Tier 1 (structured):** Greps for `#lesson … #/lesson` tags emitted by Claude. High confidence — auto-promotes on interactive review.

**Tier 2 (heuristic):** Sliding-window pattern detection over JSONL session logs. Identifies error→correction sequences without explicit tags. Requires manual promotion via `lessons scan promote`.

## Lesson store

The repo ships with 30 curated seed lessons covering common failure patterns:

- Python: pytest TTY hang, mock.patch namespace, pip venv targeting, virtualenv vars
- JavaScript/Node: vitest parallel isolation, npm link peer deps, Node.js deprecation warnings
- Git: stash untracked files, heredoc commit messages, commit signing conflicts
- Browser/CDP: Chrome DevTools ECONNREFUSED, async eval returning undefined
- Shell/tools: oh-my-zsh NVM warnings, pre-commit hook failures, Biome v2 config schema

## Development

```bash
npm ci
npm run lint        # ESLint
npm run typecheck   # tsc --checkJs
npm test            # all 188 tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for adding lessons and the full test architecture.

## License

[MIT](LICENSE)
