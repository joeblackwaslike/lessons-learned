# Installation

Full installation guide for all supported agents.

## Requirements

| Requirement  | Version                                   |
| ------------ | ----------------------------------------- |
| Node.js      | ≥ 22.5                                    |
| Claude Code  | Any recent version                        |
| Gemini CLI   | Any recent version _(for Gemini setup)_   |
| OpenAI Codex | Any recent version _(for Codex setup)_    |
| opencode     | Any recent version _(for opencode setup)_ |

---

## Clone and install

```bash
git clone https://github.com/joeblackwaslike/lessons-learned.git ~/lessons-learned
cd ~/lessons-learned
npm ci
```

`npm ci` installs Node.js dependencies and registers Husky pre-commit hooks.

---

## Claude Code

### 1. Add hooks to settings

Edit `~/.claude/settings.json`:

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

Replace `/absolute/path/to/lessons-learned` with your actual clone path (e.g. `/Users/alice/lessons-learned`).

!!! tip "Find your clone path"
`bash
    echo $(pwd)   # run from inside the repo
    `

### 2. Restart Claude Code

Hook changes in `settings.json` take effect on the next session. Restart Claude Code or start a new session.

### 3. Verify

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"pytest tests/"},"session_id":"x"}' | \
  node ~/lessons-learned/hooks/pretooluse-lesson-inject.mjs
```

You should see JSON output with `hookSpecificOutput.additionalContext`. An empty `{}` means no lesson matched.

---

## Gemini CLI

Set `LESSONS_AGENT_PLATFORM=gemini` before each hook command so tool names are normalized correctly.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "run_shell_command|read_file|write_file|replace_in_file|find_files",
        "hooks": [
          {
            "type": "command",
            "command": "LESSONS_AGENT_PLATFORM=gemini node \"/absolute/path/to/lessons-learned/hooks/pretooluse-lesson-inject.mjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

!!! note "Advisory injection on Gemini"
Gemini CLI's `BeforeTool` hook supports `additionalContext` injection in recent versions. Check your Gemini CLI version — older versions may only support block decisions. See the [adapter reference](developer-guide/adapters.md#gemini-cli) for details.

---

## OpenAI Codex

Set `LESSONS_AGENT_PLATFORM=codex`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "shell|apply_patch|read_file|write_file|find_files",
        "hooks": [
          {
            "type": "command",
            "command": "LESSONS_AGENT_PLATFORM=codex node \"/absolute/path/to/lessons-learned/hooks/pretooluse-lesson-inject.mjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

---

## opencode

Set `LESSONS_AGENT_PLATFORM=opencode` (uses the same tool name normalization as Claude Code — `Bash`, `Read`, `Edit`, `Write`, `Glob`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Read|Edit|Write|Glob",
        "hooks": [
          {
            "type": "command",
            "command": "node \"/absolute/path/to/lessons-learned/hooks/pretooluse-lesson-inject.mjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

---

## Tool name mapping

Each agent platform uses different tool names. The plugin normalizes them to the canonical set before matching against the lesson store:

| Canonical | Claude Code | Gemini CLI          | Codex         | opencode |
| --------- | ----------- | ------------------- | ------------- | -------- |
| `Bash`    | `Bash`      | `run_shell_command` | `shell`       | `Bash`   |
| `Read`    | `Read`      | `read_file`         | `read_file`   | `Read`   |
| `Edit`    | `Edit`      | `replace_in_file`   | `apply_patch` | `Edit`   |
| `Write`   | `Write`     | `write_file`        | `write_file`  | `Write`  |
| `Glob`    | `Glob`      | `find_files`        | `find_files`  | `Glob`   |

---

## Upgrading

```bash
cd ~/lessons-learned
git pull
npm ci
node scripts/lessons.mjs build   # rebuild manifest after any update
```

## Uninstalling

1. Remove the `hooks` entries from `~/.claude/settings.json` (or the equivalent file for your agent).
2. Delete the repo: `rm -rf ~/lessons-learned`

Your session logs are unaffected — the plugin only reads them, never writes to them.
