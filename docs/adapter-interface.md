# Adapter Interface

The lessons-learned injection engine is split into platform-agnostic core logic and thin platform adapters.

```
core/match.mjs      — lesson matching (pure, no I/O)
core/select.mjs     — dedup + budget enforcement (pure, injected claimFn)
hooks/lib/          — Claude Code adapter utilities (stdin, output, dedup)
hooks/pretooluse-lesson-inject.mjs  — Claude Code PreToolUse adapter
```

To add support for a new platform (Codex, Gemini CLI, etc.), write a new adapter script that:

1. **Reads hook input** from stdin in the platform's format
2. **Calls core functions** (`matchLessons`, `findBlocker`, `selectCandidates`)
3. **Writes hook output** to stdout in the platform's format

---

## Core API

### `matchLessons(lessons, toolName, command, filePath) → Match[]`

```js
import { matchLessons, findBlocker } from '../core/match.mjs';
```

- `lessons` — `manifest.lessons` object from `data/lesson-manifest.json`
- `toolName` — the tool being invoked (map your platform's tool names to match manifest `toolNames`)
- `command` — shell command string (empty string if not a shell tool)
- `filePath` — file path (empty string if not a file tool)
- Returns matches sorted by priority descending

### `findBlocker(matches, command) → { reason } | null`

Returns the first blocking lesson with `{command}` substituted, or null if no blocker.

### `selectCandidates(matches, seenSet, opts) → { injected, dropped, seen }`

```js
import { selectCandidates } from '../core/select.mjs';
```

- `seenSet` — `Set<string>` of slugs already injected this session
- `opts.maxLessons` — cap on lessons per injection
- `opts.budgetBytes` — max total bytes for injected text
- `opts.claimFn(slug) → boolean` — returns true if this invocation wins the atomic claim (prevents duplicate injection across concurrent agents). For single-agent platforms, pass `() => true`.

---

## Platform Output Formats

### Claude Code (PreToolUse)

**Advisory injection:**

```json
{
  "hookSpecificOutput": { "additionalContext": "...markdown..." },
  "env": { "LESSONS_SEEN": "slug1,slug2" }
}
```

**Block:**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "...reason..."
  }
}
```

### Gemini CLI (BeforeTool)

**Block:**

```json
{ "decision": "deny", "reason": "...", "systemMessage": "..." }
```

Gemini CLI does not support advisory `additionalContext` injection via hooks — only block decisions. For advisory injection, emit context via a system prompt or session-start hook if the platform supports it.

### Codex / GitHub Copilot CLI (PreToolUse)

**Block:**

```json
{ "permissionDecision": "deny", "permissionDecisionReason": "..." }
```

---

## Tool Name Mapping

Manifest lessons use tool names that match Claude Code's tool naming. When writing an adapter for another platform, map the platform's tool names to these manifest names:

| Manifest `toolNames` | Claude Code | Gemini CLI          | Codex/Copilot          |
| -------------------- | ----------- | ------------------- | ---------------------- |
| `Bash`               | `Bash`      | `run_shell_command` | `run_terminal_command` |
| `Read`               | `Read`      | `read_file`         | `read_file`            |
| `Edit`               | `Edit`      | `edit_file`         | `edit_file`            |
| `Write`              | `Write`     | `write_file`        | `write_file`           |
| `Glob`               | `Glob`      | `find_files`        | `find_files`           |

Pass the **mapped** name as `toolName` to `matchLessons()` so the manifest's `toolNames` filter works correctly.

---

## Minimal Adapter Template

```js
#!/usr/bin/env node
// Adapter for [Platform Name]

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchLessons, findBlocker } from '../core/match.mjs';
import { selectCandidates } from '../core/select.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, '..', 'data', 'lesson-manifest.json');

// 1. Parse platform stdin
const raw = readFileSync(0, 'utf8').trim();
if (!raw) process.exit(0);
const platformInput = JSON.parse(raw);

// 2. Map platform fields to core fields
const toolName = mapToolName(platformInput.tool_name); // implement per platform
const command = platformInput.tool_input?.command ?? '';
const filePath = platformInput.tool_input?.file_path ?? '';

// 3. Load manifest
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const config = manifest.config ?? {};

// 4. Match
const matches = matchLessons(manifest.lessons ?? {}, toolName, command, filePath);
if (matches.length === 0) process.exit(0);

// 5. Block check
const blocker = findBlocker(matches, command);
if (blocker) {
  process.stdout.write(JSON.stringify(formatBlock(blocker.reason))); // implement per platform
  process.exit(0);
}

// 6. Select (no atomic claim needed for single-agent platforms)
const { injected } = selectCandidates(matches, new Set(), {
  maxLessons: config.maxLessonsPerInjection ?? 3,
  budgetBytes: config.injectionBudgetBytes ?? 4096,
  claimFn: () => true,
});

if (injected.length === 0) process.exit(0);

// 7. Format and emit platform output
process.stdout.write(JSON.stringify(formatInjection(injected))); // implement per platform
```
