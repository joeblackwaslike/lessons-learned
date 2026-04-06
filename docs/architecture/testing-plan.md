# Testing Plan

**Last updated:** 2026-04-01

---

## Philosophy

Tests are organized in three tiers matching how failure propagates:

1. **Unit** — pure functions and isolated modules; fast, no I/O, run on every save
2. **Integration** — pipeline stages wired together; require real files, real manifests, subprocess invocations
3. **E2E / cross-agent** — full hook invocation from stdin to stdout across different agent protocols

Coverage target: **≥ 85% line coverage** across `core/` and `hooks/lib/`. Scanner modules target **≥ 80%** given their I/O-heavy nature.

---

## Test Framework

**Node.js built-in `node:test`** with `node:assert/strict`. No additional runtime dependencies.

```bash
node --test                         # run all tests
node --test --test-coverage         # with coverage report
node --test tests/unit/             # unit only
node --test tests/integration/      # integration only
```

Fixtures live in `tests/fixtures/`. Helpers in `tests/helpers/`.

---

## Unit Tests

### `core/match.mjs` — `matchLessons` + `findBlocker`

**Coverage target: 100%** (pure functions, fully deterministic)

| Test                                   | What it verifies                                                  |
| -------------------------------------- | ----------------------------------------------------------------- |
| `commandPattern match`                 | A lesson with a matching `commandRegexSources` is returned        |
| `commandPattern no match`              | Non-matching command returns empty array                          |
| `pathPattern match`                    | A lesson with matching `pathRegexSources` on filePath is returned |
| `pathPattern no match`                 | Non-matching path returns empty                                   |
| `toolName filter`                      | Lesson with wrong `toolNames` is excluded even if pattern matches |
| `priority sort`                        | Multiple matches returned sorted priority descending              |
| `invalid regex skipped`                | Lesson with unparseable regex is silently skipped, no throw       |
| `findBlocker returns first blocking`   | First `block: true` lesson returned, `{command}` substituted      |
| `findBlocker skips non-blocking`       | No blocker if no lesson has `block: true`                         |
| `findBlocker command truncated at 120` | `{command}` capped at 120 chars in blockReason                    |
| `empty lessons object`                 | Returns `[]` gracefully                                           |
| `missing fields on lesson`             | Defaults applied correctly (`block: false`, `priority: 5`)        |

### `core/select.mjs` — `selectCandidates`

**Coverage target: 100%**

| Test                                                 | What it verifies                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `basic injection`                                    | 1 match → 1 injected, claimFn called, seen set updated                      |
| `dedup: already seen slug excluded`                  | Slug in seenSet → not injected                                              |
| `maxLessons cap`                                     | 4 matches, maxLessons=3 → first 3 injected                                  |
| `budget: second lesson fits`                         | Two lessons within budget → both injected                                   |
| `budget: second lesson too large → summary fallback` | Lesson text exceeds remaining bytes → falls back to `**Lesson**: {summary}` |
| `budget: summary also too large → dropped`           | Neither text nor summary fits → slug in dropped                             |
| `first lesson always injected regardless of budget`  | Even if text > budgetBytes, first lesson is injected                        |
| `claimFn returns false → dropped`                    | Concurrent claim lost → slug in dropped                                     |
| `claimFn called once per candidate`                  | claimFn invocation count matches candidates attempted                       |
| `empty matches → empty injected`                     | Returns `{ injected: [], dropped: [], seen: original }`                     |
| `seen set is a new Set (not mutated input)`          | Input seenSet is not mutated                                                |

### `hooks/lib/output.mjs` — `formatHookOutput` + `formatEmptyOutput`

**Coverage target: 100%**

| Test                           | What it verifies                                                         |
| ------------------------------ | ------------------------------------------------------------------------ |
| `formatEmptyOutput`            | Returns `'{}'` string                                                    |
| `with context and lessonsSeen` | Output has `hookSpecificOutput.additionalContext` and `env.LESSONS_SEEN` |
| `with context only (no seen)`  | No `env` key if lessonsSeen is empty/null                                |
| `no context (empty string)`    | No `hookSpecificOutput` key                                              |
| `metadata comment present`     | `<!-- lessonInjection: {...} -->` appended to additionalContext          |
| `output is valid JSON`         | JSON.parse succeeds on all variants                                      |

### `hooks/lib/stdin.mjs` — `parseHookInput`

**Coverage target: 95%** (fd 0 read is mocked via stdin fixture injection)

