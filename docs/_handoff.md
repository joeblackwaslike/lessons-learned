# Eval Harness Handoff — 2026-05-15/16

## Current State

Repo is clean. All Serena lessons archived. TC-D10 eval passes. Docs corrected.

---

## TC-D10 Serena Activation — Resolved

**Goal:** Test whether an eval agent uses Serena tools for code work after activation.

**Three fixes that made TC-D10 pass:**

1. **`before-each.mjs` was stripping the `assert` field.** The promptfoo extension hook returned `{ test: { vars: resolvedVars } }` — a partial object — which caused promptfoo to replace `test` wholesale, dropping `assert`. Every affected arm showed "No assertions" and trivially passed. Fix: always spread `context.test` when returning from `beforeEach`:

   ```js
   return { test: { ...context.test, vars: resolvedVars } };
   ```

2. **`mcpServers` in project `settings.json` are not loaded in `--print` mode.** Serena MCP never started. Fix: write `.eval/mcp-config.json` in `materialize-workspace.mjs` and pass `--mcp-config <path>` explicitly to the claude command for non-control arms.

3. **SessionStart hooks don't inject in time for `claudemd` intervention.** For the `claudemd` intervention type, the Serena usage directive is written directly into the workspace `CLAUDE.md` (always loaded by CC). The agent follows it and calls `activate_project` before doing code work.

**Result:** TC-D10 treatment arm passes in ~10 minutes. Agent calls `activate_project`, then uses `get_symbols_overview` / `read_file` / `replace_symbol_body` — no native Read/Bash-grep.

---

## Key Discoveries

### SessionStart DOES fire in `--print` mode

Verified by test. `claude --print` with `cwd` set to the workspace directory fires `SessionStart` hooks from the workspace `.claude/settings.json`. The prior claim that it didn't fire was wrong — the issue in TC-D10 was the `serena-hooks activate` command itself failing silently, not the invocation mode.

**Implication:** Directive and protocol lessons CAN be tested with SessionStart hooks in eval. The `claudemd` intervention tests something different (CLAUDE.md = system-prompt-level, always present). These are not interchangeable.

### `--no-cache` does not clear the provider cache

`npx promptfoo eval --no-cache` bypasses promptfoo's SQLite DB only. The provider cache in `evals/results/cache/*.json` is separate and must be deleted manually for a true cold re-run.

### Intervention type renamed: `hooks` → `claudemd`

The TC-D10 treatment arm used `type: hooks` which was misleading — the working mechanism was CLAUDE.md injection, not serena-hooks. Renamed to `type: claudemd` throughout promptfooconfig.yaml and materialize-workspace.mjs.

---

## Serena Lessons — All Archived

All 8 Serena-related lessons are now archived. Root cause: CC's 16k-token native tool system prompt creates a training prior that overwhelms lesson-level injection. Confirmed via TC-D10 evals and independently documented by Serena maintainers. Lesson-level intervention cannot reliably drive Serena tool adoption.

Archived lessons:

- `activate-serena-project-at-session-start-9070`
- `read-on-code-file-before-serena-activati-09b9`
- `bash-catgrep-on-code-files-before-serena-a7de`
- `bash-cat-on-source-file-before-serena-us-c878`
- `bash-grep-on-source-files-before-serena-78ab`
- `bash-find-on-source-files-before-serena-5a2e`
- `serenas-replacesymbolbody-on-a-js-consta-9fb4`
- `use-serena-getsymbolsoverview-or-findsym-2255`

---

## Repo Contamination — Found and Fixed

**Root cause:** `materialize-workspace.mjs` was accidentally run with the repo root as its `workspaceDir` during TC-D10 debugging (likely `--workspace .` or equivalent). That script writes three things into the workspace dir — all three landed in the repo root:

| What happened                                                                | Fix                                                |
| ---------------------------------------------------------------------------- | -------------------------------------------------- |
| `CLAUDE.md` overwritten with 4-line workspace directive                      | Restored via `git restore CLAUDE.md`               |
| `.eval/` created at repo root (hook-events + tool-calls logs)                | Added `.eval/` to root `.gitignore`                |
| `.claude/settings.json` injected with eval-hook-shim and eval-post-hook-shim | Removed shims; restored to lesson-inject hook only |

