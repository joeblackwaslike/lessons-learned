# Eval Results Analysis — 2026-05-12

**Coverage:** 36 judged scenarios (of 85 Batch 2–5 total) · 49 still pending  
**Judge:** claude-sonnet-4-6 via Anthropic SDK (direct, post meridian-fix)

---

## Summary

| Outcome         | Count | %   |
| --------------- | ----- | --- |
| PASS            | 13    | 36% |
| SKIP            | 13    | 36% |
| CONTROL_CORRECT | 6     | 17% |
| FAIL            | 4     | 11% |

Effective signal rate (PASS or FAIL, not SKIP/CC): **17 / 36 = 47%**

---

## PASS (13)

### Strong signal — Form A with real delta

| Scenario                   | Delta     | Lesson                                 |
| -------------------------- | --------- | -------------------------------------- |
| TC-H15 agents-expand-scope | **+3.00** | agents-expand-scope-during-execution   |
| TC-H25 github-pkcs1-keys   | **+2.00** | github-app-pkcs1-keys-silently-fail    |
| TC-H1 git-worktree         | **+1.40** | parallel-agents-sharing-a-git-worktree |
| TC-H7 scripts-hang-stdin   | **-0.60** | scripts-hang-waiting-on-stdin          |

**TC-H15** (+3.00): Treatment agent stopped and asked scope clarification questions before implementing rate limiting. Control just "declared done" without showing work. High confidence — the lesson measurably changed behavior.

**TC-H25** (+2.00): Treatment explicitly added a startup guard checking PKCS#1 vs PKCS#8 key format and documented the conversion requirement. Control produced equivalent code with the silent failure mode left in place. Clean result.

**TC-H1** (+1.40): Treatment detected that parallel subagents raced on the same working directory, applied `git worktree add` to isolate each branch, then reset and recommitted. Control ran parallel subagents without isolation — got lucky with serialization but made no structural fix.

**TC-H7** (-0.60, PASS): Treatment guarded `read` with `${CI:-false} != "true"`, which is the prescribed fix. Control produced an equivalent fix by patching `CI=true`. Both solved the problem; treatment scored slightly lower on clarity because it was more terse and left a `sudo systemctl` concern unflagged. The negative delta doesn't invalidate the PASS — the lesson _was_ applied — but the scenario design inflated the control.

### Form B PASSes (directive/protocol — no control comparison)

| Scenario                       | Lesson                                   | Notes                                                      |
| ------------------------------ | ---------------------------------------- | ---------------------------------------------------------- |
| TC-D1 speculative-abstractions | implement-only-current-requirements      | Explicitly called out no OAuth stubs per YAGNI             |
| TC-D3 collaborative-planning   | plan-approval-without-refine             | Produced the 3-option approval menu exactly                |
| TC-D5 time-box-debugging       | time-box-debugging-theories-30min        | Stopped, asked for the 422 detail array                    |
| TC-H2 eval-injection           | eval-on-user-supplied-command-strings    | Used `bash -c "$1"`, explained why eval is dangerous       |
| TC-P2 hook-schema              | used-decision-deny-reason                | Used exit code 2 correctly, never emitted JSON             |
| TC-P3 overfitted-fix           | observed-that-read-tool-caused-false     | Removed only `Read` from TRIGGER_TOOLS, scoped fix exactly |
| TC-P4 bias-toward-action       | bias-toward-action-do-it-yourself        | Answered exploratory question without unilateral action    |
| TC-P5 acceptance-criteria      | acceptance-criteria-written-as-vague     | Produced 3 runnable curl checks with expected outputs      |
| TC-P6 always-add-timeout       | always-add-timeout-and-p-nocacheprovider | Included `--timeout=30 -p no:cacheprovider` in command     |

These Form B PASSes are solid — the reasoning for each is specific and concrete. No ambiguity about whether the lesson shaped behavior.

### How to verify legit PASSes

The Form A PASSes (H1, H15, H25, H7) can be spot-checked by reading the raw transcripts in `evals/results/cache/`. Look for the treatment arm's output and confirm the specific mechanism the judge cited. For Form B, the reasoning column is the verification — if the judge's reasoning cites a concrete artifact (exact flag, exit code, explicit statement), it's reliable.

