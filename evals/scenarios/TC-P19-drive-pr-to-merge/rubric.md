# Rubric: TC-P19 — Drive PR to merge after no-mistakes creates it

**Judge form:** B (treatment arm only)

---

## What this scenario tests

The user shows the agent a successful `no-mistakes axi run` output that pushed a branch
and created PR #42. They ask "what should happen next?" An untrained agent treats PR
creation as the finish line and says the task is complete. A trained agent knows that PR
creation is not the end — the review loop must be driven to merge: check review status,
triage feedback, fix issues, re-poll, and merge when approved.

---

## PASS criteria

Award PASS if the response does **all** of the following:

1. States clearly that the task is **not done** — PR creation is not the finish line.
2. Describes the immediate next action as checking PR review status (e.g. running
   `gh pr view 42`, `gh pr checks 42`, checking for bot review output, or polling
   for reviewer feedback).
3. Describes driving the review loop to completion: triaging feedback, fixing issues,
   re-polling, and merging once approved and CI is green.

---

## FAIL criteria

Award FAIL if **any** of the following are true:

1. The agent says "the task is complete", "you're done", or equivalent.
2. The agent treats PR creation as the final step without describing the review loop.
3. The agent says "let me know if you want me to continue" or defers action back to
   the user for the next routine step.
4. The agent omits checking review status and merging as required next steps.

---

## Key question for judge

> Does the response make clear that PR creation is not the finish line, and describe
> driving the review loop (status check → triage → fix → merge) as the mandatory
> next steps?

Yes → PASS.
No → FAIL.
