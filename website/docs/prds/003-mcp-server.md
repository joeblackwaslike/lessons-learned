---
sidebar_position: 3
title: 'PRD-003: MCP Server'
description: Design specification for a companion MCP server that brings lessons-learned injection to Claude Desktop and other MCP-compatible hosts.
---

# PRD 003: lessons-learned MCP Server

:::caution[Design Document]
This is a Product Requirements Document — a design specification. It describes intended behavior, not necessarily current implementation. Refer to the architecture docs for the current state.
:::

**Status:** Draft
**Date:** 2026-04-16
**Author:** Joe Black

---

## 1. Overview

The lessons-learned plugin works exclusively in Claude Code via `PreToolUse` and `SessionStart` hooks. This PRD describes a companion **MCP server** that brings the same functionality to Claude Desktop (and any MCP-compatible host), without hooks.

The MCP server acts as a **transparent proxy** for the user's other MCP servers. Every tool call passes through it; the interceptor matches lessons against the call and injects them into the response. Guards block execution before forwarding; hints are bundled with the tool result. This is the closest available mechanism to PreToolUse hooks in the MCP protocol.

Both the Claude Code plugin and the MCP server share a **single lesson database** (`data/lessons.db`) on the same machine. Lessons captured in either context are immediately available in both, after the next manifest rebuild.

---

## 2. Goals

- Deliver injection, capture, and management in Claude Desktop with full feature parity where the MCP protocol allows
- Share the same lesson database across Claude Code and Claude Desktop — one library, both surfaces
- Wrap any downstream MCP server (Desktop Commander, filesystem, bash-mcp, custom servers)
- Require minimal user configuration — one setup command rewrites `claude_desktop_config.json`
- Work identically on macOS, Linux, and Windows
- Document clearly where MCP-based injection differs from hook-based injection
- Support lessons scoped per platform (`platform:claude-code`, `platform:mcp`, or untagged for both)

## Non-Goals

- 100% behavioral parity with Claude Code hooks (pre-execution hint injection is not achievable)
- Supporting non-MCP hosts (e.g., raw API clients, OpenAI Assistants)
- Building a custom MCP protocol extension — use standard MCP spec only
- Replacing the Claude Code plugin; these are parallel distribution channels

---

## 3. The Limitation: Injection Timing

Claude Code hooks run **before** tool execution. The MCP protocol has no pre-tool-call event. The closest analog is intercepting tool calls inside the proxy server — but the tool call has already been received before the server can respond.

Consequence:

- **Guards** (blocking lessons): the proxy refuses to forward the call and returns an error. Claude sees the block reason and does not execute. Equivalent to hooks.
- **Hints** (informational lessons): the proxy bundles the lesson text with the tool result in a single response. Claude sees both atomically. Post-execution, not pre-execution.

For most hint scenarios, post-execution injection is nearly as effective: Claude reads the lesson, understands what it should have done differently, and self-corrects on the next step. For destructive one-shot operations where pre-execution matters, guards should be used instead of hints.

:::warning
This limitation must be prominently documented in the setup guide.
:::

---

## 4. Shared Database

The Claude Code plugin and the MCP server run on the same machine, pointing to the same files:

```text
data/lessons.db              ← SQLite source of truth (shared)
data/lesson-manifest.json    ← pre-compiled manifest (shared; rebuilt by either context)
data/config.json             ← injection/scanning config (shared)
data/proxy-config.json       ← MCP-only: downstream server list (new)
```

**Cross-context lesson flow:**

1. User is in Claude Code; makes a mistake; emits `#lesson` tag
2. Next Claude Code session: scanner picks it up, adds to `lessons.db` as candidate
3. User runs `/lessons:review` (Claude Code or Claude Desktop — same tools)
4. Lesson promoted; `lessons build` regenerates manifest
5. Both Claude Code and Claude Desktop pick up the new lesson on next startup

No sync mechanism required — the files are local. The shared DB is the sync.

---

