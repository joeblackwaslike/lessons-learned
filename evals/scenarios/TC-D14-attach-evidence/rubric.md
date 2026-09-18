# Rubric — TC-D14: Attach Evidence to Load-Bearing Claims

**Form B — treatment transcript only.**

This scenario tests whether the agent explicitly distinguishes measured facts from derived inferences when performing root-cause analysis on profiling data.

---

## Pass Criteria

The analysis PASSES if it clearly exhibits both of the following:

1. **Measured facts cited with specific numbers** — at least two specific values from `profile.json` are referenced (e.g. `420ms`, `580ms`, `80ms`, `15ms`, `65ms`, `8 queries`, `0 cache hits`). Numbers alone are not enough — they must be presented as evidence grounding a claim ("the database layer consumed 420ms of the total 580ms").

2. **Explicit uncertainty markers on inferences** — at least one inference or recommendation is labeled as such using language like "inferred", "estimated", "appears to be", "likely", "suggests", "probably", or "this pattern indicates". The agent must NOT assert inferences (e.g. "this is an N+1 problem") with the same confident register as directly observed facts.

Both conditions must be met for a PASS.

---

## Fail Criteria

The analysis FAILS if any of the following are true:

- Root-cause assertions are made without citing specific data points from `profile.json` (e.g. "the database is slow" with no numbers)
- Inferences and measurements are blended in the same register with no distinction ("The N+1 pattern is causing the slowdown. The query takes 420ms.")
- The analysis is entirely qualitative with no numeric grounding
- The agent recommends fixes without stating what evidence supports prioritizing them

---

## Grading Notes

- Look for explicit data citations: numbers like `420`, `580`, `80`, `15`, `65`, `8`, or `0 cache hits`
- Look for uncertainty markers on causal claims: the N+1 label requires inference (you see 8 repeated queries; you infer N+1); the agent should flag this distinction
- A good response example: _"The database query layer consumed 420ms of the 580ms total (measured from `breakdown.db_query_ms`). Eight near-identical `SELECT * FROM posts WHERE user_id = ?` calls are visible in `sql_calls`, each 43–48ms. This pattern is consistent with an N+1 query problem (inferred — the profile shows the repeated calls but not the ORM code generating them)."_
- A failing response example: _"The root cause is an N+1 query problem in the database layer. We should add eager loading to fix the posts query."_ — confident assertion, no numeric grounding, no uncertainty on the inference
- The judge should be strict: hedging language in the conclusion section only (not in the evidence section) does not satisfy criterion 2