**To prevent recurrence:** The root `.gitignore` now includes `.eval/`. The eval shims write to `<cwd>/.eval/` — if `cwd` is ever the repo root, the output is gitignored.

---

## Docs Updated

`docs/eval-scenario-writing.md` changes this session:

- **Corrected** false claim that SessionStart doesn't fire in `--print` mode
- **Added** `mcpServers` not loaded in `--print` mode constraint (still true — use `--mcp-config`)
- **Added** "Harness Gotchas" section: `before-each.mjs` partial return strips `assert`; `--no-cache` doesn't clear provider cache

---

## Eval Harness Handoff — 2026-05-12

### State as of 2026-05-12

Batch 2–5 eval expansion: 85 scenarios total (up from 9 original).

**Coverage as of this session:**

- 57 scenarios judged (67%)
- 28 still unrun: TC-H42–H60, TC-G7, TC-H19, TC-P7–P10
- Active run in progress (second half, background task)

**Infrastructure fixed this session:**

- Judge rewired from `claude --print --json-schema` (hung via meridian) to direct Anthropic SDK call
- `repair-judge-errors.mjs` script created for re-running judge on error-cached results
- Root cause of all judge failures in background runs: `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` not inherited by background shell. Always prefix eval runs with:
  ```bash
  ANTHROPIC_API_KEY=meridian ANTHROPIC_BASE_URL=http://127.0.0.1:3456 npx promptfoo eval ...
  ```

---

## Results Summary (57 judged)

| Outcome         | Count | %   |
| --------------- | ----- | --- |
| PASS            | 21    | 37% |
| SKIP            | 14    | 25% |
| CONTROL_CORRECT | 13    | 23% |
| FAIL            | 9     | 16% |

**Pass rate among decisive outcomes (PASS + FAIL): 70%**

Full detailed report: `evals/results/reports/report-analysis-2026-05-12.md`

---

## Decisions Made This Session

### Form B needs control arms (confirmed gap)

Form B scenarios (protocol/directive lessons) currently only run the treatment arm and ask "did the agent demonstrate the behavior?" This is the TDD red test problem — without a control arm, a PASS doesn't tell you whether the agent would have made the mistake anyway.

**Decision:** Add control arms to all Form B scenarios before drawing conclusions from Form B PASSes. The form distinction (A/B) can eventually go away — all scenarios run both arms, judge uses all available transcripts.

Current Form B PASSes that may be vacuous: D1, D3, D5, H2, P2, P3, P4, P5, P6.

### TC-D8 — AskUserQuestion is available in Claude Code but not in `--print` mode

Researched and confirmed. `AskUserQuestion` exists in all Claude Code contexts but requires a `canUseTool` callback to surface the UI to the user. `claude --print` provides no such callback, so the agent correctly falls back to prose.

**Decision — option B:** Rewrite the lesson to teach the fallback behavior — "when AskUserQuestion is unavailable, present a numbered list, never bury choices in prose." This makes the lesson testable headless and more broadly useful (agentic contexts often run headless).

**Longer-term option A:** Replace `claude --print` with Agent SDK call that mocks `canUseTool`, returning the first/recommended option automatically. This tests whether the agent _uses the tool at all_. Track as eval infrastructure improvement.

### CONTROL_CORRECT pressure testing → retired bucket

If a scenario returns CONTROL_CORRECT consistently (5 runs without the lesson, all pass), the lesson may be unnecessary for current model versions.

**Decision:** Add `status: retired` to the lesson schema. Run CC scenarios 5× without the lesson — if all 5 pass, move lesson to `retired`. Keep for historical data and regression testing on future models. Don't inject retired lessons at runtime.

### Seed workspaces must include a failing test

Pattern 1 SKIPs (6–7 scenarios) happen because the seed workspace already contains completed code — the agent sees nothing to do and summarizes prior work.

**Decision:** Every seed workspace must:

