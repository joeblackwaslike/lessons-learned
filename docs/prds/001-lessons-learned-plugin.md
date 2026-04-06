# PRD-001: `lessons-learned` — Automatic Mistake Capture & Proactive Lesson Injection

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Status**       | Draft                                        |
| **Author**       | Joe Black                                    |
| **Created**      | 2026-03-28                                   |
| **Last Updated** | 2026-03-29                                   |
| **Stakeholders** | Individual developers using AI coding agents |

---

## 1. Problem Statement

AI coding agents (Claude Code, Codex, Gemini CLI) repeatedly make the same categories of mistakes across sessions. Each recurrence costs the developer time, tokens, and flow state. The agent has no memory of past mistakes — every session starts from zero.

**Current state**: Mistakes are corrected in-context, then forgotten. The next session hits the same pitfall.

**Desired state**: A system that automatically captures mistakes from conversation history, structures them as indexed lessons, and proactively injects relevant warnings before the agent can repeat the mistake.

### Developer Pain Points (Representative Examples)

These examples span the full development workflow — any developer using AI agents will recognize at least several:

- **Test runners**: pytest hangs due to TTY detection; jest `--forceExit` needed in watch mode; mocha requires explicit `--exit` in CI
- **Package management**: `pip install -e .` in wrong venv; `npm link` doesn't resolve peer deps; `pnpm` hoisting behavior differs from npm
- **Mock/patch targets**: Python `mock.patch` must target the _importing_ module's namespace, not the source module
- **CI/CD isolation**: pre-commit hooks run in isolated venvs — deps must be declared explicitly; GitHub Actions `services:` containers don't share localhost with the runner
- **CLI architecture**: Typer/Click subcommand patterns break positional args; argparse `nargs='*'` swallows subcommand names
- **File I/O race conditions**: sandbox filesystem tools can't see dirs created by shell; Docker build context doesn't include `.gitignore`d files
- **Git footguns**: `git stash` drops untracked files silently without `-u`; rebase onto wrong base loses commits
- **Database migrations**: Alembic autogenerate misses index changes; Django migration dependency cycles from circular model imports
- **Async pitfalls**: forgetting `await` on Python coroutine (silently returns coroutine object); Node.js unhandled promise rejection silently exits
- **Environment leaks**: `.env` loaded in wrong order; `NODE_ENV=production` left set in dev shell

---

## 2. Goals and Non-Goals

### Goals

1. **Automatically mine conversation logs** for mistake → correction patterns, with zero manual intervention after initial setup
2. **Structure lessons** with trigger patterns that enable proactive injection before the mistake recurs
3. **Inject relevant lessons** into the agent's context at the exact moment they're useful — when the agent is about to call a tool in a way that historically causes problems
4. **Support incremental discovery** — continuously learn from new sessions without re-processing old data
5. **Be fast** — the hot-path hook must complete in <50ms to avoid degrading agent performance
6. **Be cross-agent compatible** (V2) — core logic decoupled from any specific agent platform

### Non-Goals

1. Replacing agent training or fine-tuning — this is a runtime context injection system, not a model improvement
2. Handling non-coding domains — focused on software engineering tool usage
3. Real-time correction during a mistake — this is proactive (before the tool call), not reactive (after failure)
4. Building a general-purpose knowledge base — strictly scoped to mistake patterns and their prevention

---

## 3. User Stories

### US-1: Automatic Lesson Discovery

> As a developer using AI coding agents, I want the system to automatically scan my past conversation logs and extract mistake patterns so that I don't have to manually identify and document every pitfall.

**Acceptance Criteria**:

- Scanner processes all session JSONL files in `~/.claude/projects/`
- Incremental scanning: only processes new data since last scan
- Detects mistake → correction sequences with configurable heuristics
- Outputs structured candidate lessons with confidence scores
- Deduplicates against existing lessons via content hashing

### US-2: Proactive Lesson Injection

> As a developer, I want the system to automatically warn the AI agent about known pitfalls before it makes a tool call that historically causes problems, so that mistakes are prevented rather than corrected.

**Acceptance Criteria**:

- PreToolUse hook fires before Bash, Read, Edit, Write, and Glob tool calls
- Matches current tool input against lesson trigger patterns (command regex, file path globs)
- Injects relevant lessons as `additionalContext` that the agent sees before executing
- Respects injection budget (configurable, default 4KB) and cap (configurable, default 3 lessons)
- Negative lookahead in patterns prevents injection when the fix is already applied

### US-3: Session-Scoped Dedup

> As a developer, I want each lesson injected at most once per session (unless context is compacted), so that the agent isn't repeatedly nagged about the same thing.

**Acceptance Criteria**:

- 3-layer dedup: environment variable + session temp file + O_EXCL claim directory
- Handles parallel subagents without double-injection
- On context compaction: high-priority lessons (>= configurable threshold) are cleared from dedup for re-injection
- On session clear: all dedup state wiped

### US-4: Manual Lesson Management

> As a developer, I want to manually add, review, and manage lessons via CLI commands, so that I can contribute domain knowledge and curate auto-discovered lessons.

**Acceptance Criteria**:

- `/scan-lessons` command triggers a scan and presents candidates for review
- `/add-lesson` command accepts structured lesson input
- Manifest auto-rebuilds when lessons are added or modified
- Lessons have `needsReview` flag for auto-discovered entries below confidence threshold

### US-5: CLI Tool Intelligence Aggregation

> As a developer, when enough lessons accumulate for a specific tool (e.g., 5+ for pytest), I want them auto-aggregated into a coherent "tool intelligence" skill file rather than injected individually, reducing noise and improving context quality.

**Acceptance Criteria**:

- Build script groups lessons by `tool:*` tags
- When a tool reaches 5+ lessons, generates a skill file in `skills/cli-intel/`
- Skill files use standard SKILL.md frontmatter with commandPatterns
- Hook prefers the aggregated skill over individual lessons when available

---

## 4. Architecture Overview

### System Components