| Test                                        | What it verifies                                                   |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `valid Bash payload`                        | Returns `{ toolName: 'Bash', toolInput, sessionId, agentId, cwd }` |
| `valid Read payload`                        | Returns with `toolName: 'Read'`                                    |
| `unsupported tool (Task)`                   | Returns `null`                                                     |
| `malformed JSON`                            | Returns `null`                                                     |
| `empty stdin`                               | Returns `null`                                                     |
| `missing tool_name`                         | Returns `null`                                                     |
| `missing session_id → empty string default` | `sessionId` defaults to `''`                                       |
| `missing cwd → empty string default`        | `cwd` defaults to `''`                                             |

### `hooks/lib/dedup.mjs` — `loadSeenSet`, `claimLesson`, `persistSeenState`

**Coverage target: 85%** (uses real tmpdir, no mocking needed)

| Test                                          | What it verifies                             |
| --------------------------------------------- | -------------------------------------------- |
| `loadSeenSet: empty (no env, no files)`       | Returns empty Set                            |
| `loadSeenSet: reads env var LESSONS_SEEN`     | Set contains slugs from env                  |
| `loadSeenSet: reads seen file`                | Set contains slugs from temp file            |
| `loadSeenSet: reads claim directory`          | Set contains entries from claim dir          |
| `loadSeenSet: merges all three layers`        | Union of all three sources                   |
| `claimLesson: first claim succeeds`           | Returns `true`, file created in claim dir    |
| `claimLesson: second claim same slug → false` | O_EXCL prevents double-claim                 |
| `claimLesson: different slug same session`    | Returns `true` (different file)              |
| `persistSeenState: writes slugs to file`      | File contents match `[...seenSet].join(',')` |
| `persistSeenState: returns slug string`       | Return value matches file contents           |
| `loadSeenSet uses unique path per sessionId`  | Two sessions don't share state               |

### `scripts/scanner/structured.mjs` — `parseLessonTags` + `scanLineForLessons`

**Coverage target: 95%**

| Test                                               | What it verifies                                         |
| -------------------------------------------------- | -------------------------------------------------------- |
| `parseLessonTags: basic tag`                       | Returns candidate with tool, trigger, mistake, fix, tags |
| `parseLessonTags: multiple tags in one block`      | Both candidates returned                                 |
| `parseLessonTags: inside code fence`               | Code fence delimiters stripped, block parsed correctly   |
| `parseLessonTags: missing mistake → skipped`       | Incomplete block not returned                            |
| `parseLessonTags: missing fix → skipped`           | Incomplete block not returned                            |
| `parseLessonTags: tags parsed as array`            | Comma-separated tags become string[]                     |
| `parseLessonTags: no tags field → empty array`     | Defaults to `[]`                                         |
| `parseLessonTags: non-string input → empty`        | null, undefined, number return `[]`                      |
| `scanLineForLessons: non-assistant line → empty`   | User message line returns `[]`                           |
| `scanLineForLessons: no #lesson marker → empty`    | Fast-path rejection                                      |
| `scanLineForLessons: malformed JSON → empty`       | No throw                                                 |
| `scanLineForLessons: assistant with text block`    | Delegates to parseLessonTags                             |
| `scanLineForLessons: attaches sessionId/messageId` | Context attached from JSONL envelope                     |

### `scripts/scanner/extractor.mjs` — `extractFromStructured`, `extractFromHeuristic`, scoring

**Coverage target: 90%**

| Test                                                              | What it verifies                              |
| ----------------------------------------------------------------- | --------------------------------------------- |
| `extractFromStructured: full tag`                                 | All fields normalized, contentHash computed   |
| `extractFromStructured: confidence high with tool+trigger+tags`   | ≥ 0.75                                        |
| `extractFromStructured: confidence lower without optional fields` | 0.6 baseline                                  |
| `extractFromHeuristic: basic window`                              | mistake, remediation, tool, trigger extracted |
| `extractFromHeuristic: needsReview always true`                   | Heuristic candidates always flagged           |
| `extractFromHeuristic: tool from errorTurn`                       | tool pulled from error turn toolName          |
| `extractFromHeuristic: trigger from preceding tool_call`          | command/file_path extracted                   |
| `scoreCandidateConfidence: user correction bonus`                 | +0.15 for userCorrection signal               |
| `scoreCandidateConfidence: multiple error signals bonus`          | +0.1 for ≥2 error signals                     |
| `scoreCandidatePriority: severity tags boost priority`            | hang/data-loss adds +1 each                   |
| `inferTags: python tool detected`                                 | lang:python added from trigger                |
| `contentHash deterministic`                                       | Same inputs → same hash                       |
| `contentHash differs for different content`                       | Different mistake → different hash            |

