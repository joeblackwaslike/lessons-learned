---
title: Pruning Obsolete Lessons
description: How to detect, verify, and archive lessons that current models no longer need — and re-test them on other models later.
---

# Pruning Obsolete Lessons

As models improve, some lessons become noise: the model already does the right thing without the lesson, so injecting it adds nothing. The eval framework labels this **`CONTROL_CORRECT`** — the control arm (no lesson) already avoided the failure.

Archiving these is the lesson system working as designed: it removes guidance newer models have internalized, keeping injection focused on mistakes models _still_ make. This will recur with every model generation, so it's a routine, documented operation — not a one-off.

> **A `CONTROL_CORRECT` lesson is not wrong.** It's a _regression guard_ — valuable if a future or weaker model regresses, and possibly still failing on other providers (Codex, Gemini). That's why we archive (reversible) and keep a record, rather than delete.

## The runbook

### 1. Detect — run the eval, look for `CONTROL_CORRECT`

```bash
cd evals
# (see eval-usage.md for meridian + env setup)
npx promptfoo eval --config promptfooconfig.yaml --filter-pattern 'TC-...'
```

Read the **Tier 3 Judge Summary**. `CONTROL_CORRECT` outcomes are pruning candidates.

### 2. Verify fresh — BUST THE CACHE FIRST ⚠️

**The provider (`providers/claude-agent.mjs`) content-addresses its cache** (`results/cache/`), keyed on `hash(scenario files) + model + intervention + hash(lesson.problem + lesson.solution)`. A re-run **silently replays old cached transcripts and old judge verdicts** unless one of those inputs changed. A run that looks "complete" in seconds is almost certainly cache hits.

Before trusting any verdict, confirm it ran fresh:

```bash
jq -r '(.results.results // [])[] | [.vars.scenarioId, (.metadata.cacheHit|tostring), (.metadata.judgeResult.outcome // "-")] | @tsv' results/cache/latest-run.json
```

If `cacheHit=true`, bust the cache and re-run:

```bash
mv results/cache results/cache.stale-$(stamp)   # reversible; or delete
npx promptfoo eval --config promptfooconfig.yaml --filter-pattern 'TC-...'
```

(Editing a scenario file or a lesson's `problem`/`solution` also busts that one key — which is why scenario edits re-run correctly.)

### 3. Attempt an adversarial harden (optional, for subtle bugs only)

For a **genuinely subtle** bug the model still sometimes makes (e.g. mocking the wrong namespace), rewrite the scenario `PROMPT.md` to pressure the model toward the mistake, then re-run. If it flips to `PASS`, keep the lesson and the hardened scenario.

For **obvious footguns** (word-splitting, `git stash -u`, quoting), don't bother — current frontier models avoid them even under direct pressure. (Proven: `TC-H42` xargs stayed `CONTROL_CORRECT` even when the prompt forced `find | xargs` on space-named files; the model used `-print0`/`-0` and explained the bug unprompted.)

### 4. Archive with evidence

```bash
node scripts/lessons.mjs promote \
  --archive "<lessonId>:CONTROL_CORRECT in eval <date>; <model> no longer makes this mistake. Archived as model-obsolete noise; retained for cross-model re-test. See data/obsoleted-lessons.json"
node scripts/lessons.mjs build   # rebuild manifest
```

### 5. Record it for cross-model re-testing

Append an entry to [`data/obsoleted-lessons.json`](https://github.com/joeblackwaslike/lessons-learned/blob/main/data/obsoleted-lessons.json) with the `slug`, `lessonId`, `scenarioId`, eval evidence (`verdict`, `evalRunId`, `adversarialTested`), `confidence`, and `retestOn` (providers/models to re-test against). Keep any hardened scenario prompt — it's a sharper probe for the next model.

### 6. Re-test later, restore on regression

When a new model or provider lands, run its arms against the recorded scenarios. If it regresses on a lesson:

```bash
node scripts/lessons.mjs restore --ids <lessonId>
```

## Pitfalls

- **Don't archive on a single cached run.** Always confirm `cacheHit=false`.
- **Judge variance is real.** A borderline lesson can flip `CONTROL_CORRECT`↔`FAIL` between runs; archive on consistent signal, and mark low-confidence cases in the record.
- **Don't conflate `CONTROL_CORRECT` with `FAIL`.** `FAIL` means the lesson was injected but didn't change behavior (a lesson/scenario problem); `CONTROL_CORRECT` means the model never needed it (a pruning candidate).
