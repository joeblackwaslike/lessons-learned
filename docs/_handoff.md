` fix from last session "Symlinking all 10 command files to ~/.claude/commands/lessons/
Updating them to use absolute paths so they work from any project directory" This is the wrong fix to make the commands work. We should be able to install the Claude Code plugin locally, and then the commands work, obviously

---

## Session Handoff — lessons-learned — 2026-04-26 (afternoon)

### What was accomplished this session

1. **ll-zd2 closed** — E2E tests + config (resumed from session f50e54c8)
   - `tests/e2e/schema.test.mjs`: restored `knownKeys` to `{hookSpecificOutput, env}` (suppressOutput removed from hook output)
   - `scripts/lessons.mjs` (`cmdReview`): replaced flat cluster loop with tag-grouped render — `── <tag> (N) ───` headers, sorted alpha with `(untagged)` last
   - `tests/integration/cli-lessons.test.mjs`: gave grouping-test candidates distinct problem text to prevent accidental Jaccard cross-tag clustering
   - 269/269 tests passing

2. **Root cause diagnosed: lesson injection was invisible + commands never installed**
   - Hook was firing correctly (18 lessons injected in this session per dedup file)
   - `suppressOutput: true` in `hooks/lib/output.mjs` was suppressing the entire CC UI visual — user never saw lessons fire
   - `commands/` dir was in the git repo but never linked to `~/.claude/commands/` so `/lessons:*` commands didn't exist
3. **Fixes shipped** (`fix(hooks): remove suppressOutput...`)
   - `hooks/lib/output.mjs`: removed `suppressOutput: true` — lesson `<details>` banner now appears in CC UI
   - `commands/*.md`: replaced all `node scripts/lessons.mjs` with absolute path
   - `~/.claude/commands/lessons/` created with symlinks to all 10 command files
   - Updated lesson `suppressoutput-true-in-hook-json-hides-t-c48e` to correct the wrong advice it was giving
   - All pushed to remote

---

### What to verify first next session

1. **Confirm lessons are now visible**: start a new session, run any `git` or `grep` command — you should see a collapsible `[lessons-learned] N lessons matched for \`...\`` banner appear before the tool executes

2. **Confirm commands work**: in any project, try `/lessons:help` or `/lessons:review` — these should now be discoverable slash commands

3. **If lessons banner is too noisy**: the threshold is controlled by `commandPatterns` regex specificity — most current lessons are broad (match any `git`, any `grep`). Consider tightening patterns or raising `minConfidence` in `data/config.json`

---

### Pending work — 14 open issues (0 in progress)

**Start here next session (high value, quick):**

| Issue    | Title                                                                | Why first                        |
| -------- | -------------------------------------------------------------------- | -------------------------------- |
| `ll-bv2` | Evaluate protocol vs directive merge; add per-type intro paragraphs  | Quick, high UX value             |
| `ll-nwe` | Intake validation at `lessons add` / `scan promote` / `lessons edit` | Prevents anti-patterns at source |
| `ll-n8p` | Document manual lesson entry by type with concrete examples          | Quick docs win                   |

**Design-first (need brainstorm):**

- `ll-3mw` — new `knowledge` lesson type for overriding Claude's built-in assumptions
- `ll-5ny` — topic/content-aware and project-keyword injection archetypes
- `ll-37x` — MCP server brainstorm → implementation plan

**Backlog:**

- `ll-pst` — 5 new doctor/preflight anti-pattern checks (depends on ll-nwe)
- `ll-y0d` — weekly doctor cron via CronCreate

---

### First commands to run next session

```bash
bd ready                     # confirm no blockers
bd show ll-bv2               # review next issue
node --test 'tests/**/*.test.mjs' 2>&1 | tail -5  # baseline: should be 269/269
```