---

## Integration Tests

Integration tests invoke real code against real files (fixtures, temp dirs). They test pipeline stages wired together.

### Hook pipeline: stdin → stdout

Tests pipe JSON to `pretooluse-lesson-inject.mjs` as a subprocess and assert on stdout.

Fixture: a minimal `lesson-manifest.json` with 2 lessons — one matching, one blocking.

| Test                                                 | What it verifies                                            |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `matching command → injects lesson`                  | stdout contains `hookSpecificOutput.additionalContext`      |
| `non-matching command → {}`                          | stdout is exactly `{}`                                      |
| `blocking lesson → deny decision`                    | stdout contains `permissionDecision: "deny"`                |
| `already-seen slug (env var set) → {}`               | With `LESSONS_SEEN=<slug>` in env, returns `{}`             |
| `malformed stdin → {}`                               | Bad JSON on stdin returns `{}`, exit 0                      |
| `missing manifest → {}`                              | Pointing hook at non-existent manifest returns `{}`, exit 0 |
| `Read tool with matching path`                       | filePath match triggers injection                           |
| `multi-lesson match respects maxLessons`             | Only top N returned                                         |
| `additionalContext contains lessonInjection comment` | Metadata comment present                                    |
| `env.LESSONS_SEEN set in output`                     | `env.LESSONS_SEEN` contains injected slug                   |

### CLI: `lessons add` + `lessons build`

Tests use a temp copy of `lessons.json` to avoid polluting the real store.

| Test                                         | What it verifies                                 |
| -------------------------------------------- | ------------------------------------------------ |
| `add via --json`                             | Lesson appears in store after add                |
| `add triggers manifest rebuild`              | `lesson-manifest.json` updated after add         |
| `add: duplicate content hash rejected`       | Exit non-zero, lesson not duplicated             |
| `add: fuzzy duplicate rejected`              | Jaccard ≥ 0.5 exits non-zero                     |
| `add: validation failure rejects`            | Short mistake exits non-zero with message        |
| `build: excluded lessons not in manifest`    | `needsReview: true` lesson absent from manifest  |
| `build: included lessons have correct shape` | commandRegexSources, slug, injection all present |
| `list: outputs all lessons`                  | Count matches lessons.json                       |
| `list --json: valid JSON array`              | JSON.parse succeeds                              |

### Scanner: incremental scan against fixture JSONL

Fixture: two JSONL files — one with a `#lesson` tag, one without.

| Test                                                  | What it verifies                         |
| ----------------------------------------------------- | ---------------------------------------- |
| `scan --tier1-only --dry-run`                         | Candidate extracted from tagged file     |
| `scan incremental: second scan skips processed bytes` | Offset advanced, no duplicate candidates |
| `scan --full resets offsets`                          | Both files re-scanned                    |
| `scan on empty directory`                             | Exits 0, no candidates                   |

---

## E2E / Cross-Agent Tests

These tests validate that the hook protocol is correctly interpreted by each agent runtime. They confirm the JSON schema contract, not the business logic.

Each test pipes a well-formed hook payload through the injection hook and asserts on the output schema.

### Claude Code (baseline)

The production protocol. All integration tests implicitly validate this.

| Field                        | Expected                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Input `tool_name`            | `"Bash"`, `"Read"`, `"Edit"`, `"Write"`, `"Glob"`                                                                      |
| Input `tool_input.command`   | Bash command string                                                                                                    |
| Input `tool_input.file_path` | Absolute path for file tools                                                                                           |
| Input `session_id`           | UUID string                                                                                                            |
| Output (inject)              | `{ hookSpecificOutput: { additionalContext: "..." }, env: { LESSONS_SEEN: "..." } }`                                   |
| Output (block)               | `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "..." } }` |
| Output (no match)            | `{}`                                                                                                                   |

| Test             | What it verifies                               |
| ---------------- | ---------------------------------------------- |
| `Bash inject`    | Full round-trip, output schema valid           |
| `Read inject`    | File path match, output schema valid           |
| `block decision` | Deny schema, reason contains corrected command |
| `no match`       | Exact `{}` output                              |

### Codex

Codex uses different tool names for equivalent operations.

| Codex tool    | Mapped to |
| ------------- | --------- |
| `shell`       | Bash      |
| `apply_patch` | Edit      |
| `read_file`   | Read      |

The adapter layer (or a normalization step) must map Codex tool names to the canonical set before matching. Tests verify the mapping works correctly.

