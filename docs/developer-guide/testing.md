# Testing

lessons-learned uses Node.js built-in `node:test` with `node:assert/strict`. No additional test runtime dependencies.

**188 tests** across three tiers: unit, integration, and E2E.

---

## Running tests

```bash
npm test                  # all 188 tests
npm run test:unit         # pure function tests — fast, no I/O
npm run test:integration  # subprocess + real temp files
npm run test:e2e          # cross-agent protocol tests
npm run test:coverage     # with experimental coverage report
```

Or directly:

```bash
node --test 'tests/**/*.test.mjs'
node --test 'tests/unit/**/*.test.mjs'
node --test 'tests/integration/**/*.test.mjs'
node --test 'tests/e2e/**/*.test.mjs'
node --test --experimental-test-coverage 'tests/**/*.test.mjs'
```

---

## Test isolation

Tests never touch `data/`. Isolation is achieved via environment variables:

| Variable                 | Purpose                                              |
| ------------------------ | ---------------------------------------------------- |
| `LESSONS_MANIFEST_PATH`  | Override manifest path for hook subprocess tests     |
| `LESSONS_DATA_DIR`       | Override data directory for CLI and scan tests       |
| `LESSONS_AGENT_PLATFORM` | Set to `codex` or `gemini` for cross-agent E2E tests |

Temp directories use `os.tmpdir()` and are cleaned up in `afterEach`. No mocking of the file system or subprocess calls.

---

## Test structure

```
tests/
  unit/
    core/
      match.test.mjs         matchLessons, findBlocker
      select.test.mjs        selectCandidates
    hooks/
      output.test.mjs        formatHookOutput, formatEmptyOutput
      stdin.test.mjs         parseHookInput
      dedup.test.mjs         loadSeenSet, claimLesson, persistSeenState
    scanner/
      structured.test.mjs    parseLessonTags, scanLineForLessons
      extractor.test.mjs     extractFromStructured, extractFromHeuristic, scoring
      detector.test.mjs      HeuristicDetector
  integration/
    hook-pipeline.test.mjs   stdin→stdout subprocess tests
    cli-lessons.test.mjs     lessons add/build/list subcommands
    scan-incremental.test.mjs scanner against fixture JSONL
  e2e/
    claude-code.test.mjs     CC protocol round-trips
    codex.test.mjs           Codex tool name normalization
    gemini.test.mjs          Gemini CLI tool name normalization
    schema.test.mjs          Output schema contract validation across agents
  fixtures/
    minimal-manifest.json    2 lessons: 1 matching, 1 blocking
    session-with-lesson.jsonl JSONL with embedded #lesson tag
    session-no-lesson.jsonl  JSONL without any lesson tags
    lessons-store.json       Minimal lessons.json for CLI tests
  helpers/
    subprocess.mjs           spawn + collect stdout/stderr
    tmpstore.mjs             isolated temp lessons store
    fixtures.mjs             loads fixture files by name
```

---

## Tier 1 — Unit tests

Pure functions and isolated modules. Fast, no I/O, run on every save.

**Target: 95–100% line coverage on core modules.**

### `core/match.mjs`

Tests for `matchLessons` and `findBlocker`:

- Command pattern match / no match
- Path pattern match / no match
- Tool name filter (wrong toolName excluded)
- Priority sort (multiple matches sorted descending)
- Invalid regex skipped (no throw)
- `findBlocker`: first blocking lesson returned, `{command}` substituted
- `findBlocker`: command truncated at 120 chars

### `core/select.mjs`

Tests for `selectCandidates`:

- Basic injection (1 match → 1 injected)
- Dedup: already-seen slug excluded
- `maxLessons` cap (4 matches, cap=3 → 3 injected)
- Budget: second lesson fits
- Budget: second lesson too large → summary fallback
- Budget: summary also too large → dropped
- First lesson always injected regardless of budget
- `claimFn` returning false → dropped

### `hooks/lib/output.mjs`

- `formatEmptyOutput` returns `'{}'`
- Context + `lessonsSeen` present in output
- Metadata `<!-- lessonInjection -->` comment appended
- All variants parse as valid JSON

### `hooks/lib/stdin.mjs`

- Valid Bash payload parsed correctly
- Unsupported tool returns `null`
- Malformed JSON returns `null`
- Missing `session_id` defaults to `''`

### `hooks/lib/dedup.mjs`

- `loadSeenSet`: reads env var, temp file, claim directory
- `loadSeenSet`: merges all three sources
- `claimLesson`: first claim succeeds, second fails (O_EXCL)
- `persistSeenState`: writes slugs to file