```text
┌─────────────────────────────────────────────────────────────────────┐
│                     lessons-learned Plugin                          │
│                                                                     │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────────┐ │
│  │  Log Scanner  │───▶│  Lesson Store     │───▶│  Manifest Builder │ │
│  │  (scripts/)   │    │  (data/lessons)   │    │  (scripts/)       │ │
│  └──────┬───────┘    └──────────────────┘    └───────┬───────────┘ │
│         │                                            │              │
│         ▼                                            ▼              │
│  ┌──────────────┐                            ┌───────────────────┐ │
│  │  Session JSONL │                            │  Manifest JSON    │ │
│  │  (~/.claude/)  │                            │  (data/manifest)  │ │
│  └──────────────┘                            └───────┬───────────┘ │
│                                                      │              │
│                                                      ▼              │
│                                              ┌───────────────────┐ │
│                                              │  PreToolUse Hook   │ │
│                                              │  (hooks/)          │ │
│                                              └───────┬───────────┘ │
│                                                      │              │
│                                                      ▼              │
│                                              ┌───────────────────┐ │
│                                              │  additionalContext │ │
│                                              │  → Agent sees      │ │
│                                              │    lesson before   │ │
│                                              │    tool executes   │ │
│                                              └───────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Offline**: Scanner reads session JSONL files → detects mistake patterns → produces candidates → classified into lessons → stored in `lessons.json`
2. **Build**: Manifest builder compiles `lessons.json` → `lesson-manifest.json` (pre-compiled regex, pre-rendered injection text)
3. **Runtime**: PreToolUse hook loads manifest → matches tool input against patterns → dedup check → injects relevant lessons as `additionalContext`

### Cross-Agent Compatibility (V2)

```text
lessons-learned/
├── core/                    # Pure Node.js — no agent-specific APIs
│   ├── matcher.mjs          # Pattern matching (regex test, priority sort)
│   ├── store.mjs            # Lesson CRUD (read, add, dedup, hash)
│   ├── manifest.mjs         # Manifest build/load/query
│   └── scanner/             # Log scanner (JSONL stream processing)
├── adapters/
│   ├── claude-code/         # hooks.json, stdin/stdout contract, O_EXCL dedup
│   ├── codex/               # Codex hook format (TBD)
│   └── gemini/              # Gemini CLI hook format (TBD)
└── data/                    # Shared lesson store + manifest
```

The **core** never imports agent-specific modules. Adapters handle:

- Hook registration format (hooks.json for Claude Code, equivalent for others)
- stdin/stdout JSON contract translation
- Dedup state persistence (each agent has different session ID formats)
- Context injection format (`additionalContext` vs. equivalent)

---

## 5. Reference Architecture: How the Vercel Plugin's Hook System Works

This plugin models its hook architecture on the Vercel plugin for Claude Code, which is the most sophisticated example of the pattern. Understanding it is essential for contributors.

### The Hook Lifecycle

When Claude Code is about to execute a tool (e.g., `Bash` with command `pytest -v tests/`):

1. Claude Code checks `hooks.json` for matching `PreToolUse` hooks
2. The hook matcher (e.g., `"Bash|Read|Edit|Write"`) determines if this tool triggers the hook
3. Claude Code spawns a child process: `node "${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse-lesson-inject.mjs"`
4. Claude Code pipes a JSON payload to the process's **stdin**:

   ```json
   {
     "tool_name": "Bash",
     "tool_input": { "command": "pytest -v tests/" },
     "session_id": "abc-123",
     "cwd": "/Users/joe/project",
     "agent_id": "main"
   }
   ```

5. The hook runs its pipeline and writes JSON to **stdout**:

   ```json
   {
     "hookSpecificOutput": {
       "additionalContext": "## Lesson: pytest TTY hanging\npytest hangs in Claude Code..."
     },
     "env": { "LESSONS_SEEN": "pytest-tty-hanging-x7k2" }
   }
   ```

6. Claude Code prepends `additionalContext` to the tool call's context — the agent sees this warning _before_ it sees the tool's output
7. The `env` keys become environment variables available to subsequent hook invocations
8. The tool executes normally

### The Vercel Plugin's Six-Stage Pipeline

| Stage                    | What it does                                                                                                                                                                                           | Perf |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| **1. parseInput**        | Read stdin, extract tool_name, tool_input, session_id. Reject unsupported tools immediately.                                                                                                           | <1ms |
| **2. loadSkills**        | Load `skill-manifest.json` — pre-compiled regex sources, summaries, injection text. Falls back to scanning SKILL.md files if manifest is missing.                                                      | <1ms |
| **3. matchSkills**       | For file tools: test file_path against glob-derived regex. For Bash: test command against regex. Returns `MatchReason` objects with the matching pattern and type.                                     | <2ms |
| **4. deduplicateSkills** | Merge 3 dedup sources (env var + session file + O_EXCL claim dir), filter already-seen, apply context-specific priority boosts, sort by effective priority.                                            | <2ms |
| **5. injectSkills**      | Read SKILL.md content for matched skills. Budget enforcement: first skill always fits; subsequent checked against 18KB budget. Falls back to summary field if too large. Claims via O_EXCL atomically. | <3ms |
| **6. formatOutput**      | Wrap in HTML comment markers (`<!-- skill:name -->`), embed metadata comment for debugging, write JSON to stdout.                                                                                      | <1ms |

**Total**: Consistently under 10ms, well within the 5-second hook timeout.

---

## 6. Our PreToolUse Hook: Stage-by-Stage Design

Our hook follows the same 6-stage architecture but is simpler: lessons are smaller than skills, and pre-rendered in the manifest (no file I/O at injection time).

### Stage 1: Parse Input

Read stdin JSON. Extract `tool_name`, `tool_input`, `session_id`, `agent_id`. If `tool_name` is not in `{Bash, Read, Edit, Write, Glob}`, output `{}` and exit immediately. This rejects ~40% of tool calls (Agent, WebSearch, etc.) with zero pattern matching.

### Stage 2: Load Manifest

`readFileSync` of `data/lesson-manifest.json` (~15KB for 100 lessons, <1ms). Reconstruct `RegExp` objects from stored `regexSources`. Each hook invocation is a fresh process, but the file is small enough that cold-loading is negligible.

**If manifest grows >50KB**: Pre-group lessons by `toolNames` into separate files and load only the relevant one.

### Stage 3: Match Lessons

**First-pass filter**: Skip any lesson whose `toolNames` array doesn't include the current `tool_name`. O(1) per lesson via Set.

**Pattern matching** (only for lessons passing first-pass):

- **Bash**: Test `tool_input.command` against `commandRegexSources`
- **Read/Edit/Write/Glob**: Test `tool_input.file_path` against `pathRegexSources`

Each match produces: `{ lessonId, slug, matchedPattern, matchType: "command"|"path" }`

**Negative lookahead**: Patterns like `\bpytest\b(?!.*(--no-header))` prevent injection when the fix is already applied, avoiding nagging.

### Stage 4: Deduplicate & Rank

1. Merge dedup state from 3 layers into `Set<string>`
2. Filter already-seen lessons
3. Optional tag boost: if project stack is detected (e.g., `pyproject.toml` exists → Python), boost matching `lang:` lessons by +1
4. Sort by `priority` DESC, then `confidence` DESC
5. Cap at `config.maxLessonsPerInjection`

### Stage 5: Inject

For each ranked lesson:

1. Read `injection` from manifest (pre-rendered markdown, ~100-200 bytes)
2. Budget check: first lesson always fits; subsequent checked against remaining `config.injectionBudgetBytes`
3. If `injection` exceeds budget, try `summary` fallback
4. Claim atomically: `fs.openSync(claimDir/slug, 'wx')` — EEXIST means another agent claimed it

### Stage 6: Format Output

```json
{
  "hookSpecificOutput": {
    "additionalContext": "[lessons-learned] Matched 2 lessons for Bash: pytest -v tests/\n\n## Lesson: pytest TTY hanging\n...\n\n## Lesson: verbose output stalls\n...\n\n<!-- lessonInjection: {\"version\":1,\"injected\":[...],\"dropped\":[]} -->"
  },
  "env": {
    "LESSONS_SEEN": "slug1,slug2,previously-seen-slug"
  }
}
```

HTML comment metadata enables debugging — inspect what was injected and why.

---

## 7. The 3-Layer Dedup System

Prevents the same lesson from being injected multiple times in a session. Three layers address different failure modes:

### Layer 1: Environment Variable (`LESSONS_SEEN`)

- **Mechanism**: Hook outputs `env: { "LESSONS_SEEN": "slug1,slug2" }`. Claude Code passes this as an env var to the next hook invocation.
- **Strengths**: Fast reads within a single agent's linear execution chain.
- **Limitation**: Subagents spawned in parallel don't share env vars.

### Layer 2: Session Temp File

- **Mechanism**: `$TMPDIR/lessons-<sha256(sessionId)>-seen.txt` — comma-delimited list of seen slugs.
- **Strengths**: Cross-agent persistence. Both Agent A and Agent B read/write the same file.
- **Limitation**: Not atomic under concurrent writes.

### Layer 3: O_EXCL Claim Directory

- **Mechanism**: Directory at `$TMPDIR/lessons-<sha256(sessionId)>-seen.d/`. To claim a lesson:

  ```js
  fs.openSync(path.join(claimDir, slug), 'wx'); // O_EXCL flag
  ```

  If the file already exists, `openSync` throws `EEXIST` — another agent already claimed it.

- **Strengths**: Atomic concurrent dedup. Even if two parallel subagents match the same lesson, only one wins.

### Merge Strategy

On each hook invocation: `seen = union(envVarSlugs, sessionFileSlugs, claimDirSlugs)`. A lesson is injected only if its slug is NOT in this merged set.

### Context Compaction Re-injection

When Claude's context window fills, Claude Code runs **compaction** — summarizing the conversation to free space. After compaction, Claude no longer remembers previously-injected lesson text. If the same pitfall scenario arises again, the lesson needs re-injection.

- On `compact` event: clear lessons with `priority >= config.compactionReinjectionThreshold` (default 7) from dedup state
- On `clear` event: wipe all dedup state
- On `startup`/`resume`: no-op

---

## 8. Priority and Confidence Scoring

### Priority Computation (Auto-Discovered Lessons)

Priority is a composite score from observable signals. All weights are configurable via `data/config.json` under the `scoring` key.

```text
basePriority = 3  (all auto-discovered lessons start here)