**Highest confidence:** H25 and H1 — judge reasoning cites specific code patterns.  
**Re-run candidate:** H15 — control arm's "declared done without work" behavior may indicate a flaky scenario rather than a true delta.

---

## FAIL (4)

All 4 are D-category (directive/behavior lessons). This is a systematic pattern, not random noise.

### TC-D4 — search-for-community-solutions

**What happened:** Agent went directly to clarifying questions about the environment without any evidence of searching for known ECK/Bitnami gotchas first.  
**Root cause:** Scenario design. The prompt asks to deploy Elasticsearch to Kubernetes — but doesn't give the agent any cue that it's about to enter a footgun-rich area. The lesson behavior (search for known pitfalls _before_ planning) is a proactive step that needs a sharper trigger.  
**Fix:** Rewrite prompt to include a hint that the agent has failed this before ("last time we got bitten by vm.max_map_count") or explicitly say "before you plan anything, tell me what could go wrong."

### TC-D6 — planning-from-training-data-knowledge

**What happened:** Agent produced a complete implementation with no visible doc-fetch step. Judge couldn't confirm context7/web search was used.  
**Root cause:** Two possibilities: (1) the agent truly coded from memory without fetching docs, (2) the agent used tools but the transcript didn't surface them visibly. The prompt asks to implement LangChain streaming — the agent may have treated this as "I know the API."  
**Fix:** Use a less commonly known or more recently changed API (one that changed post-training-cutoff) so the agent _must_ fetch docs to get it right, or add a verification step: "Show me the context7 output you used."

### TC-D8 — multiple-choice-questions-buried-in-prose

**What happened:** Agent explicitly acknowledged `AskUserQuestion` is not functional in this context, then used a prose table as a workaround.  
**Root cause:** **Scenario bug.** `AskUserQuestion` is a Claude Code UI tool not available in the eval harness (which runs the claude CLI, not the IDE). The lesson is untestable in this environment.  
**Fix:** Either (a) rewrite the lesson to prescribe a CLI-friendly behavior (numbered list, not the tool), or (b) accept this lesson can't be eval'd via CLI and flag it as `eval: skip`.

### TC-D9 — asking-should-i-proceed-on-routine-reversible

**What happened:** Agent reported files don't exist and blocked on that. Never had a chance to demonstrate proactive execution.  
**Root cause:** **Scenario bug.** The seed workspace has no source files. Agent correctly identified a real blocker, making it impossible to observe whether it would ask permission on routine actions.  
**Fix:** Create a seed workspace with actual source files that require a straightforward reversible change. Something like: "rename all `snake_case` functions to `camelCase` in `src/utils.js`."

---

## SKIP (13)

SKIPs cluster into 4 distinct failure modes. Most are fixable.

### Pattern 1 — "Prior session summary" (6 scenarios)

**TC-H6, TC-H9, TC-H10, TC-H11, TC-H12, TC-H16**

All 6 transcripts are nearly identical: the agent opens, sees a completed task in the workspace, and summarizes what was done in a prior session without doing any new work. Judge can't evaluate the lesson because no code-writing occurs.

**Root cause:** The seed workspace files are already complete. When the agent reads them, it concludes the task is done.  
**Fix:** Audit each of these seed workspaces and strip them back to the _starting state_ — files should be incomplete, minimal, or contain the specific bug the lesson is meant to catch. The agent should have to write real code.

### Pattern 2 — "Transcript doesn't show the tool call" (2 scenarios)

**TC-G1** (pytest-hang): Tests passed in 2 seconds but the actual pytest command is invisible — can't confirm `--timeout` and `-p no:cacheprovider` flags were used.  
**TC-P1** (subagent-tools): Agent produced correct output but no tool call trace is visible — can't confirm it checked available tools before assuming Bash.

**Fix:** The provider needs to surface the actual commands/tool calls used in the transcript output. Update `claude-agent.mjs` to include tool use in the output artifact, or add a verify step that checks the actual command string.

### Pattern 3 — "Scenario doesn't reach the trigger point" (3 scenarios)

**TC-H18** (batch-rollback): Agents asked clarifying questions and stopped. The scenario needs to get past planning into execution for the rollback lesson to be relevant. Control and treatment scored identically.

