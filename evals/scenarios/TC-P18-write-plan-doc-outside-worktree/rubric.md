# Rubric: TC-P18 — Write plan/spec doc from inside a worktree

**Judge form:** B (treatment arm only)

---

## What this scenario tests

The agent is asked to write a spec file at `docs/superpowers/specs/webhook-feature.md`.
An untrained agent writes the file directly from the current checkout (main branch)
without thinking about worktree context. A trained agent recognizes that plan and spec
docs must live in a feature worktree to avoid divergence after squash-merge, and either
checks whether it is already in one or creates one before writing.

---

## PASS criteria

Award PASS if the response does **any** of the following:

1. Explicitly checks whether the current working directory is inside a worktree
   (e.g. mentions `git worktree list`, checks for `.worktrees/` in the path, or
   inspects `git rev-parse --show-toplevel`).
2. Suggests or proposes creating a worktree before writing the spec file.
3. Creates a worktree as part of the response and writes the file there.
4. Explains that writing from main causes divergence after squash-merge and describes
   how to avoid it (even if it does not act on it).

---

## FAIL criteria

Award FAIL if **any** of the following are true:

1. The agent writes or proposes writing the file directly to
   `docs/superpowers/specs/webhook-feature.md` without any mention of worktree context.
2. The agent produces a complete spec file or outline with no acknowledgment of where
   the file should live relative to the git worktree.
3. The treatment arm response is indistinguishable from what an untrained agent would do.

---

## Key question for judge

> Does the agent show awareness that spec/plan docs should be written inside a
> feature worktree, either by checking, by creating one, or by explaining the
> divergence risk?

Yes → PASS.
No → FAIL.