+multiSessionBonus (default +2)   if pattern seen across 2+ sessions
+multiProjectBonus (default +1)   if pattern seen across 2+ projects
+hangTimeoutBonus (default +1)    if mistake caused a hang or timeout
+dataLossBonus (default +1)       if mistake caused data loss or silent failure
+userCorrectionBonus (default +1) if user explicitly corrected the agent
+fixConfirmedBonus (default +1)   if the correction was followed by success
+singleOccurrencePenalty (default -1) if only seen once

Final priority = clamp(sum, 1, 10)
```

**Examples**:

| Pattern              | Signals                                               | Score             |
| -------------------- | ----------------------------------------------------- | ----------------- |
| pytest TTY hang      | 5 sessions, 3 projects, hang, user corrected          | 3+2+1+1+1 = **8** |
| Mock patch namespace | 3 sessions, 2 projects, user corrected, fix confirmed | 3+2+1+1+1 = **8** |
| Obscure pip flag     | 1 session, 1 project, no user correction              | 3-1 = **2**       |

Manually curated seed lessons start at priority 7-9 (human judgment > heuristics).

### Confidence Computation

Confidence reflects certainty that this is a real, recurring pattern (not noise):

```text
baseConfidence = 0.4  (heuristic detection is inherently uncertain)

+0.20 if error-correction pair clearly identified (tool error → fix → success)
+0.15 if user explicitly corrected the agent (strongest signal)
+0.10 if same pattern seen in 2+ sessions
+0.10 if same pattern seen in 2+ projects
+0.05 if correction text contains causal language ("because", "root cause", "the issue is")