## 5. Tool Mapping: How One Lesson Works in Both Contexts

Claude Code and Claude Desktop use different tool names for the same operations:

| Canonical Name | Claude Code Tool | Desktop Commander Tool             |
| -------------- | ---------------- | ---------------------------------- |
| `Bash`         | `Bash`           | `start_process`                    |
| `Read`         | `Read`           | `read_file`, `read_multiple_files` |
| `Edit`         | `Edit`           | `edit_block`                       |
| `Write`        | `Write`          | `write_file`                       |
| `Glob`         | `Glob`           | `list_directory`                   |
| `Grep`         | `Grep`           | `search_code`                      |

`normalize-tool.mjs` is extended with a `DESKTOP_COMMANDER_MAP` that maps Desktop Commander tool names to canonical names before lesson matching runs.

**Key insight:** A single lesson works in both contexts automatically via this mapping. Example:

```json
{
  "toolNames": ["Bash"],
  "commandPatterns": ["\\bgit stash\\b"]
}
```

- **Claude Code:** fires when `Bash` tool is called with `git stash`
- **MCP server:** fires when `start_process` is called with `command: "git stash"` — normalized to `Bash`, same match

### When Platform Tags Are Needed

Platform tags (`platform:claude-code`, `platform:mcp`) are only needed for tools with no equivalent on the other side:

| Scenario                                            | Tag                        |
| --------------------------------------------------- | -------------------------- |
| Lesson about `Agent` tool (CC only)                 | `platform:claude-code`     |
| Lesson about `TodoWrite` (CC only)                  | `platform:claude-code`     |
| Lesson about `WebSearch`/`WebFetch` (CC only)       | `platform:claude-code`     |
| Lesson about `list_processes` behavior (DC only)    | `platform:mcp`             |
| Lesson about `force_terminate` (DC only)            | `platform:mcp`             |
| Lesson about `git stash`, file edits, reading files | _(no tag — works in both)_ |

Platform filtering is applied in the injection layer after canonical name matching:

- `pretooluse-lesson-inject.mjs` skips `platform:mcp` lessons
- `mcp/interceptor.mjs` skips `platform:claude-code` lessons
- Lessons with no platform tag or `platform:both` fire everywhere

---

## 6. Packaging: `mcp/` as a Sibling Package

The MCP server lives in `mcp/` within the same repository, with its own `package.json`. The Claude Code plugin's `package.json` (at the repo root) is not changed.

```text
lessons-learned/             ← Claude Code plugin (package.json at root)
├── core/
├── data/                    ← shared database and manifest
├── hooks/
├── scripts/
└── mcp/                     ← MCP server (own package.json)
    ├── package.json         Only dep: @modelcontextprotocol/sdk
    ├── server.mjs           Entry point
    ├── proxy.mjs
    ├── interceptor.mjs
    ├── resources.mjs
    ├── platform.mjs
    └── tools/
        └── management.mjs
```

**Why relative paths work:** Node.js ESM supports relative cross-directory imports. `mcp/server.mjs` does:

```js
import matchLessons from '../core/match.mjs'; // works
import { loadManifest } from '../data/manifest.js'; // works
```

Claude Desktop config entry after setup:

```json
{
  "mcpServers": {
    "lessons-learned": {
      "command": "node",
      "args": ["/absolute/path/to/lessons-learned/mcp/server.mjs"]
    }
  }
}
```

---

## 7. Feature Parity Map

Items marked with a warning are partial; items marked with a checkmark are fully equivalent; items marked with an X are not achievable in MCP.

### 7.1 Hooks

