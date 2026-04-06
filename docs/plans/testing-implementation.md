# Testing Implementation Plan

**Goal:** Bring the test suite to parity with `docs/architecture/testing-plan.md`.

**Current state:** Zero tests exist.
**Target:** ≥85% line coverage on `core/` and `hooks/lib/`, full integration + E2E suite.

---

## Phase 1 — Scaffolding

No tests yet. Establish the directory structure, test runner config, and shared helpers before writing any test cases.

### Step 1.1 — Directory structure

Create:

```
tests/
  unit/core/
  unit/hooks/
  unit/scanner/
  integration/
  e2e/
  fixtures/
  helpers/
```

### Step 1.2 — `package.json` scripts

Add test scripts:

```json
{
  "test": "node --test",
  "test:unit": "node --test tests/unit/**/*.test.mjs",
  "test:integration": "node --test tests/integration/**/*.test.mjs",
  "test:e2e": "node --test tests/e2e/**/*.test.mjs",
  "test:coverage": "node --test --experimental-test-coverage"
}
```

### Step 1.3 — Shared helpers

**`tests/helpers/subprocess.mjs`**

```js
// spawn(args, { stdin, env }) → { stdout, stderr, exitCode }
// Used by integration and E2E tests to invoke the hook or CLI
```

**`tests/helpers/tmpstore.mjs`**

```js
// createTmpStore() → { dir, lessonsPath, manifestPath, cleanup() }
// Copies fixture lessons-store.json to a temp dir for isolated CLI tests
```

**`tests/helpers/fixtures.mjs`**

```js
// loadFixture(name) → string | object
// Loads from tests/fixtures/ by filename
```

### Step 1.4 — Core fixtures

**`tests/fixtures/minimal-manifest.json`**
A compiled manifest with exactly 2 lessons:

- `lesson-pytest-match`: matches `\bpytest\b`, priority 8, injection text, no block
- `lesson-pytest-block`: matches `\bpytest\b(?!.*--no-header)`, priority 9, `block: true`

**`tests/fixtures/session-with-lesson.jsonl`**
A minimal 3-line JSONL: assistant message containing a complete `#lesson` tag block.

**`tests/fixtures/session-no-lesson.jsonl`**
A minimal JSONL with no lesson markers.

**`tests/fixtures/lessons-store.json`**
Minimal `lessons.json` with 2 seed lessons for CLI tests. Must pass intake validation.

---

## Phase 2 — Unit Tests

Implement all unit tests from the testing plan. Order follows dependency depth — pure functions first.

### Step 2.1 — `core/match.mjs`

File: `tests/unit/core/match.test.mjs`

13 test cases. All pure — no fixtures needed, test data inline.

Key cases requiring care:

- **Invalid regex**: lesson with `commandRegexSources: [{ source: "(" }]` must not throw
- **Priority sort**: create 3 lessons with priorities 3, 7, 1 → assert output order is [7, 3, 1]
- **`{command}` substitution in findBlocker**: 130-char command should be truncated to 120 in reason

### Step 2.2 — `core/select.mjs`

File: `tests/unit/core/select.mjs`

12 test cases. All pure. `claimFn` is passed as an inline spy — no real filesystem.

Key cases requiring care:

- **Budget fallback to summary**: create a lesson with 5000-byte injection, 100-byte summary, and a 200-byte budget after first lesson injected → assert summary injected
- **First lesson always injected**: even if its text exceeds `budgetBytes`, it must go in
- **claimFn=false → dropped**: slug appears in `dropped`, not `injected`

### Step 2.3 — `hooks/lib/output.mjs`

File: `tests/unit/hooks/output.test.mjs`

6 test cases. All pure, no fixtures.

### Step 2.4 — `hooks/lib/stdin.mjs`

File: `tests/unit/hooks/stdin.test.mjs`

`parseHookInput()` reads from fd 0. Tests mock stdin by writing to a pipe before importing the module, or by extracting the parse logic for direct unit testing.

**Preferred approach:** Extract the parsing logic into a testable `parsePayload(jsonString)` function and test that directly. `parseHookInput` becomes a thin wrapper. Update `stdin.mjs` to export `parsePayload` alongside `parseHookInput`.

8 test cases.

### Step 2.5 — `hooks/lib/dedup.mjs`

File: `tests/unit/hooks/dedup.test.mjs`

Uses real tmpdir — no mocking. Each test uses a unique `sessionId` (e.g., `test-dedup-${Date.now()}-${Math.random()}`) to ensure isolation.

10 test cases. Run `after()` cleanup to remove temp files.

### Step 2.6 — `scripts/scanner/structured.mjs`

File: `tests/unit/scanner/structured.test.mjs`

13 test cases. All pure except `scanLineForLessons` which parses strings — no I/O.

Key cases:

- **Code fence**: `\`\`\`\n#lesson\n...\n#/lesson\n\`\`\`` — fence stripped
- **Multiple tags**: two `#lesson` blocks in one text string → two candidates

### Step 2.7 — `scripts/scanner/extractor.mjs`

File: `tests/unit/scanner/extractor.test.mjs`

13 test cases. Pure except `createHash` call (no mock needed — determinism is the test).

Build a minimal `HeuristicWindow` fixture inline for `extractFromHeuristic` tests.