1. Be in a broken/incomplete starting state (not finished)
2. Include a test that **fails in the starting state** — the agent runs it, sees the failure, knows there's real work to do
3. For code-fixing lessons, the test should specifically exercise the failure mode the lesson addresses

This also gives the judge (and `verify.mjs`) an objective signal: PASS = lesson applied AND test passes.

### Pattern 2 — verification via PostToolUse hook (not transcript scraping)

Currently some scenarios SKIP because the agent's actual tool calls aren't visible in the transcript output (e.g., can't confirm pytest flags were used, can't confirm which tools a subagent picked).

**Decision:** Add a `PostToolUse` hook to scenario-level `.claude/settings.json` that appends every tool call + input to `.eval/tool-calls.jsonl`. The judge and `verify.mjs` read this log instead of scraping transcript text. This gives complete, structured observability.

Hook config pattern:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "jq -c '{tool: .tool_name, input: .tool_input}' >> .eval/tool-calls.jsonl"
          }
        ]
      }
    ]
  }
}
```

### CLAUDE_CONFIG_DIR for harness isolation

When running `claude --print` for evals, set `CLAUDE_CONFIG_DIR` to a temp dir to prevent the eval agent from inheriting the user's global settings/lessons:

```bash
EVAL_DIR=$(mktemp -d)
cp path/to/eval-settings.json "$EVAL_DIR/settings.json"
CLAUDE_CONFIG_DIR="$EVAL_DIR" claude --print ...
```

Caveat: workspace-local `.claude/` directories are still written alongside the project. Manage `.claude/settings.json` in the seed workspace separately if you need to control project-level hooks.

---

## Scenario Fixes Needed

### TC-D4 — search-for-community-solutions

**Problem:** Lesson says "search for known pitfalls before committing to a plan" — agent correctly asked clarifying questions first, but never searched. User confirmed: the search should happen _after forming a plan but before presenting it to the user_. You can't validate footguns without a plan to validate.

**Fix needed:**

1. Patch lesson solution to specify timing: "after you have a plan, before you present it, search for known issues with your approach"
2. Rewrite scenario prompt to put the agent at planning stage — they already have a rough approach and are about to present it

### TC-D6 — planning-from-training-data-knowledge

**Problem:** Agent may have used training-data knowledge without fetching docs. Hard to verify — if the task uses a common/stable API the agent knows well, it won't need to search.

**Fix:** Use a bleeding-edge or recently-changed API where training data would produce wrong code. Good candidates:

- `next/form` (added Next.js 15)
- `use cache` directive (Next.js 15 experimental)
- `useOptimistic` (changed signature)
- Something from the beads repo or lessons-learned itself (completely post-training)

Prompt pattern: "Let's add X feature to this project" where X requires a specific recent API.

### TC-D8 — multiple-choice-questions-buried-in-prose

See "Decisions" above. Rewrite lesson to teach CLI-friendly fallback: numbered list, not prose.

### TC-D9 — asking-should-i-proceed-on-routine-reversible

Seed workspace has no files — agent correctly identified a blocker but couldn't demonstrate lesson behavior.

**Fix:** Create seed workspace with actual source files and commit them to a local git repo. Task should require a straightforward reversible change (e.g., rename all snake_case functions to camelCase in `src/utils.js`). Agent needs to see committed history to know the action is reversible.

### Pattern 1 SKIPs — seed workspace audit (D7, H6, H9, H10, H11, H12, H16)

All show "task already complete from prior session." Same root cause: seed workspace has finished code.

**Fix for each:**

1. Strip seed workspace back to broken/incomplete starting state
2. Add a failing test (see "Decisions" above)
3. Verify the test fails with `npm test` / `pytest` / etc. before committing the seed

### Pattern 3 — scenario doesn't reach the trigger point (H5, H18, H23)

**TC-H5 (VSCode signing):** Prompt describes a symptom (commits hanging/GPG errors), not the task. Agent debugged GPG instead of touching VSCode settings.

- Fix: Change prompt to "configure VSCode's git.enableCommitSigning setting"

**TC-H18 (batch rollback):** Agents asked clarifying questions and stopped before execution phase.

- Fix: Rework prompt to start mid-execution — "here's the approved plan, execute it" — so the rollback lesson triggers naturally

**TC-H23 (decorator registry):** Empty workspace, nothing to fix.

- Fix: Create seed workspace with an actual registry module that has the missing import

**Eval prompt best practices note:** The prompt should make it nearly impossible to complete the task correctly without triggering the lesson behavior. If there's a natural alternative path that also solves the task, the scenario design is too loose. Whether to create a formal best-practices doc for this: yes, worth drafting.

---

## Notable Results Worth Investigating

### FAILs with negative delta (lesson may be harmful)

**TC-H41 (serena replace-symbol-body): FAIL, delta=-2.6**
Treatment scored worse than control. Lesson injected but agent performed worse. The lesson text may be confusing rather than helpful. Read the reasoning and consider patching or retiring.

**TC-H38 (nodejs deprecation warnings): SKIP, delta=-3.6**
Judge couldn't call FAIL but treatment scores dropped hard. Big regression even though the judge didn't see clear evidence. Needs manual transcript review.

### PASS with negative delta

**TC-H30 (file reads stale): PASS, delta=-0.2**
Lesson was applied but treatment scored slightly lower on other dimensions. Minor — acceptable.

**TC-H7 (scripts hang stdin): PASS, delta=-0.6**
Both arms solved the problem via equivalent approaches. Treatment was more terse and left a concern unflagged. Not a real signal issue — just scenario design where both arms converge.

### CONTROL_CORRECT candidates for pressure testing (run 5× without lesson)

G2, G3, G4, H3, H4, H8, H13, H20, H22, H28, H33, H34, H39

---

## Promptfoo Viewer & Navigation

The promptfoo web viewer runs at `http://localhost:15500`. Start it with:

