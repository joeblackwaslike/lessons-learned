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