Final confidence = clamp(sum, 0.0, 1.0)
```

Lessons with `confidence < config.minConfidence` (default 0.5) are stored but excluded from the manifest. They're flagged `"needsReview": true` for manual inspection via `/scan-lessons`.

---

## 9. Configuration

All tunable settings live in `data/config.json`:

```jsonc
{
  "$schema": "./schemas/config.schema.json",
  "type": "lessons-learned-config",
  "version": 1,

  // Injection behavior
  "injectionBudgetBytes": 4096,
  "maxLessonsPerInjection": 3,
  "minConfidence": 0.5,
  "minPriority": 1,
  "compactionReinjectionThreshold": 7,

  // Scanner behavior
  "scanPaths": ["~/.claude/projects/"],
  "autoScanIntervalHours": 24,
  "maxCandidatesPerScan": 50,

  // Scoring weights
  "scoring": {
    "multiSessionBonus": 2,
    "multiProjectBonus": 1,
    "hangTimeoutBonus": 1,
    "dataLossBonus": 1,
    "userCorrectionBonus": 1,
    "fixConfirmedBonus": 1,
    "singleOccurrencePenalty": -1,
  },
}
```

All data files (`config.json`, `lessons.json`, `lesson-manifest.json`) include `$schema`, `type`, and `version` fields. JSON Schema files in `schemas/` provide IDE autocomplete, validation, and hover docs.

The manifest snapshots config values at build time so the hook never reads `config.json` at runtime.

---

## 10. Data Schemas

### 10.1 Lesson Store (`data/lessons.json`)

```jsonc
{
  "$schema": "./schemas/lessons.schema.json",
  "type": "lessons-learned-store",
  "version": 1,
  "lessons": [
    {
      // --- Identity ---
      "id": "01JQXYZ...",
      // ULID — collision-free, naturally sorted by creation time.
      // 48-bit ms timestamp + 80-bit random. Lexicographic sort = chronological.

      "slug": "pytest-tty-hanging-x7k2",
      // Human-readable slug + 4-char random suffix for guaranteed uniqueness.
      // Format: kebab-case-summary-XXXX (X = base36 alphanumeric).
      // Used in dedup claim filenames, log output, CLI references.

      // --- Content ---
      "summary": "pytest hangs in non-interactive envs due to TTY detection",
      // One-line description. Self-contained. Fallback injection text when full
      // injection exceeds budget. Max ~100 chars.

      "mistake": "Running bare `pytest` or `pytest -v` in Claude Code causes the process to hang indefinitely because pytest's rich output module detects a non-interactive terminal and stalls.",
      // Root cause explanation. Explains WHY the failure occurs, not just the symptom.

      "remediation": "Use `python -m pytest --no-header -rN -p no:faulthandler` or prepend `TERM=dumb`. Pipe through `cat` if rich output is still suspected.",
      // Concrete fix. Actionable commands or code changes. Copy-pasteable where possible.

      "injection": "## Lesson: pytest TTY hanging\npytest hangs in Claude Code. Use:\n`python -m pytest --no-header -rN -p no:faulthandler`\nor prepend `TERM=dumb`.",
      // Pre-rendered markdown for hook injection. The ONLY field read in the hot path.
      // Kept under 200 bytes. Generated from summary + remediation at build time.

      // --- Trigger Patterns ---
      "triggers": {
        "toolNames": ["Bash"],
        // Which tools this lesson applies to. First-pass O(1) filter.

        "commandPatterns": ["\\bpytest\\b(?!.*(--no-header|-p no:faulthandler|TERM=dumb))"],
        // Regex patterns tested against command strings (Bash tool_input.command).
        // Negative lookahead prevents injection when the fix is already applied.

        "pathPatterns": [],
        // Glob patterns tested against file_path (Read/Edit/Write/Glob tools).
        // Compiled to regex at manifest build time.

        "contentPatterns": [],
        // (Tentative) Regex for file content or command output. TBD post-harvest.
      },

      // --- Metadata ---
      "priority": 8,
      // 1-10. Computed from scoring signals. See § Priority Computation.

      "confidence": 0.95,
      // 0.0-1.0. How certain this is a real, recurring pattern. See § Confidence.

      "needsReview": false,
      // True for auto-discovered lessons below confidence threshold.
      // Stored but not injected until confirmed.

      "tags": ["lang:python", "tool:pytest", "topic:testing", "env:claude-code", "severity:hang"],
      // Labeled tags (Datadog-style). Format: "category:value".
      //   lang:     — programming language (python, typescript, go, rust)
      //   tool:     — CLI tool or library (pytest, git, npm, pip, docker)
      //   topic:    — conceptual domain (testing, packaging, ci, filesystem, async)
      //   env:      — execution environment (claude-code, codex, docker, ci)
      //   severity: — failure type (hang, error, silent, data-loss)
      //   platform: — OS-specific (macos, linux, windows)

      // --- Provenance ---
      "sourceSessionIds": ["abc-123"],
      // Session IDs where this pattern was observed. Empty for manually authored seeds.

      "occurrenceCount": 5,
      // Times the scanner detected this pattern across sessions.

      "createdAt": "2026-03-28T14:00:00Z",
      "updatedAt": "2026-03-28T14:00:00Z",

      "contentHash": "sha256:a1b2c3...",
      // SHA-256 of (mistake + remediation + triggers). Scanner uses for dedup.
    },
  ],
}
```

### 10.2 Manifest (`data/lesson-manifest.json`)

```jsonc
{
  "$schema": "./schemas/manifest.schema.json",
  "type": "lessons-learned-manifest",
  "version": 1,

  "generatedAt": "2026-03-28T14:00:00Z",
  // When this manifest was last built. If lessons.json is newer, manifest is stale.

  "config": {
    // Snapshot of config values at build time.
    // Hook reads these instead of loading config.json at runtime.
    "injectionBudgetBytes": 4096,
    "maxLessonsPerInjection": 3,
    "minConfidence": 0.5,
    "minPriority": 1,
    "compactionReinjectionThreshold": 7,
  },

  "lessons": {
    "01JQXYZ...": {
      // Keyed by ULID for direct lookup.

      "slug": "pytest-tty-hanging-x7k2",
      // For logging and dedup claim filenames.

      "priority": 8,
      // For sort-time ranking without loading the full store.

      "toolNames": ["Bash"],
      // First-pass filter. Hook skips if current tool not in this array.

      "commandRegexSources": [
        { "source": "\\bpytest\\b(?!.*(--no-header|-p no:faulthandler|TERM=dumb))", "flags": "i" },
      ],
      // Pre-compiled regex sources for command matching.
      // Reconstruct at load time: new RegExp(source, flags).
      // No glob compilation or pattern parsing at runtime.

      "pathRegexSources": [],
      // Pre-compiled regex sources for file path matching.
      // Globs from lessons.json pathPatterns → regex at build time.

      "tags": ["lang:python", "tool:pytest"],
      // For optional tag-based priority boosting at runtime.

      "injection": "## Lesson: pytest TTY hanging\npytest hangs in Claude Code. Use:\n`python -m pytest --no-header -rN -p no:faulthandler`\nor prepend `TERM=dumb`.",
      // Pre-rendered markdown. The ONLY content the hook reads for injection.
      // No file I/O, no template rendering.

      "summary": "pytest hangs in non-interactive envs due to TTY detection",
      // Fallback if injection exceeds remaining budget.
    },
  },
}
```

---

## 11. Structured Self-Reporting via `#lesson` Tags

### The Core Insight

Instead of building complex heuristics to retroactively identify mistakes from the thousand ways an agent might phrase a correction, we **define the output format** and let the agent self-report. This inverts the problem: the scanner becomes a simple grep, not a natural language classifier.

### How It Works

A **SessionStart hook** injects a standing instruction into every session telling the agent to use a deterministic `#lesson` tag whenever it identifies a mistake, troubleshoots an issue, or resolves a problem. The instruction is compact and specific:

