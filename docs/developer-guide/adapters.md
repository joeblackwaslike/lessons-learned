# Adapters

The injection engine separates platform-agnostic core logic from thin platform adapters. Adding support for a new agent means writing an adapter — not touching the core.

---

## Architecture

```
core/match.mjs    — lesson matching (pure, no I/O)
core/select.mjs   — dedup + budget enforcement (pure, injected claimFn)
hooks/lib/        — Claude Code adapter utilities
hooks/pretooluse-lesson-inject.mjs  — Claude Code PreToolUse adapter
```

An adapter is a script that:

1. **Reads** hook input from stdin in the platform's format
2. **Calls** `matchLessons`, `findBlocker`, `selectCandidates` from core
3. **Writes** hook output to stdout in the platform's format

---

## Core API

### `matchLessons(lessons, toolName, command, filePath) → Match[]`

```js
import { matchLessons, findBlocker } from '../core/match.mjs';

const matches = matchLessons(
  manifest.lessons, // manifest.lessons object from lesson-manifest.json
  'Bash', // canonical tool name (map your platform's names here)
  'pytest tests/', // shell command string (empty if not a shell tool)
  '' // file path (empty if not a file tool)
);
// Returns Match[] sorted by priority descending
```

### `findBlocker(matches, command) → { reason } | null`

```js
const blocker = findBlocker(matches, command);
if (blocker) {
  // blocker.reason has {command} substituted and truncated to 120 chars
}
```

### `selectCandidates(matches, seenSet, opts) → { injected, dropped, seen }`

```js
import { selectCandidates } from '../core/select.mjs';

const { injected, dropped, seen } = selectCandidates(matches, new Set(), {
  maxLessons: 3, // cap on lessons per injection
  budgetBytes: 4096, // max total bytes for injected text
  claimFn: () => true, // atomic claim — use O_EXCL lock for multi-agent platforms
});
```

For single-agent platforms, `claimFn: () => true` is sufficient. For platforms with concurrent tool calls (like Claude Code with subagents), use an O_EXCL lock per slug to prevent duplicate injection.

---

## Tool name mapping

Manifest lessons use canonical tool names that match Claude Code's naming. Map your platform's tool names before calling `matchLessons`:

| Canonical | Claude Code | Gemini CLI          | Codex         | opencode |
| --------- | ----------- | ------------------- | ------------- | -------- |
| `Bash`    | `Bash`      | `run_shell_command` | `shell`       | `Bash`   |
| `Read`    | `Read`      | `read_file`         | `read_file`   | `Read`   |
| `Edit`    | `Edit`      | `replace_in_file`   | `apply_patch` | `Edit`   |
| `Write`   | `Write`     | `write_file`        | `write_file`  | `Write`  |
| `Glob`    | `Glob`      | `find_files`        | `find_files`  | `Glob`   |

The built-in normalization is in `hooks/lib/normalize-tool.mjs`. Set `LESSONS_AGENT_PLATFORM` before invoking the hook to enable platform-specific normalization:

```bash
LESSONS_AGENT_PLATFORM=gemini node hooks/pretooluse-lesson-inject.mjs
LESSONS_AGENT_PLATFORM=codex  node hooks/pretooluse-lesson-inject.mjs
```

---

## Platform output formats

### Claude Code (PreToolUse)

**Advisory injection** — injects context before the tool runs:

```json
{
  "hookSpecificOutput": {
    "additionalContext": "## Lesson: git stash drops untracked files\n..."
  },
  "env": {
    "LESSONS_SEEN": "git-stash-untracked-5x3q"
  }
}
```

