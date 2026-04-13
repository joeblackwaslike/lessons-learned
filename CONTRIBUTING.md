# Contributing to lessons-learned

## Setup

```bash
git clone https://github.com/joeblackwaslike/lessons-learned.git
cd lessons-learned
npm ci
```

Pre-commit hooks are installed automatically via `npm ci` (Husky runs `prepare`). They enforce lint + typecheck on every commit.

## Running tests

```bash
npm test                  # all 188 tests
npm run test:unit         # pure function tests — fast, no I/O
npm run test:integration  # subprocess + real temp files
npm run test:e2e          # cross-agent protocol tests
npm run test:coverage     # with experimental coverage report
```

Tests never touch `data/`. Isolation is achieved via environment variables:

| Variable                 | Purpose                                              |
| ------------------------ | ---------------------------------------------------- |
| `LESSONS_MANIFEST_PATH`  | Override manifest path for hook subprocess tests     |
| `LESSONS_DATA_DIR`       | Override data directory for CLI and scan tests       |
| `LESSONS_AGENT_PLATFORM` | Set to `codex` or `gemini` for cross-agent E2E tests |

## Code quality

```bash
npm run lint          # ESLint (report only)
npm run lint:fix      # ESLint with auto-fix
npm run format        # Prettier (write)
npm run format:check  # Prettier (check only)
npm run typecheck     # tsc --checkJs --noEmit
```

All three gates run in CI on every push and PR.

## Adding a lesson

### Option 1 — Interactive CLI

```bash
node scripts/lessons.mjs add
```

The CLI prompts for summary, problem, solution, trigger patterns, and tags. It enforces validation rules before writing.

### Option 2 — Direct JSON edit

Edit `data/lessons.json` directly, then rebuild the manifest:

```bash
node scripts/lessons.mjs build
```

### Validation rules

`lessons add` enforces these before writing. Direct edits should respect them too:

- `summary`, `problem`, `solution` each ≥ 20 characters
- No unfilled template placeholders (`<what_went_wrong>` etc.)
- Summary must not end with `...`
- Trigger must not be a prose gerund (e.g. "running pytest")
- Jaccard similarity of `problem` vs all existing lessons must be < 0.5 (no near-duplicates)

### Trigger patterns

Lessons match tool calls via three trigger mechanisms:

```json
"triggers": {
  "commandPatterns": ["\\bpytest\\b(?!.*(--no-header))"],
  "pathPatterns": ["**/*.test.py", "pytest.ini"],
  "toolNames": ["Bash"],
  "sessionStart": true
}
```

- `commandPatterns` — regex array tested against the Bash command string
- `pathPatterns` — glob array tested against `Read`/`Edit`/`Write` file paths
- `toolNames` — exact match on tool name (e.g. inject on every `Bash` call)
- `sessionStart: true` — inject at session start instead of PreToolUse

### Blocking a tool call

Set `"block": true` and `"blockReason"` to deny the tool call entirely instead of injecting context:

```json
{
  "block": true,
  "blockReason": "Running pytest without --no-header hangs in this environment."
}
```

## Emitting lessons from sessions

During a session, Claude can emit a structured tag when it makes and corrects a mistake:

```
#lesson
tool: Bash
trigger: git stash
problem: git stash silently drops untracked files without -u flag
solution: Use `git stash -u` (--include-untracked) to include untracked files
tags: tool:git, severity:data-loss
#/lesson
```

Required fields: `problem` and `solution`. Optional: `tool`, `trigger`, `tags`.

Tags follow `category:value` format. Common categories: `lang:`, `tool:`, `severity:`, `topic:`.

## Scanning for lessons

```bash
node scripts/lessons.mjs scan              # incremental scan of session logs
node scripts/lessons.mjs scan candidates   # cross-project recurring patterns only
node scripts/lessons.mjs scan promote 3    # promote candidate #3 into the store
node scripts/lessons.mjs review            # review Tier 2 heuristic candidates
```

Tier 1 (structured `#lesson` tags) auto-promote. Tier 2 (heuristic) require `scan promote`.

## Test architecture

Tests live in three directories mirroring the production code:

```
tests/
  unit/           Pure function tests — no subprocess, no file I/O
    core/         matchLessons, selectCandidates
    hooks/        parsePayload, normalizeToolName, formatHookOutput, dedup
    scanner/      parseLessonTags, scanLineForLessons, extractors, HeuristicDetector
  integration/    Subprocess and real-file tests
    hook-pipeline.test.mjs    Full hook invocation via child_process.spawn
    cli-lessons.test.mjs      lessons add/build/list subcommands
    scan-incremental.test.mjs Incremental scanner with JSONL fixtures
  e2e/            Cross-agent protocol tests
    claude-code.test.mjs      CC baseline (default platform)
    codex.test.mjs            Codex tool name normalization
    gemini.test.mjs           Gemini CLI tool name normalization
    schema.test.mjs           Hook output schema contract validation
```

Integration and E2E tests use real temp directories (`os.tmpdir()`) cleaned up in `afterEach`. No mocking of file system or subprocesses.

## Architecture overview

```
hooks/
  pretooluse-lesson-inject.mjs     6-stage pipeline: parse → match → dedup → select → format → output
  session-start-lesson-protocol.mjs  Injects #lesson format + session-start lessons
  session-start-reset.mjs          Clears per-session dedup state
  session-start-scan.mjs           Fires background scan on startup
  subagent-start-lesson-protocol.mjs
  lib/
    stdin.mjs        parsePayload() — pure; parseHookInput() reads fd 0
    normalize-tool.mjs  Maps Codex/Gemini tool names to canonical CC names
    dedup.mjs        3-layer dedup: env var, temp file, O_EXCL lock
    output.mjs       formatHookOutput() / formatEmptyOutput()

core/
  match.mjs         matchLessons(manifest, toolName, command, path) → LessonMatch[]
  select.mjs        selectCandidates(matches, budget, config) → LessonMatch[]

scripts/
  lessons.mjs       Single CLI entry point — all management subcommands
  scanner/
    structured.mjs  parseLessonTags(), scanLineForLessons()
    extractor.mjs   extractFromStructured(), extractFromHeuristic(), scoring
    detector.mjs    HeuristicDetector — stateful sliding-window
    incremental.mjs Byte-offset state for incremental JSONL scanning

data/
  lessons.json          Source of truth — edit this
  lesson-manifest.json  Pre-compiled runtime manifest — regenerate with `lessons build`
  config.json           Injection and scanning configuration
```

## PR guidelines

- Keep PRs focused — one concern per PR
- New lessons should include a test case in the appropriate unit/integration test file
- Run `npm test` and `npm run lint` before opening a PR; CI will enforce both
- Follow the existing commit style (imperative mood, present tense)