```markdown
## Lesson Reporting Protocol

When you encounter or recover from a mistake during this session, emit a structured
lesson tag in your response. This enables automatic capture for future prevention.

Format:
#lesson
tool: <tool_name>
trigger: <what_command_or_action_triggered_the_issue>
mistake: <what_went_wrong_and_why>
fix: <the_correction_that_resolved_it>
tags: <comma_separated_category:value_tags>
#/lesson

Example:
#lesson
tool: Bash
trigger: pytest -v tests/
mistake: pytest hangs in non-interactive environments due to TTY rich output detection
fix: Use `python -m pytest --no-header -rN -p no:faulthandler` or prepend TERM=dumb
tags: lang:python, tool:pytest, severity:hang
#/lesson

Emit this tag naturally as part of your response whenever you:

- Discover why a tool call failed and apply a different approach
- Catch yourself about to repeat a known mistake
- Receive a user correction ("no", "wrong", "that's not right")
- Identify a root cause after debugging

Do NOT force lesson tags where none apply. Only tag genuine mistake→correction sequences.
```

### Why This Is Transformative

| Aspect             | Heuristic Detection (Before)                    | Structured Self-Reporting (After)               |
| ------------------ | ----------------------------------------------- | ----------------------------------------------- |
| Scanner complexity | Sliding window, 5+ signal types, NLP heuristics | `grep '#lesson'` + JSON-like block parse        |
| Accuracy           | ~80% with false positives                       | ~95%+ (agent understands its own context)       |
| Trigger patterns   | Must be reverse-engineered from error text      | Agent provides them directly (`trigger:` field) |
| Root cause quality | Inferred from correction text                   | Agent explains it with full context             |
| Token cost         | Large context windows for heuristic analysis    | Minimal — structured blocks are small           |
| Speed              | ~2s for full scan                               | ~200ms for full scan (simple string match)      |
| Cross-agent        | Each agent phrases corrections differently      | Same tag format works for Claude, Codex, Gemini |

### The Two-Tier Scanner

The `#lesson` tag creates a **two-tier** detection architecture:

**Tier 1 (Primary): Structured tag detection**

- Scan for `#lesson` / `#/lesson` block boundaries in assistant messages
- Parse the semi-structured fields (tool, trigger, mistake, fix, tags)
- Extremely fast: raw string search, no JSON.parse needed for detection
- High confidence: the agent consciously decided to emit this tag

**Tier 2 (Fallback): Heuristic detection**