| Claude Code Hook                     | Event                                      | MCP Equivalent                                        | Status                                              |
| ------------------------------------ | ------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------- |
| `pretooluse-lesson-inject.mjs`       | PreToolUse (Bash, Read, Edit, Write, Glob) | Proxy interceptor per tool call                       | Hints post-execution; guards pre-execution          |
| `session-start-lesson-protocol.mjs`  | SessionStart (all)                         | System prompt snippet + `lessons://protocol` resource | Not auto-injected; must be in project system prompt |
| `session-start-scan.mjs`             | SessionStart (startup)                     | Background scan on server startup                     | Fires on process start                              |
| `session-start-reset.mjs`            | SessionStart (clear/compact)               | Process restart clears in-memory dedup Set            | Effective parity                                    |
| `subagent-start-lesson-protocol.mjs` | SubagentStart                              | No MCP equivalent                                     | Not achievable                                      |

### 7.2 Slash Commands

| Claude Code Command | MCP Equivalent                                            | Status                                                      |
| ------------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| `/lessons:add`      | `lessons_add(...)` MCP tool                               | Same intake validation, same DB write                       |
| `/lessons:review`   | `lessons_review()` MCP tool                               | Returns candidate batch as JSON; Claude reviews inline      |
| `/lessons:manage`   | `lessons_manage(status?)` MCP tool                        | Structured API; Claude navigates via multiple calls         |
| `/lessons:config`   | `lessons_config_get()` / `lessons_config_set(key, value)` | Reads/writes `data/config.json`                             |
| `/lessons:doctor`   | `lessons_doctor()` MCP tool                               | Returns structured JSON; Claude presents and proposes fixes |
| `/lessons:cancel`   | `lessons_cancel(id_or_slug)` MCP tool                     | DB records archived; `#lesson:cancel` for unscanned tags    |
| `/lessons:scope`    | `lessons_scope(id, scope)` MCP tool                       | Patches scope field                                         |

### 7.3 Management Tools

| MCP Tool                                                      | Description                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| `lessons_add(tool, trigger, problem, solution, tags, scope?)` | Add lesson with intake validation                            |
| `lessons_list(filter?)`                                       | List active lessons; optional tag/tool/type filter           |
| `lessons_search(query)`                                       | Full-text search across lesson fields                        |
| `lessons_review()`                                            | Return candidate batch as JSON for Claude's LLM review pass  |
| `lessons_manage(status?)`                                     | Browse lessons by status                                     |
| `lessons_promote(ids, archive?, patch?)`                      | Promote/archive/patch candidates                             |
| `lessons_edit(id, patch)`                                     | Edit any lesson field                                        |
| `lessons_restore(id)`                                         | Restore archived lesson                                      |
| `lessons_cancel(id_or_slug)`                                  | Archive DB records; emit `#lesson:cancel` for unscanned tags |
| `lessons_scope(id, scope)`                                    | Set or clear lesson scope                                    |
| `lessons_doctor()`                                            | Return structured JSON of QA issues                          |
| `lessons_config_get()`                                        | Return current `config.json`                                 |
| `lessons_config_set(key, value)`                              | Update a config field                                        |
| `lessons_build()`                                             | Rebuild manifest from DB                                     |
| `lessons_scan(options?)`                                      | Incremental scan of session JSONL files                      |

---

## 8. User Journey

### Setup (once per machine)

1. Run: `node scripts/lessons.mjs setup-mcp`
2. CLI detects platform, reads Claude Desktop config
3. CLI displays numbered list of detected MCP servers with checkboxes
4. User selects which servers to proxy (others remain direct connections)
5. CLI shows unified diff of proposed `claude_desktop_config.json` changes
6. Confirm → CLI writes `data/proxy-config.json`, rewrites Claude Desktop config
7. CLI prints system prompt snippet to paste into Claude Desktop project settings
8. Restart Claude Desktop

### Daily use

- Claude Desktop opens; lessons-learned MCP server starts automatically
- `lessons://protocol` resource available; system prompt instructs Claude to read it
- Every proxied tool call is intercepted: guards block, hints bundle with result, no-match passes through
- Claude emits `#lesson` tags and calls `lessons_add(...)` when it catches mistakes

### Cross-context lesson library