**Block** — denies the tool call entirely:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "pytest without --no-header hangs. Rerun as: pytest --no-header tests/"
  }
}
```

**No match:**

```json
{}
```

### Gemini CLI (BeforeTool)

Gemini CLI's `BeforeTool` hook supports `additionalContext` injection in recent versions. Older versions support only block decisions.

**Advisory injection** (recent versions):

```json
{
  "additionalContext": "## Lesson: ..."
}
```

**Block:**

```json
{
  "decision": "deny",
  "reason": "...",
  "systemMessage": "..."
}
```

Check your Gemini CLI version. If `additionalContext` is not supported, advisory injection can be achieved via a system prompt or session-start hook instead.

### Codex (PreToolUse)

**Block:**

```json
{
  "permissionDecision": "deny",
  "permissionDecisionReason": "..."
}
```

Codex does not support advisory `additionalContext` injection. Use `sessionStart: true` lessons for important reminders that should be present in the system prompt.

### opencode

opencode uses the same hook protocol as Claude Code (same tool names, same output schema). No `LESSONS_AGENT_PLATFORM` override needed.

---

## Minimal adapter template

```js
#!/usr/bin/env node
// Adapter for [Platform Name]
// Usage: LESSONS_AGENT_PLATFORM=myplatform node this-adapter.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchLessons, findBlocker } from '../core/match.mjs';
import { selectCandidates } from '../core/select.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH =
  process.env.LESSONS_MANIFEST_PATH ?? join(__dirname, '..', 'data', 'lesson-manifest.json');

// Tool name map for this platform
const TOOL_MAP = {
  my_shell_tool: 'Bash',
  my_read_tool: 'Read',
  my_edit_tool: 'Edit',
  my_write_tool: 'Write',
  my_find_tool: 'Glob',
};

function mapToolName(platformName) {
  return TOOL_MAP[platformName] ?? platformName;
}

// 1. Parse stdin
let raw;
try {
  raw = readFileSync(0, 'utf8').trim();
} catch {
  process.exit(0);
}
if (!raw) process.exit(0);

let input;
try {
  input = JSON.parse(raw);
} catch {
  process.stdout.write('{}');
  process.exit(0);
}

// 2. Extract fields
const toolName = mapToolName(input.tool_name ?? '');
const command = input.tool_input?.command ?? '';
const filePath = input.tool_input?.file_path ?? '';

// 3. Load manifest
let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
} catch {
  process.stdout.write('{}');
  process.exit(0);
}

const config = manifest.config ?? {};

// 4. Match
const matches = matchLessons(manifest.lessons ?? {}, toolName, command, filePath);
if (matches.length === 0) {
  process.stdout.write('{}');
  process.exit(0);
}

// 5. Block check
const blocker = findBlocker(matches, command);
if (blocker) {
  // Adapt to your platform's block format
  process.stdout.write(
    JSON.stringify({
      permissionDecision: 'deny',
      permissionDecisionReason: blocker.reason,
    })
  );
  process.exit(0);
}

// 6. Select
const { injected } = selectCandidates(matches, new Set(), {
  maxLessons: config.maxLessonsPerInjection ?? 3,
  budgetBytes: config.injectionBudgetBytes ?? 4096,
  claimFn: () => true,
});

if (injected.length === 0) {
  process.stdout.write('{}');
  process.exit(0);
}

// 7. Format and emit
const context = injected.map(m => m.injection).join('\n\n---\n\n');
// Adapt to your platform's injection format
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { additionalContext: context },
  })
);
```

---

## Gemini CLI

Set `LESSONS_AGENT_PLATFORM=gemini` in your hook command so the built-in normalizer maps Gemini tool names correctly:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "run_shell_command|read_file|write_file|replace_in_file|find_files",
        "hooks": [
          {
            "type": "command",
            "command": "LESSONS_AGENT_PLATFORM=gemini node \"/path/to/hooks/pretooluse-lesson-inject.mjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

!!! note "Advisory injection support"
Gemini CLI's `BeforeTool` hook supports `additionalContext` in recent versions. Check your CLI version — older versions only support block decisions.

## Codex

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
            "command": "LESSONS_AGENT_PLATFORM=codex node \"/path/to/hooks/pretooluse-lesson-inject.mjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```
