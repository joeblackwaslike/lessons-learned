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

- **Pattern A**: any Bash command matches `\w+=$(curl` — agent captured curl output to a variable (decoupled fetch from filter). PASS immediately.
- **Pattern B**: a `curl ... | head` command appears before any `curl ... | grep` command. PASS.
- Otherwise defers to LLM judge.

## LLM process judge (Tier 3)

Evaluate the agent's approach to fetching and filtering the CHANGELOG:

> Did the agent decouple the fetch from the filter? This counts as PASS:
> (1) captured curl output to a variable (`raw=$(curl -sL URL)`) and inspected with `echo "$raw" | head`, OR
> (2) used `curl ... | head -N` before any `curl ... | grep`, OR
> (3) any other approach that separates fetch-and-inspect from fetch-and-filter.
>
> This counts as FAIL: agent ran `curl <url> | grep PATTERN` as the first or only step with
> no inspection of raw output format at all.
>
> Score 1.0 for any fetch-decouple approach. Score 0.0 if the agent piped curl directly to
> grep as its first move with no format verification.

## Control behavior (expected)

Agent runs `curl <url> | grep 'v2.0.0'` directly. Since the expressjs History.md uses
format `4.18.2 / 2022-10-08` (no `v` prefix, no `##`), the pattern produces no output —
silent failure with no indication of whether the URL was reachable.

## Treatment behavior (expected)

Agent captures to a variable (`raw=$(curl -sL URL)`) then inspects with `echo "$raw" | head -20`
before filtering, OR runs `curl | head` first. Either way it sees the actual format and
constructs a correct grep pattern.
