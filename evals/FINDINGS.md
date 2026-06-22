# Eval Findings

Durable record of important, non-obvious findings from eval sessions. Newest first.

## 2026-06-22 — The agent model was unpinned (and silently became Opus): CONTROL_CORRECT results are confounded

**Finding.** The eval provider (`providers/claude-agent.mjs`) ran the agent arm with
`claude --print` and **no `--model` flag**, so the agent used the OAuth session's
_default_ model. Over this project's life that default silently changed to **Opus 4.8**,
while the cache key, the metadata label, and the judge all assumed **Sonnet 4.6**.

**Why it matters.** The 2026-06 full-suite run found ~65% of lessons `CONTROL_CORRECT`
(model applies the fix without the lesson). That was read as "the lessons are obsolete."
But if the agent was actually **Opus 4.8**, the improvement may be **the model, not lesson
obsolescence** — Sonnet 4.6 (the intended target, and a model many sessions still run) may
still need many of these lessons. **Any archive decision based on that run is provisional
until re-validated on a pinned model.**

**Impact this session.** 33 lessons were archived as `CONTROL_CORRECT` and recorded in
`data/obsoleted-lessons.json`. These archives are **reversible** (`lessons restore`) and
must be re-validated on pinned **Sonnet** before being trusted. Any that Sonnet still fails
must be restored.

**Fix.** `claude-agent.mjs` now passes `--model <model>`; `model` resolves from
`EVAL_AGENT_MODEL ?? config.model ?? 'claude-sonnet-4-6'`. The agent arm is now pinned.
Because the cache keys were written under the (mislabeled) Sonnet key while the runs were
actually Opus, **the cache must be cleared and the suite re-run on pinned Sonnet** to get
a true baseline.

**Standing decision.** Pin **claude-sonnet-4-6** for eval/regression runs for now
(set `EVAL_AGENT_MODEL=claude-sonnet-4-6` or rely on the provider default). The judge is
already pinned to `claude-sonnet-4-6` in `judge.mjs`.

### Other findings from the 2026-06 run

- **Archiving a lesson orphans its eval scenario.** The runtime injects only from the
  active manifest, so an archived-lesson scenario produces no Tier-3 judge verdict. The
  pre-existing "orphaned" scenarios (G7, H32, H42, H49, H57, the Serena trio) reference
  _already-archived_ lessons — they are not a repointing problem; they are inputs to the
  obsoleted-lessons regression suite.
- **Most CONTROL_CORRECT scenarios had stub verifies** (`output length > 10`); the judge
  did the real work. H8/H22/H27 were upgraded to runtime checks (seed the failure
  condition + execute the artifact) as a proof — even adversarially, the tested model
  passed them, but those checks now catch a future regression.
- **Two judge/agent SKIP causes** are model-side, not scenario bugs: D6 (agent overflows
  its _own_ context following the fetch-docs directive) and D8 (`AskUserQuestion` cannot
  execute in `claude --print`).