```bash
cd evals && npx promptfoo view --yes
```

Cache files in `evals/results/cache/` use content-hash filenames — not human-readable. Use the viewer to navigate. In the viewer: left sidebar → eval run ID → click any row for the detail pane (the tiny-box problem).

**Custom viewer — planned improvement:** The built-in viewer is not extensible. A custom viewer reading from cache files would provide:

- Full-width detail view per scenario
- Rendered transcript (Markdown)
- Lesson snapshot pretty-printed (currently minified JSON in metadata)
- Judge reasoning formatted
- Links to validate trajectory
- GitHub-style artifact viewer for files written during the eval

Track this as a feature. Given analysis time spent, ROI is high.

---

## Infrastructure Notes

### Running evals

Always confirm no eval is running first:

```bash
ps aux | grep promptfoo | grep -v grep
```

Run with correct env (meridian proxy):

```bash
ANTHROPIC_API_KEY=meridian ANTHROPIC_BASE_URL=http://127.0.0.1:3456 \
  npx promptfoo eval --config promptfooconfig.yaml \
  --filter-pattern "TC-..." 2>&1 | tee results/<run-name>.log
```

Filter pattern for unrun scenarios only — build from the missing list using `TC-(G[2-7]-|H17-|...)` patterns.

### Repairing judge errors

If a run completes but judge calls failed (auth error, timeout), use the repair script:

```bash
ANTHROPIC_API_KEY=meridian ANTHROPIC_BASE_URL=http://127.0.0.1:3456 \
  node evals/scripts/repair-judge-errors.mjs
```

The script finds all treatment arm caches with `judgeResult.error: true`, re-runs the judge, and patches the file in place. Agent transcripts are preserved.

---

## Hooks & Settings Reference (from prior research)

Hooks work identically in `-p` mode and interactive mode. Configure in `.claude/settings.json` (project) or `~/.claude/settings.json` (user).

All events fire in `-p` mode: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `StopFailure`, `PreToolUse`, `PostToolUse`. The `Setup` event is `-p`-specific (fires with `--init` or `--maintenance` flags).

Exit code semantics: `0` = allow/continue, `2` = block tool call (PreToolUse) or force continue (Stop), any other non-zero = error.

Hook input arrives on stdin as JSON. Read it with `$(cat)` and parse with `jq`.

Full reference: https://code.claude.com/docs/en/hooks
