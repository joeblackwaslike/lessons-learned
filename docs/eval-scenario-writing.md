# Eval Scenario Writing Guide

This document covers how to write effective eval scenarios. For running evals and reading results, see [eval-usage.md](eval-usage.md).

A scenario is effective when the prompt makes it **nearly impossible** to complete the task correctly without triggering the lesson behavior. If there is a natural alternative path that also solves the task, the scenario design is too loose.

---

## Seed Workspace Requirements

Every scenario that involves code or files must have a seed workspace in `seed-workspace/` that starts in a **broken or incomplete state**:

1. **The code must be incomplete or buggy** — not finished. If the agent sees a completed implementation, it summarizes prior work instead of solving anything (Pattern 1 SKIP).

2. **Include a test that fails in the starting state.** The test should specifically exercise the failure mode the lesson addresses. When the agent runs it, sees the failure, and knows there is real work to do.

3. **Verify the test actually fails** before committing the seed:

   ```bash
   cd evals/scenarios/TC-H-your-scenario/seed-workspace
   npm test   # or pytest, node --test, etc.
   # Must exit non-zero
   ```

4. **PASS = lesson applied AND test passes.** The failing test gives the judge and `verify.mjs` an objective signal beyond transcript scraping.

For scenarios that don't involve existing files (e.g., asking the agent to write a new script from scratch), an empty seed workspace with `.gitkeep` is fine — but make sure the prompt creates a situation where the lesson's failure mode would naturally occur.

---

## Prompt Design

### The core rule

The prompt must put the agent at the exact moment the lesson applies, with no easy escape route. Ask yourself: can the agent complete this task correctly without triggering the lesson behavior? If yes, the scenario is too loose.

### Timing matters

Place the agent at the right point in the workflow:

- **Tool-use lessons**: the agent should be about to call the tool, not deciding whether to use it
- **Planning lessons**: the agent should already have a rough approach and be about to present it — not still gathering requirements
- **Execution lessons**: start mid-execution ("here is the approved plan, execute it") rather than from the initial request

### Describe the task, not the symptom

Wrong: "My commits are hanging and I'm getting GPG errors" — agent debugs GPG.  
Right: "Configure VSCode's `git.enableCommitSigning` setting to disable commit signing."

Wrong: "The app is slow" — agent optimizes everything.  
Right: "The `processQueue` function in `src/worker.js` is taking >500ms per item on large batches. Profile and fix it."

### Don't contradict the lesson

If the lesson says "use Edit instead of Serena for constant replacements," the prompt must not say "use Serena for the edit." That creates an impossible conflict rather than a teachable moment.

---

## Lesson Form and Control Arms

### Form A (hint / guard)

Both control and treatment arms are required. The judge compares both transcripts and asks whether the lesson caused measurably better behavior.

### Form B (protocol / directive)

**Both arms are still required.** This is the TDD red-test problem: without a control arm, a PASS doesn't tell you whether the agent would have demonstrated the behavior anyway. The form distinction (A vs B) affects the judge prompt, not whether a control arm exists.

In `promptfooconfig.yaml`, every test block must have a corresponding control entry with `intervention: { type: none, ids: [] }`.

---

## SKIP Diagnosis

If a scenario returns SKIP, diagnose which pattern it matches:

### Pattern 1 — Seed workspace already complete

**Symptom:** Judge transcript shows agent summarizing or reviewing prior work instead of solving a problem.

