# Contributing

## Setup

```bash
git clone https://github.com/joeblackwaslike/lessons-learned.git
cd lessons-learned
npm ci
```

`npm ci` installs dependencies and registers Husky pre-commit hooks, which enforce lint and typecheck on every commit.

---

## Code quality gates

```bash
npm run lint          # ESLint (report only)
npm run lint:fix      # ESLint with auto-fix
npm run format        # Prettier (write)
npm run format:check  # Prettier (check only)
npm run typecheck     # tsc --checkJs --noEmit
```

All three gates run in CI on every push and PR. Pre-commit hooks run lint and typecheck locally before each commit.

---

## Running tests

```bash
npm test                  # all 188 tests
npm run test:unit         # pure function tests — fast, no I/O
npm run test:integration  # subprocess + real temp files
npm run test:e2e          # cross-agent protocol tests
npm run test:coverage     # with experimental coverage report
```

See [Testing](testing.md) for the full test architecture, coverage targets, and fixture documentation.

---

## Adding a lesson to the seed store

The seed store ships with ~30 hand-authored lessons covering common failure patterns. To add one:

### Option 1 — Interactive CLI

```bash
node scripts/lessons.mjs add
```

### Option 2 — Inline JSON

```bash
node scripts/lessons.mjs add --json '{
  "summary": "git stash silently drops untracked files without -u",
  "problem": "git stash only stashes tracked modified files — untracked files are silently left behind, risking data loss on branch switches",
  "solution": "Use git stash -u (--include-untracked) to include untracked files",
  "trigger": "git stash",
  "tags": ["tool:git", "severity:data-loss"],
  "priority": 9
}'
```

### Option 3 — Direct edit

Edit `data/lessons.json` directly, then rebuild:

```bash
node scripts/lessons.mjs build
```

### Validation rules

`lessons add` enforces these before writing. Direct edits should respect them too:

- `summary`, `problem`, `solution` each ≥ 20 characters
- No unfilled template placeholders (`<what_went_wrong>` etc.)
- `summary` must not end with `...`
- `trigger` must not be a prose gerund (e.g. "running pytest")
- Jaccard similarity of `problem` vs all existing lessons < 0.5 (no near-duplicates)

---

## Extending the scanner

The scanner lives in `scripts/scanner/`. To improve heuristic detection:

- `detector.mjs` — `HeuristicDetector` sliding-window logic
- `extractor.mjs` — `extractFromHeuristic()` — field normalization and scoring
- `structured.mjs` — `parseLessonTags()` — structured tag parsing

Unit tests for all three are in `tests/unit/scanner/`. Add tests before submitting changes to scanner logic.

---

## Adding a new agent platform

See [Adapters](adapters.md) for the full guide. The short version:

1. Add tool name mappings to `hooks/lib/normalize-tool.mjs`
2. Add a branch in `pretooluse-lesson-inject.mjs` for the new `LESSONS_AGENT_PLATFORM` value — or write a standalone adapter script
3. Add E2E tests in `tests/e2e/` for the new platform
4. Update [Installation](../installation.md) with the hook config for the new platform

---

## PR guidelines

- Keep PRs focused — one concern per PR
- New seed lessons should include a test case in `tests/integration/cli-lessons.test.mjs` or `tests/unit/scanner/`
- Run `npm test` and `npm run lint` before opening a PR — CI enforces both
- Follow conventional commits: `fix:`, `feat:`, `docs:`, `refactor:`, `test:`, `chore:`
- Don't add features or refactors beyond what the PR description says

---

## Commit style

Use imperative mood, present tense:

```
feat: add sessionStart trigger type for reasoning reminders
fix: prevent double-injection when parallel tool calls race
docs: document Gemini CLI adapter output format
test: add E2E tests for Codex tool name normalization
```
