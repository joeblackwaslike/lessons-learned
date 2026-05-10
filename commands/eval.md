---
name: eval
description: Run the lesson effectiveness eval suite. Asks for focus, auto-generates missing scenarios, runs evals, and generates a report.
---

You are running the `/eval` command to assess lesson injection effectiveness.

## Step 1 — Ask for prime focus

Ask the user: "What's the prime focus for this eval session?" and offer these options:

1. **All lessons** — run all 9 existing scenario pairs
2. **Specific scenario(s)** — enter TC-\* IDs (e.g. TC-H3, TC-G1)
3. **Specific lesson IDs** — enter lesson slugs to test
4. **Generate new scenarios** — auto-generate for lessons that lack scenarios

## Step 2 — Generate missing scenarios (if needed)

If the user chose option 3 or 4, check whether scenarios already exist:

```bash
ls evals/scenarios/
```

For lessons without a scenario, generate them:

```bash
cd evals && npm run eval:gen -- --ids <slug1,slug2>
```

Or generate for all missing:

```bash
cd evals && npm run eval:gen
```

## Step 3 — Run the eval

Navigate to the evals directory and run:

**All scenarios:**

```bash
cd evals && npm run eval
```

**Specific scenarios (filter by TC-\* pattern):**

```bash
cd evals && npx promptfoo eval --config promptfooconfig.yaml --filter-pattern 'TC-H3|TC-G1' --output results/cache/latest-run.json
```

**Smoke test (fast — TC-H3 + TC-G1 only):**

```bash
cd evals && npm run eval:smoke
```

## Step 4 — Generate and display the report

```bash
cd evals && npm run eval:report:latest
```

The report is written to `evals/results/reports/report-<timestamp>.md` and printed to stdout.

## Step 5 — Offer to open the web viewer

Ask: "Open the web viewer to browse results interactively? (`npx promptfoo view`)"

If yes:

```bash
cd evals && npx promptfoo view
```

## Notes

- **Tier 3 judge**: requires `ANTHROPIC_API_KEY` in the environment. If absent, judge assertions will report SKIP (not fail).
- **Control arms run first**: `maxConcurrency: 1` in config guarantees control transcript files exist before treatment arms call the judge.
- **Cache**: arm results are cached in `evals/results/cache/`. Treatment arms re-run if the lesson's problem or solution changes. Use `npm run eval:clean` to clear all caches.
- **MCP access**: `npx promptfoo mcp` exposes eval history to AI agents (configured in `.mcp.json`).