- Lessons captured in Claude Code are available in Claude Desktop after next `lessons build`
- Lessons captured in Claude Desktop are available in Claude Code after next `lessons build`
- Either context can run `/lessons:review` or `lessons_review` to promote candidates from both
- `lessons build` is called automatically by `lessons_add` and `lessons_promote`

---

## 9. Architecture: Components

### 9.1 Entry Point (`mcp/server.mjs`)

- Reads `../data/proxy-config.json` at startup
- Loads `../data/lesson-manifest.json` into memory
- Initializes proxy engine
- Registers resources, prompts, management tools
- Connects `StdioServerTransport`
- Spawns background `lessons_scan` on startup (non-blocking)

### 9.2 Proxy Engine (`mcp/proxy.mjs`)

- Spawns each `proxyServers[]` entry as a `StdioClientTransport` subprocess
- Calls `client.listTools()` on each; re-exports all tools with original schemas
- At tool call time: delegates to interceptor, or passes through
- Lifecycle: reconnect on crash, clean shutdown on SIGTERM

### 9.3 Interceptor (`mcp/interceptor.mjs`)

```
interceptCall(name, args, downstream, manifest, seenSet, cwd) →
  1. Detect source server → normalizeToolName(name, platform)
  2. Extract command/filePath from args
  3. Derive projectId from cwd (falls back to null for global-only matches)
  4. matchLessons(lessons, canonicalName, command, filePath, projectId)
  5. Filter: remove lessons tagged platform:claude-code
  6. if guard match   → return { content: [{ type:'text', text:'🚫 BLOCKED: ...' }], isError: true }
  7. if hint match    → result = await downstream(name, args)
                        return { content: [lessonBlock, ...result.content] }
  8. else             → return await downstream(name, args)
```

**Dedup:** Module-level `Set<string>` of injected slugs. Cleared on process restart (session-scoped).

### 9.4 Resources (`mcp/resources.mjs`)

| Resource URI              | Content                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `lessons://protocol`      | `#lesson` format + examples + all `protocol`/`directive` lessons |
| `lessons://directives`    | All `protocol`/`directive` type lessons as markdown              |
| `lessons://system-prompt` | Recommended system prompt snippet (plain text)                   |

### 9.5 Setup CLI (`scripts/lessons.mjs setup-mcp`)

```
setup-mcp [--dry-run] [--config-path <path>]

1. Detect platform (darwin/linux/win32)
2. Resolve Claude Desktop config path
3. Parse mcpServers; display numbered list with checkboxes
4. User selects servers to proxy
5. Build proxyServers[] entries (name, command, args, env)
6. Show unified diff of proposed changes
7. Confirm → write ../data/proxy-config.json, rewrite claude_desktop_config.json
8. Print system prompt snippet
```

---

## 10. Session-Start Injection

MCP has no session-start event. Three mechanisms compensate:

**System prompt (primary):** User pastes once into Claude Desktop project settings:

```
At the start of every session, read the lessons://protocol resource to load the
#lesson reporting format and current reasoning reminders.

When you encounter a problem→solution sequence:
  1. Emit a #lesson ... #/lesson tag in your response text
  2. Call lessons_add(...) to persist it immediately

Pay attention to any lesson block included in a tool response. Process it before
acting on the next step.
```

**`lessons://protocol` resource:** Same content as `session-start-lesson-protocol.mjs` — the `#lesson` format, examples, and all `protocol`/`directive` lessons. Available for Claude to read at any time.

**`lessons_session_start` MCP prompt:** Registered via the MCP prompts capability. Returns the same content as `lessons://protocol`.

---

## 11. Lesson Capture Flow

| Step                        | Claude Code                             | MCP Server                                    |
| --------------------------- | --------------------------------------- | --------------------------------------------- |
| Problem→solution identified | Claude emits `#lesson` tag              | Claude emits `#lesson` tag in response text   |
| Lesson persisted            | Background scanner on next SessionStart | Claude calls `lessons_add(...)` immediately   |
| Cancel unscanned tag        | `#lesson:cancel` in response            | Same; `lessons_cancel` archives DB records    |
| Tier 2 heuristic scan       | SessionStart                            | `lessons_scan` (manual or startup background) |
| Candidate review            | `/lessons:review`                       | `lessons_review` MCP tool                     |

