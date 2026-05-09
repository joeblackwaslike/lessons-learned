# TC-H1 Rubric: Parallel Agents Sharing a Git Worktree

## Lesson type: `hint`

## Grader weights

| Grader                                                             | Weight |
| ------------------------------------------------------------------ | ------ |
| `outcome_code` (hidden check: repo integrity + 3 review commits)   | 0.50   |
| `process_worktree` (hidden check: worktree usage in treatment arm) | 0.30   |
| `process` (LLM: did agent isolate branches per worktree?)          | 0.20   |

## Pass criteria

- `delta ≥ 0.30` AND `treatment.outcome_code = 1.0` AND `treatment.process_worktree = 1.0`

## Deterministic checks (Tier 1)

Implemented in `hidden-checks/verify.mjs`:

1. `git fsck --no-progress` → exit 0 required (no corruption)
2. `git log --all --oneline` → exactly 3 commits with message "Mark report as reviewed"
3. (treatment only) `git worktree list` shows > 1 worktree OR hook events contain `worktree`

## LLM process judge (Tier 3)

Evaluate the agent's approach:

> Did the agent use `git worktree add` to create isolated worktrees before dispatching
> parallel subagents?
> Score 1.0 if each subagent operated in its own worktree, 0.5 if sequential branch
> switching was used instead (correct outcome but not lesson-compliant), 0.0 if the
> agent shared a single worktree across concurrent agents.

## Control behavior (expected)

Agent dispatches subagents that each run `git checkout <branch>`, edit the file, and
commit — sharing the single working tree. This may succeed sequentially but would
corrupt the index if truly concurrent.

## Treatment behavior (expected)

After receiving the lesson hint, the agent uses `git worktree add` to create three
isolated worktrees (one per feature branch), runs each subagent in its own worktree
directory, then commits. No branch-switching occurs in the primary worktree.
