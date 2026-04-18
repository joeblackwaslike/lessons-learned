# Hook Reference

Hook wiring and I/O contracts for all hooks in the plugin.

Hook configuration lives in `hooks/hooks.json`. For manual installation (without the plugin registry), see [Installation](../installation.md).

---

## Hook wiring

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start-reset.mjs\""
          },
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start-lesson-protocol.mjs\""
          }
        ]
      },
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start-scan.mjs\"",
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
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse-lesson-inject.mjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/precompact-handoff.mjs\"",
            "timeout": 60
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
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/subagent-start-lesson-protocol.mjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

`${CLAUDE_PLUGIN_ROOT}` is expanded by Claude Code to the plugin installation directory.

---

## `SessionStart` hooks

### `session-start-reset.mjs`

**Matcher:** `startup|resume|clear|compact`

Fires on every session event: startup, resume, clear, and compact.

**Purpose:** Clears per-session dedup state so the new or resumed session starts clean.

**What it does:**

- Deletes `TMPDIR/lessons-seen-{sessionId}` (the session temp file layer of dedup)
- Deletes all `TMPDIR/lessons-claim-{sessionId}/` O_EXCL lock files
- After compaction (`compact` event), only removes dedup entries for lessons with `priority >= compactionReinjectionThreshold` — allowing high-priority lessons to re-inject in the new context

**Output:** None (no stdout, no hook output).

---

### `session-start-lesson-protocol.mjs`

**Matcher:** `startup|resume|clear|compact`

Fires alongside the reset hook on every session event.

**Purpose:** Ensures Claude has the `#lesson` reporting protocol and any session-start lessons in its context.

**What it injects as `additionalContext`:**

1. The `#lesson` tag format — tells Claude how to emit structured lesson tags when it makes and corrects a mistake
2. Any lessons with `triggers.sessionStart: true` — reasoning reminders with no specific command or path trigger

**Output format:**

```json
{
  "hookSpecificOutput": {
    "additionalContext": "# [lessons-learned] Lesson Reporting Protocol\n\n...\n\n## Reasoning Reminders\n\n..."
  }
}
```

---

### `session-start-scan.mjs`

**Matcher:** `startup` only

Fires only on new session startup (not resume, clear, or compact).

**Purpose:** Spawns a background scan of session logs to discover new lesson candidates.

**What it does:**

- Spawns `node scripts/lessons.mjs scan --auto` as a detached child process
- Calls `child.unref()` immediately — the parent exits without waiting for the child
- The child runs `autoScanIntervalHours` check: exits early if last scan was recent

**Output:** None — returns immediately after spawning.

**Timeout:** 5 seconds (for the hook process itself, not the background scan). The hook exits well before the timeout since it only spawns and unrefs.

---

## `PreToolUse` hooks

### `pretooluse-lesson-inject.mjs`

**Matcher:** `Read|Edit|Write|Bash|Glob`

Fires before every tool call matching the pattern.

**Input (stdin):**

```json
{
  "tool_name": "Bash",
  "tool_input": {
    "command": "pytest tests/"
  },
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "cwd": "/Users/alice/myproject"
}
```

For file tools (`Read`, `Edit`, `Write`, `Glob`):

```json
{
  "tool_name": "Read",
  "tool_input": {
    "file_path": "/Users/alice/myproject/tests/test_foo.py"
  },
  "session_id": "...",
  "cwd": "..."
}
```

**Output (stdout) — advisory injection:**

```json
{
  "hookSpecificOutput": {
    "additionalContext": "## REQUIRED: pytest flags for Claude Code\n\n..."
  },
  "env": {
    "LESSONS_SEEN": "pytest-tty-hanging-k9m2"
  }
}
```