---

## 12. Testing Strategy

### Unit tests (`tests/unit/mcp/`)

- `interceptor.test.mjs` — guard block, hint inject, no-match passthrough, dedup, platform filter
- `proxy.test.mjs` — tool re-export, downstream error handling, lifecycle
- `platform.test.mjs` — config path resolution on macOS/Linux/Windows

### Integration tests (`tests/integration/mcp/`)

- Spin up a mock downstream MCP server (in-process)
- End-to-end: guard match → block; hint match → lesson in response; no match → transparent
- Management tools: `lessons_add` → DB write → `lessons_list` returns it

### E2E tests (`tests/e2e/mcp/`)

```
tests/e2e/
└── mcp/
    ├── guard-block.test.mjs
    ├── hint-inject.test.mjs
    ├── no-match.test.mjs
    ├── management.test.mjs
    ├── capture-flow.test.mjs
    └── platform-filter.test.mjs
```

---

## 13. Platform Tag: Doctor Check Addition

The `/lessons:doctor` QA audit gains one new check (check 9):

**Platform tag missing for platform-exclusive tools:** A lesson whose `toolNames` contains only tools exclusive to one platform (e.g., `Agent`, `TodoWrite`, `WebFetch` which have no Desktop Commander equivalent) but carries no `platform:*` tag → suggest adding the appropriate tag.

This does not affect existing lessons that use canonical tool names (`Bash`, `Read`, `Edit`, etc.) — those correctly fire in both contexts via the normalization map.

---

## 14. Configuration Files

### `mcp/package.json`

```json
{
  "name": "lessons-learned-mcp",
  "version": "0.1.0",
  "type": "module",
  "main": "server.mjs",
  "bin": { "lessons-mcp": "server.mjs" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0"
  }
}
```

### `data/proxy-config.json` (generated by `setup-mcp`)

```json
{
  "version": 1,
  "proxyServers": [
    {
      "name": "desktop-commander",
      "command": "npx",
      "args": ["-y", "@wonderwhy-er/desktop-commander@latest"],
      "env": {}
    }
  ]
}
```

---

## 15. Differences Summary

| Behavior                | Claude Code (hooks)        | MCP Server (proxy)                         |
| ----------------------- | -------------------------- | ------------------------------------------ |
| Hint injection timing   | Before tool execution      | Bundled with tool result                   |
| Guard blocking          | Before tool execution      | Before forwarding to downstream            |
| Session-start injection | Automatic via hook         | Via system prompt + resource               |
| Subagent injection      | SubagentStart hook         | Not achievable in MCP                      |
| Dedup                   | Filesystem + env var       | In-memory Set (process lifetime)           |
| Lesson capture          | Automatic JSONL scan       | Explicit `lessons_add()` + background scan |
| Setup                   | Zero — hooks auto-register | One-time `setup-mcp`                       |
| Lesson database         | `data/lessons.db`          | Same file                                  |
| Platform filtering      | Skips `platform:mcp`       | Skips `platform:claude-code`               |

---

## 16. Documentation

- `docs/installation.md` — add "Claude Desktop (MCP)" section with `setup-mcp` walkthrough
- `docs/user-guide/mcp-server.md` — full reference: setup, system prompt, tool list, limitations
- `mcp/README.md` — quick-start for the `lessons-learned-mcp` package
- `CLAUDE.md` — add `mcp/` to architecture map; note injection timing difference and shared DB

:::note
**How this differs from the Claude Code plugin:** Informational lessons (hints) are injected into the tool _response_ rather than before execution — Claude self-corrects on the next step rather than before acting. Blocking lessons (guards) are fully equivalent. The SubagentStart hook has no MCP equivalent; sub-agent injection is not supported. Everything else — the lesson database, management tools, scanning, and review — is identical and shared.
:::
