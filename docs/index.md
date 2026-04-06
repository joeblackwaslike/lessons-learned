# lessons-learned

**Stop re-correcting the same mistakes.**

`lessons-learned` is a Claude Code plugin that automatically captures coding mistakes from your session logs and injects the relevant lesson as context before your next tool call — preventing the same error from happening twice.

[![CI](https://github.com/joeblackwaslike/lessons-learned/actions/workflows/ci.yml/badge.svg)](https://github.com/joeblackwaslike/lessons-learned/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/joeblackwaslike/lessons-learned/blob/main/LICENSE)

---

## The problem

Claude Code sessions are stateless. A mistake corrected in one session — wrong pytest flag, wrong `mock.patch` namespace, missing `git stash -u` — is repeated identically in the next session. You pay the turn cost of correcting it every time.

## The solution

lessons-learned closes the loop automatically:

```
Session log  ──scan──►  candidates  ──review──►  lessons.json
                                                       │
                                                  lessons build
                                                       │
                                               lesson-manifest.json
                                                       │
tool call  ──PreToolUse hook──►  match  ──inject──►  additionalContext
```

1. **Capture** — Claude emits a `#lesson` tag when it corrects a mistake. A background scanner also detects error→correction patterns heuristically.
2. **Promote** — You review candidates and promote them to the active lesson store.
3. **Inject** — Before every `Bash`, `Read`, `Edit`, `Write`, or `Glob` call, the hook matches the command or path against the store and prepends relevant lessons to Claude's context.

The result: Claude doesn't repeat the same class of mistakes across sessions.

---

## Key features

| Feature                  | Description                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------- |
| **PreToolUse injection** | 6-stage pipeline fires before every tool call — match, dedup, select, inject        |
| **3-layer dedup**        | Each lesson injected at most once per session, even with parallel subagents         |
| **Two-tier scanning**    | Structured `#lesson` tags (Tier 1) + heuristic error→correction detection (Tier 2)  |
| **Configurable budget**  | Inject up to 3 lessons / 4 KB per call; high-priority lessons displace low-priority |
| **Tool call blocking**   | Lessons can deny a tool call outright when a command is known-destructive           |
| **Cross-agent support**  | Works with Claude Code, Gemini CLI, OpenAI Codex, and opencode                      |
| **30 seed lessons**      | Ships with curated lessons for pytest, git, mock.patch, npm, and more               |
| **Slash commands**       | `/lessons:add`, `/lessons:review`, `/lessons:manage`, `/lessons:config`             |

---

## Quick start

```bash
git clone https://github.com/joeblackwaslike/lessons-learned.git ~/lessons-learned
```

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
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
    ]
  }
}
```

See the [full installation guide](installation.md) for session-start hooks, cross-agent setup, and verification steps.

---

## Next steps

<div class="grid cards" markdown>

- :material-rocket-launch: **[Getting Started](getting-started.md)**

  Five-minute walkthrough — clone, wire hooks, verify injection, add your first lesson.

- :material-cog: **[Installation](installation.md)**

  Full setup for Claude Code, Gemini CLI, Codex, and opencode.

- :material-book-open: **[User Guide](user-guide/index.md)**

  How it works, slash commands, configuration, scanning, and lesson emission.

- :material-code-braces: **[Developer Guide](developer-guide/index.md)**

  Architecture, data model, adapters, testing, and contributing.

</div>
