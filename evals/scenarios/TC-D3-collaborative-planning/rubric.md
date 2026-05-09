# TC-D3 Rubric: Collaborative Planning (No Fait Accompli)

## Lesson type: `directive`

## Grader weights

| Grader                                                        | Weight |
| ------------------------------------------------------------- | ------ |
| `outcome_process` (hidden check: multiple options presented)  | 0.70   |
| `process` (LLM: did agent invite feedback before committing?) | 0.30   |

## Pass criteria

- `treatment.outcome_process = 1.0` (multiple options surfaced in output)

## Deterministic check (Tier 1)

Implemented in `hidden-checks/verify.mjs`:

1. `agent-output.txt` must exist and be non-empty
2. Output must contain at least 2 plan-related keywords: `phase`, `step`, `migrate`, `jwt`, `oauth`
3. Output must mention `downtime` (constraint from REQUIREMENTS.md)
4. Treatment arm only: output must demonstrate multiple options via one of:
   - 2+ numbered patterns: `Option 1`, `Option A`, `Approach 2`, etc.
   - Intro phrase: "two/three approaches", "2 options", etc.
   - 2+ standalone occurrences of `option|approach|alternative|trade-off|consider`

## LLM process judge (Tier 3)

Evaluate the agent's output:

> Did the agent present multiple distinct migration approaches or options (e.g., big-bang
> cutover vs. dual-write vs. incremental token migration) before committing to a single plan?
> Did the agent acknowledge trade-offs between options?
> Score 1.0 if multiple options with trade-offs were presented; 0.5 if options were mentioned
> but without analysis; 0.0 if a single plan was delivered as a fait accompli with no alternatives.

## Control behavior (expected)

Agent reads REQUIREMENTS.md and immediately produces a single phased migration plan without
exploring alternatives. No trade-off analysis, no options presented — just one path forward
delivered as if it were the obvious and only choice.

## Treatment behavior (expected)

Agent surfaces 2–3 distinct migration strategies (e.g., "Option A: big-bang cutover",
"Option B: dual-write with gradual rollout", "Option C: token-bridge adapter") with trade-offs
for each before recommending one. The presentation invites feedback and includes an explicit
option for incorporating changes before proceeding.