### Step 2.8 — `scripts/scanner/detector.mjs`

File: `tests/unit/scanner/detector.test.mjs`

Feed the detector synthetic JSONL strings via `feedLine()`. Assert on `flush()` output.

Key sequences to test:

- Tool call → error result → correction message → window emitted
- No error signals → no window emitted
- Window size limit (detector should cap at N turns without emitting junk)
- User correction signal boosts `signals.userCorrection`

---

## Phase 3 — Integration Tests

### Step 3.1 — Hook pipeline subprocess tests

File: `tests/integration/hook-pipeline.test.mjs`

Uses `tests/helpers/subprocess.mjs` to pipe JSON to `hooks/pretooluse-lesson-inject.mjs` and assert on stdout.

Set `MANIFEST_PATH` env var in the subprocess to point to `tests/fixtures/minimal-manifest.json` so tests don't depend on the real manifest.

**Required change to `pretooluse-lesson-inject.mjs`:** Make the manifest path overridable via `LESSONS_MANIFEST_PATH` env var (falling back to the hardcoded default). This is the only production code change Phase 3 requires.

10 test cases.

### Step 3.2 — CLI subprocess tests

File: `tests/integration/cli-lessons.test.mjs`

Uses `tests/helpers/tmpstore.mjs` to run `lessons add` / `lessons build` / `lessons list` against an isolated temp store. Set `LESSONS_DATA_DIR` env var or pass `--data-dir` flag.

**Required change to `scripts/lessons.mjs`:** Accept `LESSONS_DATA_DIR` env var to override `DATA_DIR`. This is the only production code change required.

9 test cases.

### Step 3.3 — Incremental scanner tests

File: `tests/integration/scan-incremental.test.mjs`

Copy fixture JSONL files to a temp dir, run `lessons scan --path <tmpdir>` as subprocess, assert on stdout / scan-state.json.

4 test cases.

---

## Phase 4 — E2E Cross-Agent Tests

### Step 4.1 — Claude Code protocol (baseline)

File: `tests/e2e/claude-code.test.mjs`

Full round-trips using real `minimal-manifest.json`. Validates CC-specific input/output schema.

4 test cases — already covered by integration tests, but re-run here as explicit schema assertions.

### Step 4.2 — Codex adapter

**Required new file: `hooks/lib/normalize-tool.mjs`**

```js
// Maps platform-specific tool names to canonical names
const CODEX_MAP = { shell: 'Bash', apply_patch: 'Edit', read_file: 'Read', write_file: 'Write' };
const GEMINI_MAP = { run_shell_command: 'Bash', read_file: 'Read', write_file: 'Write', replace_in_file: 'Edit' };

export function normalizeToolName(toolName, platform = 'cc') { ... }
```

**Update `hooks/lib/stdin.mjs`:** Before the `SUPPORTED_TOOLS` check, call `normalizeToolName()` using a `LESSONS_AGENT_PLATFORM` env var (defaults to `'cc'`).

File: `tests/e2e/codex.test.mjs`

5 test cases. Run subprocess with `LESSONS_AGENT_PLATFORM=codex`.

### Step 4.3 — Gemini CLI adapter

File: `tests/e2e/gemini.test.mjs`

5 test cases. Run subprocess with `LESSONS_AGENT_PLATFORM=gemini`.

### Step 4.4 — Output schema validation

File: `tests/e2e/schema.test.mjs`

5 test cases validating exact output shape across all agents. Uses the same subprocess helper with each platform variant.

---

## Phase 5 — Update Architecture Docs + README

### Step 5.1 — Update `CLAUDE.md`

Add test runner section:

```markdown
## Running Tests

node --test # all tests
node --test tests/unit/ # unit only
node --test --experimental-test-coverage # with coverage
```

### Step 5.2 — Update `docs/architecture/README.md`

Add `testing-plan.md` to the index table.

---

## Required Production Code Changes Summary

These are the only changes to production code this plan requires:

| File                                 | Change                                                  | Reason                                  |
| ------------------------------------ | ------------------------------------------------------- | --------------------------------------- |
| `hooks/pretooluse-lesson-inject.mjs` | Read manifest path from `LESSONS_MANIFEST_PATH` env var | Integration tests need fixture manifest |
| `scripts/lessons.mjs`                | Read data dir from `LESSONS_DATA_DIR` env var           | CLI tests need isolated store           |
| `hooks/lib/stdin.mjs`                | Export `parsePayload(str)` alongside `parseHookInput()` | Unit testability without fd 0 mocking   |
| `hooks/lib/stdin.mjs`                | Call `normalizeToolName()` before tool check            | Cross-agent support                     |
| `hooks/lib/normalize-tool.mjs`       | New file: tool name normalization map                   | Cross-agent adapter                     |

All other changes are test files and fixtures only.

---

## Execution Order

```
Phase 1 — Scaffolding         (no tests yet, sets up the harness)
Phase 2 — Unit tests          (pure functions, fastest to write and run)
Phase 3 — Integration tests   (requires Phase 1 production changes)
Phase 4 — E2E cross-agent     (requires Phase 4.2 production changes)
Phase 5 — Docs                (after coverage confirmed)
```

Do Phase 1 and Phase 2 together in one session. Phase 3 in the next. Phase 4 after cross-agent adapter work is agreed on.
