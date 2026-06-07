---
sidebar_position: 0
title: Installation
description: Install lessons-learned on Claude Code, Codex, Gemini CLI, opencode, and Cursor.
---

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

## Marketplace install (Claude Code / Codex)

The fastest path for Claude Code and Codex CLI users. Add the marketplace once per machine, then install:

```bash
# Claude Code
claude plugin marketplace add joeblackwaslike/agent-marketplace
claude plugin install lessons-learned@agent-marketplace

# Codex CLI
codex plugin marketplace add joeblackwaslike/agent-marketplace
codex plugin install lessons-learned@agent-marketplace
```

The `marketplace add` step registers the marketplace source — it only needs to run once. After that, `plugin install` resolves directly.

For Gemini CLI, opencode, and Cursor, use the manual setup below.

---

## Manual install (clone and wire)

```bash
git clone https://github.com/joeblackwaslike/lessons-learned.git ~/lessons-learned
cd ~/lessons-learned
npm ci
```

`npm ci` installs Node.js dependencies and registers Husky pre-commit hooks.

---

## Platform setup

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
  <TabItem value="claude-code" label="Claude Code" default>

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

:::tip Find your clone path

```bash
echo $(pwd)   # run from inside the repo
```

:::

### 2. Restart Claude Code

Hook changes in `settings.json` take effect on the next session. Restart Claude Code or start a new session.

### 3. Verify

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"pytest tests/"},"session_id":"x"}' | \
  node ~/lessons-learned/hooks/pretooluse-lesson-inject.mjs
```

You should see JSON output with `hookSpecificOutput.additionalContext`. An empty `{}` means no lesson matched.

  </TabItem>
  <TabItem value="codex" label="Codex CLI">

Set `LESSONS_AGENT_PLATFORM=codex` so tool names are normalized correctly:

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

  </TabItem>
  <TabItem value="gemini" label="Gemini CLI">

Set `LESSONS_AGENT_PLATFORM=gemini` so tool names are normalized correctly:

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

:::note Advisory injection on Gemini
Gemini CLI's `BeforeTool` hook supports `additionalContext` injection in recent versions. Check your Gemini CLI version — older versions may only support block decisions. See the [adapter reference](../developer-guide/adapters.md#gemini-cli) for details.
:::

  </TabItem>
  <TabItem value="opencode" label="opencode">

opencode uses the same tool name set as Claude Code (`Bash`, `Read`, `Edit`, `Write`, `Glob`). Set `LESSONS_AGENT_PLATFORM=opencode`:

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

  </TabItem>
  <TabItem value="cursor" label="Cursor">

Cursor uses a similar hook system to Claude Code. Wire the hooks in your Cursor settings using the same `PreToolUse` pattern as Claude Code, substituting your clone path.

Refer to the Cursor documentation for the hook configuration file location — it may differ from `~/.claude/settings.json`.

  </TabItem>
</Tabs>

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