### `scripts/scanner/structured.mjs`

- Tag with all fields parsed correctly
- Multiple tags in one block
- Tag inside code fence (fence delimiters stripped)
- Missing `problem` or `solution` → skipped

---

## Tier 2 — Integration tests

Pipeline stages wired together. Require real files, subprocess invocations.

### Hook pipeline (`hook-pipeline.test.mjs`)

Pipes JSON to `pretooluse-lesson-inject.mjs` as a subprocess, asserts on stdout:

- Matching command → injects lesson (has `additionalContext`)
- Non-matching command → `{}`
- Blocking lesson → `permissionDecision: "deny"`
- Already-seen slug (env var `LESSONS_SEEN` set) → `{}`
- Malformed stdin → `{}`, exit 0
- Missing manifest → `{}`, exit 0
- Read tool with matching path
- `env.LESSONS_SEEN` set in output

### CLI (`cli-lessons.test.mjs`)

Invokes `lessons add`, `lessons build`, `lessons list` as subprocesses against a temp store:

- `add --json` → lesson appears in store
- `add` → manifest rebuilt automatically
- Duplicate content hash rejected (exit non-zero)
- Fuzzy duplicate (Jaccard ≥ 0.5) rejected
- Validation failure (short mistake) rejected with message
- `build`: excluded lessons absent from manifest
- `list --json`: valid JSON array

### Scanner (`scan-incremental.test.mjs`)

Scanner against fixture JSONL files:

- `scan --tier1-only --dry-run` → candidate extracted from tagged file
- Incremental: second scan skips processed bytes (offset advanced)
- `scan --full` resets offsets
- Scan on empty directory → exits 0

---

## Tier 3 — E2E / cross-agent tests

Full hook invocation from stdin to stdout across different agent protocols.

### Claude Code (`claude-code.test.mjs`)

Baseline protocol validation:

| Input                                 | Expected output                                |
| ------------------------------------- | ---------------------------------------------- |
| `tool_name: "Bash"`, matching command | `hookSpecificOutput.additionalContext` present |
| `tool_name: "Read"`, matching path    | `additionalContext` present                    |
| `tool_name: "Bash"`, blocking lesson  | `permissionDecision: "deny"`                   |
| `tool_name: "Bash"`, no match         | Exactly `{}`                                   |

### Codex (`codex.test.mjs`)

With `LESSONS_AGENT_PLATFORM=codex`:

- `tool_name: "shell"` → maps to `Bash`, command pattern fires
- `tool_name: "read_file"` → maps to `Read`, path pattern fires
- `tool_name: "apply_patch"` → maps to `Edit`, path pattern fires
- Unknown Codex tool → `{}`, no error

### Gemini CLI (`gemini.test.mjs`)

With `LESSONS_AGENT_PLATFORM=gemini`:

- `tool_name: "run_shell_command"` → maps to `Bash`
- `tool_name: "read_file"` → maps to `Read`
- `tool_name: "replace_in_file"` → maps to `Edit`
- Unknown Gemini tool → `{}`, no error

### Schema validation (`schema.test.mjs`)

Cross-agent output schema contract:

- Inject output is valid JSON
- Only known keys present (no extra keys)
- Block output has `permissionDecision: "deny"` (exact string)
- Empty output is exactly `"{}"` (not `null`, not `"{ }"`)

---

## Coverage targets

| Module                               | Target | Covered by                   |
| ------------------------------------ | ------ | ---------------------------- |
| `core/match.mjs`                     | 100%   | Unit + integration           |
| `core/select.mjs`                    | 100%   | Unit + integration           |
| `hooks/lib/output.mjs`               | 100%   | Unit + integration           |
| `hooks/lib/stdin.mjs`                | 95%    | Unit + integration           |
| `hooks/lib/dedup.mjs`                | 85%    | Unit + integration           |
| `hooks/pretooluse-lesson-inject.mjs` | 90%    | Integration                  |
| `scripts/scanner/structured.mjs`     | 95%    | Unit + integration           |
| `scripts/scanner/extractor.mjs`      | 90%    | Unit + integration           |
| `scripts/scanner/detector.mjs`       | 80%    | Unit                         |
| `scripts/scanner/incremental.mjs`    | 85%    | Integration                  |
| `scripts/lessons.mjs`                | 70%    | Integration (CLI subprocess) |

**Excluded from coverage targets:**

- `hooks/session-start-*.mjs` — thin glue scripts, tested manually during deployment validation
- `data/*.json` — not code
- `schemas/` — not code