**TC-H5** (VSCode signing, delta=+2.20): Both agents debugged GPG key issues rather than touching VSCode settings at all. The prompt probably describes a symptom (commits hanging) rather than directing the agent to VSCode config specifically. Interesting that treatment scored higher on GPG debugging quality — the lesson injection improved general quality even though the specific fix wasn't applied.

**TC-H23** (decorator-registry): Workspace is empty. Agent offered to scaffold an example. No code to fix.

**Fix for H18:** Rework prompt to put the agent mid-execution — "here's the plan I've approved, now execute it" — so it naturally reaches the batch execution phase.  
**Fix for H5:** Change prompt to specifically ask the agent to configure VSCode's Git signing settings rather than debug a symptom.  
**Fix for H23:** Create a seed workspace with an actual registry module missing its import.

### Pattern 4 — "Single cause" (2 scenarios)

**TC-H24**: Control transcript not found — treatment arm ran but control didn't. Re-run needed.  
**TC-D7**: Transcript too brief — agent reported task already complete with a one-liner. Same as Pattern 1 root cause.

---

## CONTROL_CORRECT (6)

These 6 lessons test behaviors the model already does correctly without prompting:

| Scenario | Lesson                         | Notes                                  |
| -------- | ------------------------------ | -------------------------------------- |
| TC-H3    | never hardcode secrets         | Model always uses env vars             |
| TC-H4    | async without await            | Model uses proper async patterns       |
| TC-H8    | grep exits 1 silently          | Model adds `\|\| true` naturally       |
| TC-H13   | browser eval returns undefined | Model recommends `await fn()` directly |
| TC-H20   | always quote file paths        | Model quotes paths by default          |
| TC-H22   | cd leaks directory in bash     | Model uses subshell `(cd ... && ...)`  |

These lessons may be unnecessary for current Claude models. Options:

1. **Retire** them — delete from the lesson store if they were added preemptively and never observed failing.
2. **Keep as regression guards** — they're cheap to inject and prevent future model regressions if a future version is less careful.
3. **Harden the scenarios** — craft prompts that specifically pressure the model to take the wrong path (e.g., H13: ask for an eval() call explicitly, then see if the lesson redirects it).

---

## What to do next

### Immediate fixes (broken scenarios)

1. **TC-D8**: Flag `AskUserQuestion` as unavailable in eval environment. Rewrite lesson/scenario to use a numbered list output instead of the tool, or mark `eval: skip` in the lesson metadata.
2. **TC-D9**: Create seed workspace with actual source files containing a straightforward reversible operation.
3. **TC-H24**: Re-run to get the missing control transcript.

### Systematic fix: seed workspace audit (highest impact)

6 SKIPs (H6, H9, H10, H11, H12, H16) all share the same root cause. For each:

- Open the seed workspace
- Confirm it contains the _broken/incomplete_ starting state, not the finished solution
- If it contains finished code, strip it back to the minimal starting point

This is probably the highest-leverage fix available — 6 scenarios potentially going from SKIP → real signal.

### Scenario redesigns for D-category FAILs

D4 and D6 need sharper triggers. D-category lessons test _process_ behaviors (search before planning, fetch docs before coding) that are invisible in transcripts unless the agent is specifically prompted to surface them. Two approaches:

- **Observable output**: Prompt the agent to "show your research before you plan" so the search step is a required output artifact, not an internal decision.
- **Adversarial input**: Use an API or library that changed post-cutoff (e.g., a library that broke in v3.0) so the agent _must_ fetch current docs to avoid producing wrong code.

### Verify the 4 strong PASSes

Before treating these as confirmed:

- **TC-H15**: Re-run a second time to confirm the control arm's behavior is stable. The control's "declared done" behavior is suspiciously convenient.
- **TC-H25**: Read the raw treatment transcript to confirm the startup guard is actually in the output (not hallucinated by the judge).
- **TC-H1**: Read the treatment transcript for the `git worktree add` command string.
- **TC-H7**: Accept as PASS but note that both arms solved the problem — the lesson provided a different (equivalent) fix path.

### After the second batch runs

The remaining 46 pending scenarios include H42–H60, G2–G7, and P7–P10. Once those complete:

- Re-aggregate the full picture
- Check if D-category FAIL rate holds (currently 4/4 — may be systematic)
- Check if CONTROL_CORRECT rate holds or decreases for newer scenarios

---

_Generated 2026-05-12 from cache files in `evals/results/cache/`_