**Output — block decision:**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "pytest without --no-header hangs. Rerun as: pytest --no-header tests/"
  }
}
```

**Output — no match:**

```json
{}
```

**Environment variables read:**

| Variable                 | Purpose                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| `LESSONS_SEEN`           | Comma-separated slugs already injected this session (dedup layer 1) |
| `LESSONS_MANIFEST_PATH`  | Override manifest path (for testing)                                |
| `LESSONS_AGENT_PLATFORM` | Platform normalization: `gemini`, `codex` (default: Claude Code)    |

**Timeout:** 5 seconds. The hook is fast (manifest load + regex match + JSON output) and should complete in milliseconds.

---

## `PreCompact` hooks

!!! warning "Beta"
    The `PreCompact` hook is a beta feature. Enable it with `LESSONS_PRECOMPACT_HANDOFF=1`. See [Context Anti-Compact](../user-guide/anti-compact.md) for full documentation.

### `precompact-handoff.mjs`

**Matcher:** `` (empty — fires on every compaction)

**Opt-in:** Only runs when `LESSONS_PRECOMPACT_HANDOFF=1` is set. Exits `0` (no-op) otherwise.

Fires before `/compact` executes, giving the hook the opportunity to block compaction.

**Purpose:** Intercepts context window compaction, generates a high-quality structured session handoff via `claude -p`, and exits with code `2` to block the built-in compaction. The handoff preserves decision rationale, exact commands, issue IDs, and file paths that lossy compaction would discard.

**What it does:**

1. Parses the session transcript at `transcript_path` (from stdin) — extracts `user` and `assistant` message text, strips injected system context, counts chars from `attachment` records separately
2. Estimates token usage: `(msgChars + attachChars) / 4` and infers the context window as `approxTokens / 0.8` (since `PreCompact` fires at exactly 80%)
3. Pipes the conversation to `claude -p --no-session-persistence` with a structured summarization prompt
4. Falls back to structured extraction (active issues, recent commits, full thread) if `claude -p` fails or times out
5. Outputs the handoff as `additionalContext` and exits `2`

**Input (stdin):**

```json
{
  "hook_event_name": "PreCompact",
  "session_id": "550e8400-...",
  "transcript_path": "/Users/alice/.claude/projects/my-project/abc123.jsonl"
}
```

**Output (stdout):**

Raw text (not JSON) — Claude Code `PreCompact` hooks use the same raw text convention as `SessionStart`:

```
# [lessons-learned] Pre-Compact Handoff

Context: ~142k / ~178k tokens (~80%). Compaction would degrade inference quality —
blocking to preserve session context.

Copy this prompt to continue in a new session:

```
[Structured handoff content]
```
```

**Exit codes:**

| Code | Meaning |
| ---- | ------- |
| `0` | Feature disabled (env var not set) — compaction proceeds normally |
| `2` | Handoff generated — compaction blocked |

**Environment variables read:**

| Variable | Purpose |
| -------- | ------- |
| `LESSONS_PRECOMPACT_HANDOFF` | Set to `1` to enable the feature (opt-in) |

**Timeout:** 60 seconds — accommodates the `claude -p` call latency (typically 20–40 seconds).

---

## `SubagentStart` hooks

### `subagent-start-lesson-protocol.mjs`

**Matcher:** `.+` (all subagents)

Fires when a subagent is spawned via the `Agent` tool.

**Purpose:** Subagents run in separate processes without access to the parent session's dedup state or context. This hook re-injects the `#lesson` protocol so the subagent knows how to emit lesson tags.

**Output format:** Same as `session-start-lesson-protocol.mjs` — `additionalContext` with the `#lesson` format.

---

## Testing hooks manually

Test the injection hook by piping a payload to stdin:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"pytest tests/"},"session_id":"x","cwd":"/tmp"}' | \
  node hooks/pretooluse-lesson-inject.mjs
```

Expected output includes `hookSpecificOutput.additionalContext` if a lesson matched, or `{}` if nothing matched.

Test with a custom manifest:

```bash
LESSONS_MANIFEST_PATH=tests/fixtures/minimal-manifest.json \
  echo '{"tool_name":"Bash","tool_input":{"command":"pytest tests/"},"session_id":"x","cwd":"/tmp"}' | \
  node hooks/pretooluse-lesson-inject.mjs
```

Test cross-agent normalization:

```bash
LESSONS_AGENT_PLATFORM=gemini \
  echo '{"tool_name":"run_shell_command","tool_input":{"command":"pytest tests/"},"session_id":"x"}' | \
  node hooks/pretooluse-lesson-inject.mjs
```