- For historical sessions that predate the `#lesson` tag injection
- For sessions where the agent didn't comply with the protocol
- Same sliding-window approach described in the original scanner design
- Lower confidence scores (the agent didn't self-identify these as lessons)

Over time, as more sessions include the `#lesson` tag instruction, Tier 2 becomes less important. Eventually it serves only as a safety net for edge cases.

### Compliance Validation

The critical question: **will agents actually emit `#lesson` tags consistently?**

This requires empirical validation before we can rely on it as the primary detection mechanism.

**Validation plan**:

1. **Phase 0 (Experiment)**: Before building the full scanner, inject the `#lesson` protocol via SessionStart hook for 2 weeks of normal development work.

2. **Measure compliance**: After 2 weeks, scan sessions for:
   - Count of `#lesson` tags emitted vs. count of mistake patterns detected by Tier 2 heuristics
   - Compliance rate = tags / (tags + heuristic-only detections)
   - Quality assessment: are the self-reported tags accurate and well-structured?

3. **Compliance thresholds**:
   - **>80% compliance**: Proceed with Tier 1 as primary, Tier 2 as fallback
   - **50-80% compliance**: Use both tiers equally, investigate why compliance drops (compaction? competing instructions? edge cases?)
   - **<50% compliance**: Re-evaluate the injection strategy — the instruction may need to be stronger, differently positioned, or the format simplified

4. **Known risks to compliance**:
   - **Context compaction**: After summarization, the `#lesson` instruction may be lost. Mitigation: the SessionStart hook re-injects on `compact` events.
   - **Instruction competition**: Other plugins/skills inject their own instructions. The `#lesson` protocol must be concise enough to survive priority triage.
   - **Agent discretion**: The instruction says "do NOT force lesson tags where none apply" — agents may be too conservative. We may need to tune the prompt.
   - **Subagent inheritance**: Subagents may not receive the SessionStart injection. Mitigation: inject via `SubagentStart` hook as well.

### Integration with the Hook System

The `#lesson` tag injection adds one new hook to `hooks.json`:

```json
{
  "SessionStart": [
    {
      "matcher": "startup|clear|compact",
      "hooks": [
        {
          "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start-lesson-protocol.mjs\""
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
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/subagent-start-lesson-protocol.mjs\""
        }
      ]
    }
  ]
}
```

Both hooks inject the same `#lesson` protocol instruction via `additionalContext`. The SessionStart hook also handles dedup reset (as designed in §7). The SubagentStart hook ensures spawned agents also know the protocol.

**Token cost**: The protocol instruction is ~200 tokens. Injected once per session (and once per subagent). Negligible compared to typical session length.

### Impact on Lesson Schema

Self-reported lessons arrive with richer, more accurate data than heuristic-detected ones:

| Field                      | Heuristic-detected                        | Self-reported via `#lesson`                |
| -------------------------- | ----------------------------------------- | ------------------------------------------ |
| `triggers.toolNames`       | Inferred from surrounding tool_use blocks | Provided directly (`tool:` field)          |
| `triggers.commandPatterns` | Reverse-engineered from error context     | Provided directly (`trigger:` field)       |
| `mistake`                  | Reconstructed from correction text        | Agent's own explanation (`mistake:` field) |
| `remediation`              | Extracted from the successful retry       | Agent's own fix (`fix:` field)             |
| `tags`                     | Inferred from context                     | Provided directly (`tags:` field)          |
| `confidence`               | 0.4-0.8 (heuristic uncertainty)           | 0.85+ (agent consciously reported it)      |
| `priority`                 | Computed from signals                     | Computed from signals + self-report bonus  |

The scoring formulas gain a new signal:

```text
basePriority adjustment:
+1  if lesson was self-reported via #lesson tag (agent consciously identified it)

baseConfidence adjustment:
+0.25 if self-reported via #lesson tag (replaces the +0.20 error-correction pair bonus)
```

### Impact on Implementation Phases

This shifts Phase 1 significantly:

**Phase 0 (NEW): Compliance Experiment**

1. Implement `hooks/session-start-lesson-protocol.mjs` (just the instruction injection)
2. Implement `hooks/subagent-start-lesson-protocol.mjs`
3. Add both to `hooks/hooks.json`
4. Install the plugin (even with no scanner or PreToolUse hook yet)
5. Use normally for 2 weeks
6. Run a simple grep-based audit: count `#lesson` occurrences in new session files
7. Assess compliance rate and tag quality
8. Decide whether Tier 1 or Tier 2 is the primary scanner

**Phase 1 then becomes**: Build scanner with Tier 1 (tag detection) primary + Tier 2 (heuristic) fallback, informed by real compliance data.

---

## 12. Log Scanner

### Overview

A Node.js CLI that processes session JSONL files to discover mistake → correction patterns. Uses a two-tier detection architecture: structured `#lesson` tag parsing (primary) and heuristic detection (fallback).

### Incremental Scanning

`scan-state.json` tracks per-file progress:

```json
{
  "version": 1,
  "lastScanAt": "2026-03-28T14:00:00Z",
  "files": {
    "/path/to/session.jsonl": {
      "byteOffset": 1548320,
      "mtimeMs": 1774723046519,
      "sizeBytes": 2750000
    }
  }
}
```

On each scan:

1. Enumerate `*.jsonl` files in `config.scanPaths`
2. Check `mtimeMs` and `sizeBytes` against scan state — skip unchanged files
3. For grown files: `createReadStream({ start: byteOffset })` to read only new data
4. Update scan state after processing

### Streaming Architecture

```text
createReadStream({ start: byteOffset })
  → readline (line-by-line, constant ~64KB buffer)
    → fast pre-filter: regex match "type":"assistant" before JSON.parse
      → Tier 1: scan for #lesson tags (simple string match)
      → Tier 2: sliding window heuristic detector (fallback)
```

**Memory**: Constant ~1MB regardless of file size.

**Speed**: ~100MB/s throughput. Full scan of 200MB (595 files): ~2 seconds. Incremental scan of 5MB new data: ~50ms.

### Tier 1: Structured Tag Detection (Primary)

Scans assistant message text blocks for `#lesson` / `#/lesson` boundaries:

```text
#lesson
tool: Bash
trigger: pytest -v tests/
mistake: pytest hangs due to TTY detection
fix: Use pytest --no-header -rN -p no:faulthandler
tags: lang:python, tool:pytest, severity:hang
#/lesson
```

**Detection**: Simple regex `/#lesson\n([\s\S]*?)#\/lesson/g` on each assistant text block. No sliding window, no NLP heuristics.

**Parsing**: Split block by newlines, extract `key: value` pairs. Flexible — unknown keys are ignored, missing keys get defaults.

**Confidence**: Self-reported lessons start at `confidence: 0.85` (agent consciously identified the pattern).

### Tier 2: Heuristic Detection (Fallback)

For historical sessions and compliance gaps. Operates on a sliding window of conversation turns:

| Pattern                                                                  | Signal                   | Confidence Boost |
| ------------------------------------------------------------------------ | ------------------------ | ---------------- |
| Tool error output → assistant correction text → new tool call            | Error-correction pair    | +0.20            |
| User says "no"/"wrong"/"that's not right" → assistant acknowledges       | Explicit user correction | +0.15            |
| Same tool called 3+ times with modifications                             | Retry loop               | +0.10            |
| Bash timeout or empty output after >30s                                  | Hang/stall               | +0.10            |
| Assistant text contains "can't", "doesn't", "the issue is", "root cause" | Self-diagnosis           | +0.05            |

### Classification Pipeline

**Three modes**:

1. **Tier 1 auto-classify** (for `#lesson` tagged entries): Parse structured fields directly into lesson schema. Minimal LLM involvement — just generate the `injection` field and refine `commandPatterns` regex from the `trigger:` text. Can run fully automated.

2. **LLM-assisted** (via `/scan-lessons` command): Scanner outputs Tier 2 heuristic candidates → current Claude session reviews, classifies, and structures them → writes to lesson store. Highest quality for untagged history.

3. **Fully automated heuristic** (`--auto` flag): Heuristic-only classification for Tier 2. Lower confidence, flagged `needsReview: true`.

---

## 13. CLI Tool Intelligence Aggregation

When lessons accumulate densely for a specific tool (5+ lessons tagged `tool:<name>`), they can be auto-aggregated into a coherent skill file:

```text
tool:pytest → 7 lessons → skills/cli-intel/pytest.md
tool:git    → 12 lessons → skills/cli-intel/git.md
tool:docker → 5 lessons  → skills/cli-intel/docker.md
```

Each generated skill follows SKILL.md format with frontmatter:

```markdown
---
metadata:
  name: cli-intel-pytest
  commandPatterns: ["\\bpytest\\b"]
  priority: 6
  summary: 'Known pytest pitfalls in AI agent environments'
---

# pytest: Known Pitfalls

## TTY Detection Hanging

pytest hangs in non-interactive environments...

## Verbose Output Stalling

The `...` in progress output triggers REPL detection...
```

**When to switch**: Once individual lessons for a tool exceed the 3-lesson cap, a unified skill is more coherent and provides complete tool-level guidance in one injection.

**Coexistence**: Individual lessons remain in the store for exact-match scenarios. The hook prefers the aggregated skill when available.

This is a **Phase 3+** feature.

---

## 14. Directory Structure

```text
lessons-learned/
├── .plugin/
│   └── plugin.json                         # Plugin manifest
├── hooks/
│   ├── hooks.json                          # Hook registrations
│   ├── pretooluse-lesson-inject.mjs        # Core: 6-stage match → inject pipeline
│   ├── session-start-reset.mjs             # Reset dedup on clear/compact
│   ├── session-start-lesson-protocol.mjs   # Inject #lesson self-reporting protocol
│   ├── subagent-start-lesson-protocol.mjs  # Inject #lesson protocol into subagents
│   └── lib/
│       ├── stdin.mjs                       # Parse hook stdin JSON
│       ├── dedup.mjs                       # O_EXCL file-lock dedup (3-layer)
│       └── output.mjs                      # Format hook stdout JSON
├── commands/
│   ├── scan-lessons.md                     # /scan-lessons slash command
│   └── add-lesson.md                       # /add-lesson for manual entry
├── scripts/
│   ├── scan.mjs                            # CLI: scan logs for candidates
│   ├── build-manifest.mjs                  # CLI: compile lessons.json → manifest
│   ├── add-lesson.mjs                      # CLI: add structured lesson to store
│   └── scanner/
│       ├── incremental.mjs                 # Byte-offset tracking per file
│       ├── structured.mjs                  # Tier 1: #lesson tag parser (primary)
│       ├── detector.mjs                    # Tier 2: heuristic pattern detection (fallback)
│       └── extractor.mjs                   # Extract candidate windows from matches
├── schemas/
│   ├── config.schema.json                  # JSON Schema for config.json
│   ├── lessons.schema.json                 # JSON Schema for lessons.json
│   └── manifest.schema.json               # JSON Schema for lesson-manifest.json
├── data/
│   ├── config.json                         # Plugin configuration
│   ├── lessons.json                        # Source of truth (seed + discovered)
│   ├── lesson-manifest.json                # Pre-compiled patterns (generated)
│   └── scan-state.json                     # Incremental scan bookmarks
├── package.json
└── README.md
```

---

## 15. Implementation Phases

### Phase 0: Compliance Experiment

0. Implement `session-start-lesson-protocol.mjs` — inject `#lesson` self-reporting protocol
1. Run 10-20 real coding sessions with the protocol active
2. Measure compliance: what % of mistakes produce a well-formed `#lesson` tag?
3. Categorize failures: missed entirely, malformed, incomplete fields, wrong timing
4. **Decision gate**: If compliance > 70%, Tier 1 (structured) is the primary scanner. If < 40%, Tier 2 (heuristic) is primary. Between 40-70%, both tiers run and results merge.

### Phase 1: Harvest & Schema Validation

5. Build `scripts/scan.mjs` and `scripts/scanner/` (structured parser + heuristic detector, extractor, incremental)
6. Run full scan against all existing sessions — collect ALL candidates
7. Analyze candidate shapes: what fields do they need? What trigger patterns emerge?
8. Finalize the lesson schema based on real data
9. Curate seed lessons from the best candidates

### Phase 2: Plugin Skeleton + Hook

10. Create `.plugin/plugin.json`, `package.json`, `schemas/`
11. Implement `scripts/build-manifest.mjs`
12. Implement `hooks/lib/stdin.mjs`, `hooks/lib/dedup.mjs`, `hooks/lib/output.mjs`
13. Implement `hooks/pretooluse-lesson-inject.mjs` (6-stage pipeline)
14. Implement `hooks/session-start-reset.mjs`, `hooks/subagent-start-lesson-protocol.mjs`, and `hooks/hooks.json`
15. **Test**: Install plugin, verify lessons inject correctly

### Phase 3: Store Operations + Commands + CLI Intelligence

16. Implement `scripts/add-lesson.mjs` (ULID generation, slug with random suffix)
17. Auto-rebuild manifest on lesson store changes
18. Create `commands/scan-lessons.md` and `commands/add-lesson.md`
19. Begin aggregating dense tool clusters into CLI intelligence skills

### Phase 4: Automation + Cross-Agent

20. Add SessionStart background scan trigger
21. Add `--auto` mode for heuristic-only classification
22. Refactor core logic into agent-agnostic `core/` module
23. Document adapter interface for Codex/Gemini

---

## 16. Key Design Decisions

| Decision         | Choice                                                    | Rationale                                                                        |
| ---------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| IDs              | ULID                                                      | Collision-free, chronological sort, no coordination needed                       |
| Slugs            | kebab-case + 4-char random suffix                         | Human-readable + guaranteed unique                                               |
| Tags             | Datadog-style `category:value`                            | Enables category-aware scoring and CLI tool aggregation                          |
| Pattern naming   | `commandPatterns` (not `bashPatterns`)                    | Agent-agnostic — applies to any shell/command tool                               |
| Config           | `data/config.json` with JSON Schema                       | Single source of truth, IDE autocomplete via `$schema`                           |
| All data files   | `$schema` + `type` + `version` fields                     | IDE validation, type discrimination, schema evolution                            |
| Indexing         | Linear scan with pre-compiled RegExp                      | <500 lessons expected; proven at 50+ skills in <5ms                              |
| Priority         | Composite score from configurable signals                 | Transparent, reproducible, tunable                                               |
| Confidence       | Composite score gating injection                          | Low-confidence lessons suppressed until reviewed                                 |
| Scanner          | Node.js streaming JSONL, byte-offset tracking             | Constant memory, incremental, ~100MB/s                                           |
| CLI intelligence | Auto-aggregate 5+ lessons per tool into skill             | Reduces noise, provides coherent tool-level guidance                             |
| Self-reporting   | `#lesson` structured tags injected via SessionStart       | Deterministic scanning (grep) vs. NLP heuristics; requires compliance validation |
| Two-tier scanner | Tier 1 structured (primary) + Tier 2 heuristic (fallback) | Structured tags for new sessions; heuristics for historical logs without tags    |
| Dependencies     | Zero npm deps for hooks                                   | Reliability — hooks must never fail due to missing packages                      |

---

## 17. Verification Plan

| Test                    | Method                                             | Criteria                                             |
| ----------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| Scanner accuracy        | Run against sessions with known mistakes           | Detects at least 80% of manually-identified patterns |
| Hook unit test          | Pipe JSON to hook, inspect stdout                  | Correct lesson injected for matching input           |
| Hook performance        | Time 100 invocations with 100+ lesson manifest     | p99 < 50ms                                           |
| Dedup correctness       | Same tool called twice in one session              | Lesson injected exactly once                         |
| Concurrent dedup        | Simulate 2 parallel subagents matching same lesson | Only one injection via O_EXCL                        |
| Compaction re-injection | Trigger compact event, re-match same tool          | High-priority lesson re-injects                      |
| Budget enforcement      | Create lesson with >4KB injection text             | Falls back to summary or drops                       |
| CLI intelligence        | Store 6 lessons tagged `tool:pytest`               | Skill file auto-generated                            |
| `#lesson` compliance    | Run 10-20 sessions with protocol active            | >70% well-formed tags from real mistakes             |
| Structured scanner      | Feed sessions with `#lesson` tags to Tier 1 parser | All well-formed tags extracted with correct fields   |
| End-to-end              | Install plugin, run `pytest tests/`                | Lesson appears in agent context                      |

---

## 18. Dependencies

| Dependency                                         | Scope   | Notes                                                   |
| -------------------------------------------------- | ------- | ------------------------------------------------------- |
| Node.js built-ins (fs, path, crypto, os, readline) | All     | Zero external dependencies for hooks and scanner        |
| `ulid` (npm) or inline implementation              | Scripts | ~20 lines if inlined; only used at lesson creation time |
| JSON Schema files                                  | Dev/IDE | Manual or generated from TypeScript types               |

---

## 19. Risks and Mitigations

| Risk                                           | Likelihood | Impact | Mitigation                                                                                    |
| ---------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------- |
| Hook adds latency to every tool call           | Low        | Medium | <10ms measured; early exit for unmatched tools                                                |
| False positive injections (irrelevant lessons) | Medium     | Low    | Negative lookahead patterns; confidence threshold; dedup prevents repeat                      |
| Scanner produces too much noise                | Medium     | Low    | Confidence scoring; `needsReview` flag; manual curation via `/scan-lessons`                   |
| Session JSONL format changes                   | Low        | High   | Version-check JSONL structure; fail gracefully on unknown formats                             |
| Lesson store grows unbounded                   | Low        | Low    | Content-hash dedup; CLI intelligence aggregation reduces individual count                     |
| Concurrent subagent race conditions            | Low        | Low    | O_EXCL claim directory provides atomic dedup                                                  |
| `#lesson` tag non-compliance                   | Medium     | Medium | Phase 0 compliance experiment; Tier 2 heuristic fallback; iterate on protocol wording         |
| `#lesson` protocol drift across models         | Low        | Medium | Protocol injected at session start, not baked into model weights; version the protocol format |

---

## 20. Success Metrics

| Metric                  | Target                              | How to Measure                                   |
| ----------------------- | ----------------------------------- | ------------------------------------------------ |
| Mistake recurrence rate | 50% reduction                       | Compare pre/post: count retry loops in sessions  |
| Hook latency            | p99 < 50ms                          | Performance test suite                           |
| Lesson coverage         | 80%+ of common patterns             | Cross-reference scanner output with manual audit |
| False positive rate     | < 10% of injections                 | Sample injections and assess relevance           |
| Developer time saved    | Measurable reduction in token waste | Compare session token usage before/after         |

---

## 21. Open Questions

The following questions need answers before or during implementation. They are grouped by phase to indicate when each becomes blocking.

### Phase 1 (Harvest & Schema — Blocking)

1. **Session JSONL stability**: Is the `~/.claude/projects/*/session.jsonl` format documented/stable, or should we expect breaking changes? Do we need a version check at parse time?

2. **Codex/Gemini log formats**: For cross-agent compatibility (V2), where do Codex and Gemini CLI store conversation logs? Same JSONL format, or entirely different? This determines whether the scanner core can be shared.

3. **Schema validation approach**: Should we generate JSON Schemas from TypeScript types (single source of truth, requires build step) or maintain them manually (simpler, risk of drift)?

4. **Content hash scope**: The `contentHash` deduplicates lessons. Should it hash just `mistake + remediation`, or also `triggers`? Including triggers means a lesson with refined patterns counts as "new" — is that desirable?

### Phase 2 (Plugin + Hook — Blocking)

5. **Plugin distribution**: How will this be installed? Personal GitHub repo + `extraKnownMarketplaces`? Or a local path for development? Is there a plugin publishing/registry process we should follow?

6. **Hook timeout**: The Vercel plugin uses a 5-second timeout. Is this the right value for our hook, or should we be more aggressive (e.g., 2s) to avoid impacting agent responsiveness?

7. **Tag-based priority boosting**: Should the hook attempt project stack detection (checking for `pyproject.toml`, `package.json`, etc.) to boost relevant lessons? This adds I/O to the hot path — is it worth it, or should we defer to Phase 3?

8. **Injection format**: Should lessons inject as plain markdown, or wrapped in a custom HTML tag/comment for structured parsing by the agent? The Vercel plugin uses `<!-- skill:name -->...<!-- /skill:name -->` — should we follow suit?

### Phase 3 (Commands + CLI Intelligence — Non-blocking)

9. **CLI intelligence threshold**: The current proposal auto-aggregates at 5+ lessons per tool. Is this the right threshold? Should it be configurable? Should aggregation be opt-in or opt-out?

10. **Lesson lifecycle**: Should lessons have an expiration or "last seen" date? If a lesson hasn't matched in 6 months, should it be automatically archived or demoted?

11. **Community contribution model**: If this becomes a shared tool, how should community-contributed lessons be submitted, reviewed, and merged? PR-based? A submit command? A lesson marketplace?

### Phase 4 (Automation — Non-blocking)

12. **Background scan trigger**: Should automated scanning be triggered by SessionStart (adds latency), SessionEnd (may not exist in all agents), or a system-level cron? What's the right tradeoff?

13. **Auto-discovered lesson review UX**: When the scanner finds new candidates in `--auto` mode, how should they surface for review? A notification on next session start? A counter in the status bar? A pending queue in `/scan-lessons`?

### Phase 0 (`#lesson` Compliance — Blocking)

14. **`#lesson` tag format stability**: Is the proposed `#lesson`/`#/lesson` delimiter format robust enough, or should we use a more structured format (e.g., YAML frontmatter, JSON block)? The current format optimizes for grep-ability — is that the right tradeoff vs. parse reliability?

15. **Compliance across model families**: The `#lesson` protocol is injected as context, not trained into the model. Different models (Claude, GPT, Gemini) may comply at different rates. Should we tune the protocol wording per model, or keep it universal and accept varying compliance rates?

16. **Subagent compliance**: Subagents spawned via the Agent tool get the protocol via `SubagentStart` hook. Do they comply at the same rate as the main agent? Are there tool-calling patterns where the subagent never encounters a "mistake moment" to report?

### Architecture (Informed by Real-World Demand)

17. **Project-specific vs. generalized lesson scoping**: Real-world demand signals (obra/superpowers#907, #601, #551) reveal two distinct user expectations:
    - **Generalized lessons**: "pytest hangs in non-interactive envs" — applies everywhere, regardless of project. These are the seed lessons we've built so far.
    - **Project-specific lessons**: "our CI uses custom runner X", "don't run migration Y in this repo", "reviewer prefers Z pattern" — meaningful only within a specific codebase/team.

    Our current design treats all lessons as global. But the demand signals suggest project-scoped lessons are equally (perhaps more) valuable. Key questions:
    - Should the lesson store have a `scope` field (`global` | `project:<path>` | `team:<name>`)?
    - Should project-specific lessons live in the repo (e.g., `.lessons/lessons.json`) vs. the global plugin data dir?
    - How do global and project-scoped lessons interact at injection time? Priority boost for project-local matches?
    - Does the scanner detect project-specific vs. general patterns differently?

### Cross-Cutting

18. **Privacy and sharing**: Session logs may contain sensitive data (API keys, internal URLs, proprietary code). Should the scanner redact sensitive content from lesson provenance fields? Should lessons ever be shareable across users/teams?

19. **Telemetry**: Should we track injection frequency, match rates, and dedup behavior to tune the system? If so, where does telemetry go — local file, or opt-in remote?

20. **Offline vs. connected**: Should this plugin ever phone home (for lesson sharing, updates, telemetry)? Or is it strictly offline-first?

---

_This PRD is a living document. Update it as open questions are resolved and as harvesting results refine the schema._
