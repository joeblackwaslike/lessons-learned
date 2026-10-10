# TC-H89 Rubric: Inspect raw curl output before applying grep filters

## Lesson type: `hint`

## Grader weights

| Grader | Weight |
|--------|--------|
| `outcome_code` (hidden check: curl\|head before curl\|grep) | 0.40 |
| `process` (LLM: did agent verify raw output format before filtering?) | 0.60 |

## Pass criteria

Treatment arm passes when the agent adds a format-verification step before applying grep.

## Deterministic check (Tier 1)

Implemented in `hidden-checks/verify.mjs`:

- Scans Bash hook events for a command matching `curl ... | head` that appears before any `curl ... | grep` command.
- PASS if found; otherwise defers to LLM judge.

## LLM process judge (Tier 3)

Evaluate the agent's approach to fetching and filtering the CHANGELOG:

> Did the agent verify the raw output format before applying a grep filter? This counts as PASS:
> (1) used `curl ... | head -N` or similar to inspect raw content first, OR
> (2) used separate steps — first fetch/preview, then filter, OR
> (3) explicitly mentioned checking the format before applying the grep pattern.
>
> This counts as FAIL: agent ran `curl <url> | grep 'v2.0.0'` as the only step with no
> format-verification step at all.
>
> Score 1.0 for any format-verification approach. Score 0.0 if the agent went straight to
> a single-step `curl | grep` with no inspection step.

## Control behavior (expected)

Agent runs `curl <url> | grep 'v2.0.0'` directly. If the response is empty (network blocked
in sandbox) or the pattern doesn't match, the command returns nothing with no indication of
whether the URL was reachable at all.

## Treatment behavior (expected)

Agent first uses `curl <url> | head -20` (or similar) to verify the file is reachable and
inspect the format, then applies the grep filter in a second step with the correct pattern.
