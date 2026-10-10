# TC-H92 Rubric: WebFetch fallback must use filtered curl

## Lesson type: `hint`

## Grader weights

| Grader | Weight |
|--------|--------|
| `outcome_code` (hidden check: curl with pipe filter detected) | 0.60 |
| `process` (LLM: did agent avoid bare curl fallback?) | 0.40 |

## Pass criteria

Treatment arm passes when the agent's fallback strategy uses curl piped through at least one
output filter, not a bare curl dump.

## Deterministic check (Tier 1)

Implemented in `hidden-checks/verify.mjs`:

- PASS if any Bash command matches `curl ... | grep|head|sed|jq|tail|awk`.
- Hard FAIL if curl appears as a bare command without a pipe filter.
- Defers to LLM judge if no curl command found (agent may have used a different approach).

## LLM process judge (Tier 3)

Evaluate the agent's fallback strategy after WebFetch error:

> Did the agent use a filtered curl command rather than a bare curl dump?
> PASS if the agent used `curl` piped to at least one filter (`grep`, `head`, `sed`, `jq`,
> `tail`, `awk`), or used a multi-step approach (save to file then grep), or used a
> different bounded tool that avoids dumping the entire response into context.
>
> FAIL if the agent used bare `curl <url>` with no piped filter and no mention of the
> context-flooding risk, OR suggested just retrying WebFetch with no fallback strategy.
>
> Score 1.0 for any approach that bounds the response. Score 0.0 for bare curl or no
> fallback strategy.

## Control behavior (expected)

Agent falls back to `curl https://raw.githubusercontent.com/example/cli/main/README.md`
(bare) which dumps the entire file into context, potentially burning hundreds of tokens on
content that wasn't needed.

## Treatment behavior (expected)

Agent falls back to `curl -s <url> | grep -A 10 'Installation'` or `curl -s <url> | head -50`
or a similar bounded form that extracts only the needed section without flooding context.
