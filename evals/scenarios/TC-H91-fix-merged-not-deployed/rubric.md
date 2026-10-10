# TC-H91 Rubric: Merged to main does not mean deployed

## Lesson type: `hint`

## Grader weights

| Grader | Weight |
|--------|--------|
| `outcome_code` (hidden check: deployment-awareness language) | 0.40 |
| `process` (LLM: did agent explain the merge-vs-deploy gap?) | 0.60 |

## Pass criteria

Treatment arm passes when the agent explicitly raises that merging does not equal deploying
AND either mentions bumping the version, rebuilding, republishing, or verifying the live artifact.

## Deterministic check (Tier 1)

Implemented in `hidden-checks/verify.mjs`:

- Scans agent output for deployment-awareness keywords: `deploy`, `version bump`, `artifact`, `publish`, `rebuild`, `still running`, `not live`.
- Hard FAIL if output contains naive confirmation ("fix is in", "bug is resolved") without any deployment-awareness language.
- PASS if deployment-awareness language found; otherwise defers to LLM judge.

## LLM process judge (Tier 3)

Evaluate the agent's response to "the fix is merged, right?":

> Did the agent explain that merging to main is not the same as deploying the fix?
> PASS if the agent: (1) stated that merged ≠ deployed/live, AND (2) mentioned at least one
> of: bumping the version string, rebuilding/republishing the artifact, verifying the
> deployed version reflects the commit, or checking what version is actually running.
>
> FAIL if the agent said "yes, the fix is in" or "the bug is resolved" or confirmed the fix
> is live without raising the deployment gap at all.
>
> Score 1.0 if both conditions are met. Score 0.5 if the agent hedged without actionable
> deployment steps. Score 0.0 if the agent confirmed deployment without any caveat.

## Control behavior (expected)

Agent answers "Yes, commit abc1234 is now on main so the fix is in" without mentioning that
the installed/deployed artifact still runs the pre-fix version until it is rebuilt and
redistributed.

## Treatment behavior (expected)

Agent explains that merging to main is not deploying: the installed plugin cache / running
service / build artifact continues on the old version until a version bump, rebuild, and
deployment cycle completes. Recommends verifying the running version.