| Test                               | What it verifies                                       |
| ---------------------------------- | ------------------------------------------------------ |
| `shell tool → Bash matching`       | `tool_name: "shell"` triggers command pattern match    |
| `read_file tool → Read matching`   | `tool_name: "read_file"` triggers path pattern match   |
| `apply_patch tool → Edit matching` | `tool_name: "apply_patch"` triggers path pattern match |
| `unknown Codex tool → {}`          | Unsupported tool returns `{}`, no error                |

**Current status:** Not yet implemented. Requires tool-name normalization in `stdin.mjs` or a Codex-specific adapter.

### Gemini CLI

Gemini CLI uses its own hook protocol. Tool names may differ from Claude Code.

| Gemini tool         | Mapped to |
| ------------------- | --------- |
| `run_shell_command` | Bash      |
| `read_file`         | Read      |
| `write_file`        | Write     |
| `replace_in_file`   | Edit      |

| Test                                | What it verifies       |
| ----------------------------------- | ---------------------- |
| `run_shell_command → Bash matching` | Command pattern fires  |
| `read_file → Read matching`         | Path pattern fires     |
| `write_file → Write matching`       | Path pattern fires     |
| `replace_in_file → Edit matching`   | Path pattern fires     |
| `unknown Gemini tool → {}`          | Returns `{}`, no error |

**Current status:** Not yet implemented. Requires a Gemini-specific stdin parser or adapter config.

### Protocol schema validation

Cross-agent tests also validate the output schema is well-formed regardless of which agent produced the input.

| Test                                         | What it verifies                      |
| -------------------------------------------- | ------------------------------------- |
| `inject output is valid JSON`                | JSON.parse succeeds                   |
| `inject output: only known keys present`     | No extra keys outside schema          |
| `block output: permissionDecision is "deny"` | Exact string, not "block" or "reject" |
| `block output: reason is non-empty string`   | No null or empty blockReason          |
| `empty output is exactly "{}"`               | Not `null`, not `""`, not `"{ }"`     |

---

## Coverage Map

| Module                               | Target | Unit | Integration          |
| ------------------------------------ | ------ | ---- | -------------------- |
| `core/match.mjs`                     | 100%   | ✓    | via hook pipeline    |
| `core/select.mjs`                    | 100%   | ✓    | via hook pipeline    |
| `hooks/lib/output.mjs`               | 100%   | ✓    | via hook pipeline    |
| `hooks/lib/stdin.mjs`                | 95%    | ✓    | via hook pipeline    |
| `hooks/lib/dedup.mjs`                | 85%    | ✓    | via hook pipeline    |
| `hooks/pretooluse-lesson-inject.mjs` | 90%    | —    | ✓                    |
| `scripts/scanner/structured.mjs`     | 95%    | ✓    | via scan integration |
| `scripts/scanner/extractor.mjs`      | 90%    | ✓    | via scan integration |
| `scripts/scanner/detector.mjs`       | 80%    | ✓    | —                    |
| `scripts/scanner/incremental.mjs`    | 85%    | —    | ✓                    |
| `scripts/lessons.mjs`                | 70%    | —    | ✓ (CLI subprocess)   |

**Explicit exclusions from coverage:**

- `hooks/session-start-*.mjs` — thin glue scripts, tested manually during deployment validation
- `data/*.json` — not code
- `schemas/` — not code

---

## Test File Structure

```
tests/
  unit/
    core/
      match.test.mjs
      select.test.mjs
    hooks/
      output.test.mjs
      stdin.test.mjs
      dedup.test.mjs
    scanner/
      structured.test.mjs
      extractor.test.mjs
      detector.test.mjs
  integration/
    hook-pipeline.test.mjs    # stdin→stdout subprocess tests
    cli-lessons.test.mjs      # lessons add/build/list subprocess tests
    scan-incremental.test.mjs # scanner against fixture JSONL
  e2e/
    claude-code.test.mjs      # CC protocol round-trips
    codex.test.mjs            # Codex tool name mapping
    gemini.test.mjs           # Gemini CLI tool name mapping
    schema.test.mjs           # Output schema validation across agents
  fixtures/
    minimal-manifest.json     # 2 lessons: 1 matching, 1 blocking
    session-with-lesson.jsonl # JSONL with embedded #lesson tag
    session-no-lesson.jsonl   # JSONL without any lesson tags
    lessons-store.json        # Minimal lessons.json for CLI tests
  helpers/
    subprocess.mjs            # spawn + collect stdout/stderr
    tmpstore.mjs              # creates an isolated temp lessons store
    fixtures.mjs              # loads fixture files by name
```
