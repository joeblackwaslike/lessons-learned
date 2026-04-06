# Getting Started

This guide gets you from zero to a working installation in five minutes, then walks you through adding your first lesson.

## Prerequisites

- **Node.js ≥ 22.5**
- **Claude Code** (any recent version)
- A Unix-like shell (macOS, Linux, WSL)

## Step 1 — Clone the repo

```bash
git clone https://github.com/joeblackwaslike/lessons-learned.git ~/lessons-learned
cd ~/lessons-learned
npm ci
```

`npm ci` installs dependencies and registers pre-commit hooks.

## Step 2 — Wire the hooks

Open `~/.claude/settings.json` in your editor and add the `hooks` section. If the file doesn't exist yet, create it.

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

!!! warning "Use absolute paths"
Replace `/Users/you/lessons-learned` with your actual clone path — e.g. `/home/alice/lessons-learned`.
Tilde expansion (`~/lessons-learned`) is not supported in `settings.json` hook commands.

## Step 3 — Verify injection is working

Start a new Claude Code session (restart required for hooks to load), then ask Claude to run any command that matches one of the seed lessons:

```
Ask Claude: "run pytest tests/"
```

If injection is working, Claude will receive a context block before running the command. You can also verify by checking that the hook script runs without errors:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"pytest tests/"},"session_id":"test"}' | \
  node ~/lessons-learned/hooks/pretooluse-lesson-inject.mjs
```

Expected output (trimmed):

```json
{ "hookSpecificOutput": { "additionalContext": "## REQUIRED: pytest flags..." } }
```

An empty `{}` means no lesson matched — which is correct for commands that don't match any trigger.

## Step 4 — Add your first lesson

The fastest way to add a lesson is the interactive CLI:

```bash
cd ~/lessons-learned
node scripts/lessons.mjs add
```

Or use the slash command from within Claude Code:

```
/lessons:add
```

Claude will ask you five questions — what went wrong, how to fix it, what command triggers it, a summary, and optional tags/priority. The lesson is validated and written to `data/lessons.db`.

## Step 5 — Build the manifest

After adding a lesson (or editing the store directly), rebuild the manifest:

```bash
node scripts/lessons.mjs build
```

The manifest is what the injection hook reads at runtime. You need to rebuild it after any change to lessons.

---

## What's next?

- Learn how the [injection pipeline](user-guide/how-it-works.md) works end-to-end
- Review and promote the [seed lessons](user-guide/lessons.md) that ship with the plugin
- Use [slash commands](user-guide/slash-commands.md) for a conversational interface to manage lessons
- Set up [scanning](user-guide/scanning.md) to automatically discover lessons from your session logs
