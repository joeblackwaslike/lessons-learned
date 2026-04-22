# lessons-learned

A plugin that automatically captures coding mistakes from session logs and injects relevant lessons as context before tool calls — preventing the same mistakes from happening twice.

[![CI](https://github.com/joeblackwaslike/lessons-learned/actions/workflows/ci.yml/badge.svg)](https://github.com/joeblackwaslike/lessons-learned/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## How it works

**Capture** — Claude emits structured `#lesson` tags when it makes and corrects a mistake. A background scanner also detects error→correction patterns heuristically from session logs.

**Inject** — Before every tool call, the `PreToolUse` hook matches the command or file path against the lesson store and injects up to 3 relevant lessons as `additionalContext`. At session start, the `#lesson` protocol is injected so the agent knows how to emit new lessons.

**Loop** — New lessons flow from session logs back into the store via `lessons scan` and `lessons add`, tightening the feedback loop over time.

```
Session log  ──scan──►  candidates  ──review──►  lesson store
                                                       │
                                                  lessons build
                                                       │
                                               lesson-manifest.json
                                                       │
tool call  ──PreToolUse hook──►  match  ──inject──►  additionalContext
```

---

## Installation

### Claude Code (recommended)

Install via the [agent-marketplace](https://github.com/joeblackwaslike/agent-marketplace):

```bash
# Add the marketplace (once)
claude plugin marketplace add joeblackwaslike/agent-marketplace

# Install the plugin
claude plugin install lessons-learned
```

Hooks are wired automatically. Skip to [CLI](#cli) to start managing lessons.

---

### Manual install

**Requirements:** Node.js ≥ 22.5

```bash
git clone https://github.com/joeblackwaslike/lessons-learned.git ~/lessons-learned
cd ~/lessons-learned
npm ci
```

Then wire hooks manually in `~/.claude/settings.json`:

### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"/Users/you/lessons-learned/hooks/session-start-reset.mjs\""
          },
          {
            "type": "command",
            "command": "node \"/Users/you/lessons-learned/hooks/session-start-lesson-protocol.mjs\""
          }
        ]
      },
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "node \"/Users/you/lessons-learned/hooks/session-start-scan.mjs\"",
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
            "command": "node \"/Users/you/lessons-learned/hooks/pretooluse-lesson-inject.mjs\"",
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
            "command": "node \"/Users/you/lessons-learned/hooks/subagent-start-lesson-protocol.mjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Replace `/Users/you/lessons-learned` with your actual clone path. Restart Claude Code for hooks to take effect.

> **Tip:** `echo $(pwd)` from inside the repo gives you the path to paste.

#### Optional: Context Anti-Compact (beta)

Add this block to also enable the [Context Anti-Compact](docs/user-guide/anti-compact.md) beta feature, which intercepts `/compact` and generates a structured session handoff instead of allowing lossy built-in compression:

```json
"PreCompact": [
  {
    "matcher": "",
    "hooks": [
      {
        "type": "command",
        "command": "LESSONS_PRECOMPACT_HANDOFF=1 node \"/Users/you/lessons-learned/hooks/precompact-handoff.mjs\"",
        "timeout": 60
      }
    ]
  }
]
```

The env var `LESSONS_PRECOMPACT_HANDOFF=1` is what enables the feature — the hook is a no-op without it, so you can also wire it unconditionally and toggle the env var in your shell profile.

---

### Gemini CLI

Set `LESSONS_AGENT_PLATFORM=gemini` so tool names are normalized correctly (`run_shell_command` → `Bash`, etc.).

Add to your Gemini CLI config (typically `~/.gemini/settings.json`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "run_shell_command|read_file|write_file|replace_in_file|find_files",
        "hooks": [
          {
            "type": "command",
            "command": "LESSONS_AGENT_PLATFORM=gemini node \"/Users/you/lessons-learned/hooks/pretooluse-lesson-inject.mjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

> **Note:** Gemini CLI's `BeforeTool` hook supports `additionalContext` injection in recent versions. Older versions may only support block decisions. Check your Gemini CLI version.

---

### OpenAI Codex

Set `LESSONS_AGENT_PLATFORM=codex` so tool names are normalized (`shell` → `Bash`, `apply_patch` → `Edit`, etc.).

Add to your Codex config:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "shell|apply_patch|read_file|write_file|find_files",
        "hooks": [
          {
            "type": "command",
            "command": "LESSONS_AGENT_PLATFORM=codex node \"/Users/you/lessons-learned/hooks/pretooluse-lesson-inject.mjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

---

### opencode

opencode uses the same tool names as Claude Code (`Bash`, `Read`, `Edit`, `Write`, `Glob`). Add to `opencode.json` in your project or `~/.config/opencode/opencode.json` globally:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Read|Edit|Write|Glob",
        "hooks": [
          {
            "type": "command",
            "command": "node \"/Users/you/lessons-learned/hooks/pretooluse-lesson-inject.mjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

> **Note:** If your version of opencode does not yet support `PreToolUse` hooks natively, add the lesson protocol as a standing instruction via `opencode.json` `instructions` field or in your project's `AGENTS.md` — see [Manual injection](#manual-injection-cursor-and-agents-without-hook-support) below.

---

### Cursor

Cursor does not expose a `PreToolUse` hook. Use the manual injection approach instead: add the lesson protocol and a summary of high-priority lessons to your `.cursorrules` file or project system prompt.

Generate a snapshot of your current lessons for pasting:

```bash
node scripts/lessons.mjs list --format cursorrules > .cursorrules-lessons
```

Then include the output in your `.cursorrules` file. You'll need to regenerate this after adding or editing lessons.

For richer integration, expose the lesson store via an MCP server and configure it in Cursor's MCP settings — see [MCP integration](#mcp-integration).

---

### OpenClaw

OpenClaw supports tool call interception via the Plugin SDK's `before_tool_call` hook. Create a plugin and register the hook:

```js
// lessons-learned-plugin/index.js
import { execSync } from 'node:child_process';

export default {
  name: 'lessons-learned',
  hooks: {
    before_tool_call({ tool, input }) {
      const payload = JSON.stringify({
        tool_name: tool,
        tool_input: input,
        session_id: process.env.SESSION_ID ?? 'openclaw',
      });
      const result = execSync(
        `echo '${payload}' | node /Users/you/lessons-learned/hooks/pretooluse-lesson-inject.mjs`,
        { encoding: 'utf8' }
      );
      const out = JSON.parse(result);
      if (out?.hookSpecificOutput?.additionalContext) {
        // prepend lesson context to the tool input or system message
      }
    },
  },
};
```

Register the plugin in your OpenClaw config. See the [Plugin Architecture docs](https://docs.openclaw.ai) for full integration details.

---

### Manual injection (Cursor and agents without hook support)

For agents that don't support `PreToolUse` hooks, you can inject the lesson protocol and a high-priority lesson digest as a standing system prompt or rules file.

**Step 1** — Export a lesson digest:

```bash
node scripts/lessons.mjs list --json | \
  node -e "
    const lessons = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const top = lessons.filter(l => l.priority >= 7).slice(0, 15);
    console.log('## Lessons — required reading\n');
    top.forEach(l => console.log('- **' + l.summary + '**\n  Solution: ' + l.solution));
  "
```

**Step 2** — Paste the output into your agent's system prompt, `.cursorrules`, or `AGENTS.md`.

**Step 3** — Re-run after adding new high-priority lessons.

---

### Tool name mapping

| Canonical | Claude Code | Gemini CLI          | Codex         | opencode | OpenClaw     |
| --------- | ----------- | ------------------- | ------------- | -------- | ------------ |
| `Bash`    | `Bash`      | `run_shell_command` | `shell`       | `Bash`   | `bash`       |
| `Read`    | `Read`      | `read_file`         | `read_file`   | `Read`   | `read_file`  |
| `Edit`    | `Edit`      | `replace_in_file`   | `apply_patch` | `Edit`   | `edit_file`  |
| `Write`   | `Write`     | `write_file`        | `write_file`  | `Write`  | `write_file` |
| `Glob`    | `Glob`      | `find_files`        | `find_files`  | `Glob`   | `find_files` |

Set `LESSONS_AGENT_PLATFORM` to normalize non-Claude-Code tool names automatically:

| Platform     | `LESSONS_AGENT_PLATFORM` |
| ------------ | ------------------------ |
| Claude Code  | _(default, unset)_       |
| Gemini CLI   | `gemini`                 |
| OpenAI Codex | `codex`                  |
| opencode     | _(same as Claude Code)_  |

---

### MCP integration

The lesson store can be exposed as an MCP tool server for agents that support MCP but not native hooks (e.g. Cursor, Windsurf):

```bash
# Coming soon — MCP server adapter
# node scripts/lessons.mjs serve --mcp --port 3456
```

MCP adapter is on the roadmap. Until then, use [manual injection](#manual-injection-cursor-and-agents-without-hook-support).

---

## CLI

All management goes through a single entry point:

```bash
node scripts/lessons.mjs <subcommand> [options]
```

| Subcommand        | Purpose                                                           |
| ----------------- | ----------------------------------------------------------------- |
| `add`             | Add a new lesson interactively, from `--json`, `--file`, or stdin |
| `build`           | Rebuild `data/lesson-manifest.json`                               |
| `list`            | List all lessons with patterns and metadata                       |
| `review`          | Review Tier 2 candidates against validation rules                 |
| `scan`            | Incrementally scan session logs for new candidates                |
| `scan candidates` | Full scan filtered to recurring cross-project patterns            |
| `scan promote N`  | Promote candidate N into the lesson store                         |

Run any subcommand with `--help` for full options. Shorthand: `npm run build`, `npm run scan`.

---

## Emitting lessons

When Claude encounters and recovers from a mistake, it emits a structured tag:

```
#lesson
tool: Bash
trigger: git stash
problem: git stash silently drops untracked files without -u flag
solution: Use `git stash -u` (or --include-untracked) to include untracked files
tags: tool:git, severity:data-loss
#/lesson
```

These are automatically picked up by the scanner on the next session start.

---

## Configuration

`data/config.json` controls injection and scanning behavior. Every field has a `LESSONS_*` environment variable equivalent that takes precedence.

| Field                            | Default                   | Env var                                    |
| -------------------------------- | ------------------------- | ------------------------------------------ |
| `injectionBudgetBytes`           | `4096`                    | `LESSONS_INJECTION_BUDGET_BYTES`           |
| `maxLessonsPerInjection`         | `3`                       | `LESSONS_MAX_LESSONS_PER_INJECTION`        |
| `minConfidence`                  | `0.5`                     | `LESSONS_MIN_CONFIDENCE`                   |
| `minPriority`                    | `1`                       | `LESSONS_MIN_PRIORITY`                     |
| `compactionReinjectionThreshold` | `7`                       | `LESSONS_COMPACTION_REINJECTION_THRESHOLD` |
| `scanPaths`                      | `["~/.claude/projects/"]` | `LESSONS_SCAN_PATHS` _(colon-separated)_   |
| `autoScanIntervalHours`          | `24`                      | `LESSONS_AUTO_SCAN_INTERVAL_HOURS`         |
| `maxCandidatesPerScan`           | `50`                      | `LESSONS_MAX_CANDIDATES_PER_SCAN`          |

---

## Features

### Core pipeline

| Feature                                                                             | Status     |
| ----------------------------------------------------------------------------------- | ---------- |
| PreToolUse injection — 6-stage match→dedup→select→inject pipeline                   | ✅ Shipped |
| Negative-lookahead patterns — suppress injection when fix is already applied        | ✅ Shipped |
| Injection budget — configurable byte cap (default 4 KB) + lesson cap (default 3)    | ✅ Shipped |
| Manifest pre-compilation — hot-path hook does zero file I/O beyond loading manifest | ✅ Shipped |
| Tool call blocking — `block: true` denies the tool call entirely with a reason      | ✅ Shipped |

### Dedup and session management

| Feature                                                                                     | Status     |
| ------------------------------------------------------------------------------------------- | ---------- |
| 3-layer dedup — env var + session temp file + O_EXCL claim dir; once per session per lesson | ✅ Shipped |
| Context compaction re-injection — high-priority lessons re-inject after `/compact`          | ✅ Shipped |
| Session reset — all dedup state wiped on `clear` events                                     | ✅ Shipped |

### Lesson discovery

| Feature                                                                               | Status     |
| ------------------------------------------------------------------------------------- | ---------- |
| Tier 1 scanner — structured `#lesson` tag parsing; ~95% accuracy                      | ✅ Shipped |
| Tier 2 scanner — heuristic sliding-window error→correction detection                  | ✅ Shipped |
| Incremental scanning — byte-offset tracking; constant ~1 MB memory                    | ✅ Shipped |
| Confidence + priority scoring — multi-session, multi-project, hang/correction signals | ✅ Shipped |
| Background scan on startup                                                            | ✅ Shipped |

### Planned

| Feature                                                                             | Status     |
| ----------------------------------------------------------------------------------- | ---------- |
| MCP server adapter for Cursor / Windsurf / agents without hook support              | 📋 Roadmap |
| CLI tool intelligence aggregation — aggregate 5+ per-tool lessons into a skill file | 📋 Roadmap |
| LLM-assisted Tier 2 candidate classification                                        | 📋 Roadmap |
| Project stack detection — boost `lang:` lessons when relevant lockfiles detected    | 📋 Roadmap |

---

## Development

```bash
npm ci
npm run lint        # ESLint
npm run typecheck   # tsc --checkJs
npm test            # all tests
just --list         # all dev tasks
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow and [docs](https://joeblackwaslike.github.io/lessons-learned) for the complete reference.

## License

[MIT](LICENSE)