**Fix:** Strip the seed workspace back to a broken starting state and add a failing test (see [Seed Workspace Requirements](#seed-workspace-requirements)).

### Pattern 2 — Tool calls not visible in transcript

**Symptom:** Judge cannot confirm whether the agent used specific flags or tools because the transcript only shows prose output, not raw tool calls.

**Fix:** Add a `PostToolUse` hook to the seed workspace's `.claude/settings.json` that appends every tool call to `.eval/tool-calls.jsonl`:

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

Update `hidden-checks/verify.mjs` to read `.eval/tool-calls.jsonl` rather than scraping transcript text.

### Pattern 3 — Prompt doesn't reach the trigger point

**Symptom:** Agent answers the question or completes a preliminary step (asks clarifying questions, identifies blockers) and stops before reaching the moment where the lesson would apply.

**Fix:** Rework the prompt to start the agent further into the workflow, past the point of setup. See [Prompt Design / Timing matters](#timing-matters).

---

## CONTROL_CORRECT → Pressure Testing → Retire

When a scenario consistently returns `CONTROL_CORRECT` (control arm already avoids the mistake without the lesson), the lesson may be unnecessary for current model versions.

**Process:**

1. Run the scenario 5× without lesson injection
2. If all 5 return `CONTROL_CORRECT`, the model no longer makes this mistake
3. Archive the lesson with a detailed reason:
   ```bash
   node scripts/lessons.mjs edit \
     --id <slug> \
     --patch '{"status": "archived", "archiveReason": "Model no longer makes this mistake as of claude-sonnet-4-6. Confirmed via 5x CONTROL_CORRECT pressure test (scenarios: ...). Keep for regression testing on future models."}'
   ```
4. Do not inject archived lessons at runtime — they add noise without benefit

Keep archived lessons in the database for historical data and regression testing when model versions change.

---

## Verify Script Patterns

The auto-generated `hidden-checks/verify.mjs` only checks for non-empty output. Replace it with a meaningful check before treating results as authoritative.

### File content check

```js
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const workspace = process.argv[2];
const file = join(workspace, 'src', 'config.js');

if (!existsSync(file)) process.exit(1);
const src = readFileSync(file, 'utf8');
if (src.includes('const const')) process.exit(1); // double-declaration bug
process.exit(0);
```

### Test exit code check

```js
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const workspace = process.argv[2];
const result = spawnSync('npm', ['test'], { cwd: workspace, encoding: 'utf8' });
process.exit(result.status === 0 ? 0 : 1);
```

### Tool call log check (Pattern 2 fix)

```js
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const workspace = process.argv[2];
const logFile = join(workspace, '.eval', 'tool-calls.jsonl');

if (!existsSync(logFile)) process.exit(1);
const lines = readFileSync(logFile, 'utf8')
  .trim()
  .split('\n')
  .map(l => JSON.parse(l));
const usedEdit = lines.some(e => e.tool === 'Edit' && e.input?.file_path?.includes('constants.js'));
process.exit(usedEdit ? 0 : 1);
```

---

## Known Platform Constraints

These are hard limitations of the `claude --print` eval runner that affect scenario design. Document them here before spending time on workarounds.

### AskUserQuestion cannot execute in `--print` mode (TC-D8)

`AskUserQuestion` is a Claude Code TUI tool that requires an active UI callback. When running via `claude --print --dangerously-skip-permissions`, no callback is registered and the tool fails silently. The agent either never attempts it or retries until giving up.

**Observable effect**: The treatment arm tries `AskUserQuestion` (proving the lesson fired) but falls back to prose, making it indistinguishable from control in the output. The judge returns FAIL or SKIP because behavior didn't change.

**Current workaround** (TC-D8): `verify.mjs` detects the tool _attempt_ in hook events or output text and returns PASS — confirming the lesson fires but not that it produces the right UX.

**Proper fix**: A separate provider that calls the Anthropic API directly with `AskUserQuestion` defined as a mock tool that auto-selects option 0. This lets the full agentic loop complete. Not yet implemented — tracked in ll-6tr (deferred).

**When designing scenarios for tools with UI callbacks**: either test at the attempt level (like TC-D8), or note in the scenario's README that it requires the Agent SDK provider when one is built.

### Session-start directives are not sufficient alone for activation lessons

A `directive` lesson injected at session start is a single injection point. In practice, agents "read" the directive but deprioritize it once they begin executing a task — especially under a prompt that naturally pulls toward reading files immediately (e.g., "debug this function", "explore this codebase").

**Evidence**: In a real session (2026-05-15), the `activate-serena-project-at-session-start` directive was injected and acknowledged, but Serena was not activated until a human intervened mid-session. The agent proceeded with `Bash`/`cat` reads for 20+ tool calls.

**Implication for lesson design**: Any activation lesson (`activate X before code work`) needs at minimum two injection points:

1. **Session-start directive** — plants the instruction early
2. **PreToolUse hint on Read/Glob/Bash** — fires at the moment of violation, when the agent is about to read code without having activated the tool

A directive alone passes the TC-D10 eval (the agent follows it when the prompt is soft), but fails in adversarial real-world use where task urgency overrides session-start instructions.

**Scenario design rule**: If you're testing an activation lesson, your control arm prompt must be adversarial enough to naturally pull the agent into the violation. "Onboard me to this codebase" is too soft — use "Find the bug in `processQueue` — it's hanging under concurrent load" to trigger immediate file reads without activation.

**Community validation (2026-05-15)**: Serena maintainers independently documented the same regression in their Claude Code client docs: "Recent updates to Claude Code and the Opus line of models resulted in drastically reduced adherence to instructions pertaining to Serena's tools. The descriptions of CC's system tools take almost 16k tokens and introduce a very strong bias towards internal tools, making it almost impossible to convince Opus 4.7 to use Serena." Root cause is competing training priors, not lesson wording. Their solution: infrastructure-level hooks (`serena-hooks`) and a system prompt override, not more lesson text.

### `mcpServers` in project `settings.json` are not loaded in `--print` mode

Claude Code ignores `mcpServers` declared in the workspace `.claude/settings.json` when running non-interactively via `claude --print`. MCP servers simply never start — no child process, no tools available.

**Fix**: Write a standalone MCP config file (e.g. `.eval/mcp-config.json`) and pass `--mcp-config <path>` explicitly on the claude command line. The flag works regardless of `--setting-sources`.

**Note on SessionStart**: `SessionStart` hooks **do** fire in `--print` mode as long as CC is invoked with `cwd` set to the workspace directory (so it can find `.claude/settings.json`). The eval provider already does this. If a SessionStart hook appears not to fire, debug the hook command itself — not the invocation mode.

---

### Guard lessons can be bypassed via Agent subagents

When a PreToolUse guard blocks `Bash` or `Read`, the agent finds equivalent paths that don't trigger the guard:

- **Agent subagents**: spawning an Explore or general-purpose subagent to read files — subagents run with their own tool call context and the parent's PreToolUse hooks do not apply.
- **Equivalent commands**: `python3 -c "print(open('f').read())"`, `python3 -m json.tool`, `awk`, `less`, `head` — any command that isn't explicitly pattern-matched.

**Root cause**: Guards are pattern-matched against specific tool names and command strings. The agent isn't "defying" the guard — it's pattern-matching toward the nearest unblocked path that accomplishes the goal. Guards that block `grep` don't block `python3 -c "import re; ..."`.

**Implication for lesson design**: Guards work reliably only for commands with no common equivalent (e.g., a specific destructive CLI flag). For broad behavioral goals like "use Serena instead of grep," guards cannot provide exhaustive coverage and the correct solution is infrastructure-level enforcement (hooks that count consecutive violations and nudge, not block).

**Observable in eval**: If you see a treatment arm passing the guard assertion but producing no Serena tool calls, check hook-events.ndjson for Agent subagent spawns — the agent may be outsourcing the file reads to a child process.

---

## Harness Gotchas

Implementation-level traps in the eval harness itself. These are not scenario design issues — they affect all scenarios equally.

### `before-each.mjs` returning a partial test object strips the `assert` field

The promptfoo `beforeEach` extension hook receives `context.test` and can return a modified version. If you return `{ test: { vars: resolvedVars } }` — a partial object — promptfoo replaces `test` wholesale, discarding `assert`, `description`, and any other fields that weren't included. The result is "No assertions" for every affected arm, which scores as a trivial pass.

**Always spread `context.test` when returning from `beforeEach`:**

```js
// Wrong — strips assert:
return { test: { vars: resolvedVars } };

// Correct — preserves all fields:
return { test: { ...context.test, vars: resolvedVars } };
```

This applies to both the control-arm file-ref resolution path and the treatment-arm lesson injection path.

### `--no-cache` does not clear the provider cache

`npx promptfoo eval --no-cache` bypasses promptfoo's SQLite result database (`~/.promptfoo/promptfoo.db`) but does **not** touch the custom provider cache in `evals/results/cache/*.json`. If a stale arm result is cached there, the provider returns it directly and the agent never re-runs.

**When you need a true cold re-run** (e.g. after fixing a bug in the harness or changing an intervention type):

```bash
# Delete a specific arm's cache file
rm evals/results/cache/<hash>.json

# Or wipe everything
npm run eval:clean
```

The cache key includes `interventionJson`, so renaming an intervention type (e.g. `hooks` → `claudemd`) automatically invalidates old cached entries for that arm.
