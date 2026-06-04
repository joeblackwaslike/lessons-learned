---
sidebar_position: 5
title: Configuration
description: All config settings for injection budget, scan frequency, thresholds, and scoring — with environment variable overrides.
---

# Configuration

All settings live in `data/config.json`. The file is read at hook time — no restart needed after changes unless you modify injection budget or lesson thresholds that affect the manifest.

Every setting has an environment variable equivalent that takes precedence over `config.json`. This lets you override settings per-session or in CI without editing the config file.

---

## Environment variable quick reference

| Setting                          | Environment variable                       |
| -------------------------------- | ------------------------------------------ |
| `injectionBudgetBytes`           | `LESSONS_INJECTION_BUDGET_BYTES`           |
| `maxLessonsPerInjection`         | `LESSONS_MAX_LESSONS_PER_INJECTION`        |
| `minConfidence`                  | `LESSONS_MIN_CONFIDENCE`                   |
| `minPriority`                    | `LESSONS_MIN_PRIORITY`                     |
| `compactionReinjectionThreshold` | `LESSONS_COMPACTION_REINJECTION_THRESHOLD` |
| `scanPaths`                      | `LESSONS_SCAN_PATHS` _(colon-separated)_   |
| `autoScanIntervalHours`          | `LESSONS_AUTO_SCAN_INTERVAL_HOURS`         |
| `maxCandidatesPerScan`           | `LESSONS_MAX_CANDIDATES_PER_SCAN`          |
| _(config file path)_             | `LESSONS_CONFIG_PATH`                      |

Example — inject only the top lesson, temporarily:

```bash
LESSONS_MAX_LESSONS_PER_INJECTION=1 node hooks/pretooluse-lesson-inject.mjs
```

Example — use a custom config file:

```bash
LESSONS_CONFIG_PATH=/tmp/ci-config.json node scripts/lessons.mjs build
```

---

## Config file quick reference

```json
{
  "$schema": "../schemas/config.schema.json",
  "type": "lessons-learned-config",
  "version": 1,

  "injectionBudgetBytes": 4096,
  "maxLessonsPerInjection": 3,
  "minConfidence": 0.5,
  "minPriority": 1,
  "compactionReinjectionThreshold": 7,

  "scanPaths": ["~/.claude/projects/"],
  "autoScanIntervalHours": 24,
  "maxCandidatesPerScan": 50,

  "scoring": {
    "multiSessionBonus": 2,
    "multiProjectBonus": 1,
    "hangTimeoutBonus": 1,
    "userCorrectionBonus": 1,
    "singleOccurrencePenalty": -1
  }
}
```

---

## Injection settings

These control what gets injected and how much.

### `injectionBudgetBytes`

**Default:** `4096` · **Env:** `LESSONS_INJECTION_BUDGET_BYTES`

Maximum number of bytes of `additionalContext` injected per tool call. When multiple lessons match, they are added in priority order until the budget is exhausted. If a lesson's full text doesn't fit the remaining budget, the hook falls back to the one-line summary. If even the summary doesn't fit, the lesson is dropped for that call.

The budget does not accumulate across calls — it resets on every tool invocation.

**Tuning guidance:**

- Increase if you have long lessons and want them fully injected.
- Decrease if you find lesson context is crowding out the model's attention.
- 4 KB is appropriate for most lessons. Custom `injection` overrides can be larger.

### `maxLessonsPerInjection`

**Default:** `3` · **Env:** `LESSONS_MAX_LESSONS_PER_INJECTION`

Maximum number of lessons injected per tool call, regardless of budget. Lessons are ranked by priority (descending) before the cap is applied.

**Tuning guidance:**

- `1` — maximum focus; only the highest-priority match fires.
- `3` (default) — balanced; covers most multi-lesson scenarios.
- `5+` — risk of context noise if many lessons match a single call.

### `minConfidence`

**Default:** `0.5` · **Env:** `LESSONS_MIN_CONFIDENCE`

Lessons with `confidence` below this value are excluded from the manifest at build time. They still exist in `lessons.json` — they just don't inject.

Set by the CLI at add time based on the quality of the trigger, mistake, and tag fields:

| Signal                                       | Confidence |
| -------------------------------------------- | ---------- |
| Full structured tag with tool, trigger, tags | 0.75–0.95  |
| Heuristic candidate, user-reviewed           | 0.6–0.75   |
| Heuristic candidate, unreviewed              | 0.4–0.6    |

**Tuning guidance:**

- `0.5` (default) — excludes unreviewed heuristic candidates.
- `0.0` — include everything, including low-quality candidates.
- `0.75` — include only high-confidence structured lessons.

Changes take effect after `node scripts/lessons.mjs build`.

### `minPriority`

**Default:** `1` · **Env:** `LESSONS_MIN_PRIORITY`

Lessons with `priority` below this value are excluded from the manifest. Priority 1 means "include everything except priority 0". Priority 0 is effectively disabled.

Changes take effect after `node scripts/lessons.mjs build`.

### `compactionReinjectionThreshold`

**Default:** `7` · **Env:** `LESSONS_COMPACTION_REINJECTION_THRESHOLD`

When Claude Code compacts the conversation (`/compact`), the dedup state is partially cleared. Lessons with `priority >= compactionReinjectionThreshold` have their dedup entries removed, so they will re-inject in the new context window even if they already fired earlier in the session.

**Use case:** High-priority lessons (hangs, data loss) should re-inject after compaction because the model no longer has context about them. Low-priority reminders don't need to.

**Tuning guidance:**

- `7` (default) — re-inject anything priority 7 or above.
- `10` — never re-inject after compaction (only new lessons inject).
- `1` — always re-inject all lessons after compaction (noisy).

---

## Scan settings

These control how the background scanner discovers lesson candidates from session logs.

### `scanPaths`

**Default:** `["~/.claude/projects/"]` · **Env:** `LESSONS_SCAN_PATHS` _(colon-separated)_

Array of directory paths the scanner searches for JSONL session files. Tilde (`~`) is expanded at scan time. Add additional directories if your agent writes session logs elsewhere.

### `autoScanIntervalHours`

**Default:** `24` · **Env:** `LESSONS_AUTO_SCAN_INTERVAL_HOURS`

Minimum interval between automatic background scans, in hours. The scanner runs on session `startup` — if the last scan was less than `autoScanIntervalHours` ago, the startup scan is skipped.

Set to `0` to scan on every session startup (higher CPU cost on large log directories). Set higher to reduce scan frequency.

### `maxCandidatesPerScan`

**Default:** `50` · **Env:** `LESSONS_MAX_CANDIDATES_PER_SCAN`

Maximum number of candidates written per scan run. Once the limit is reached, the scan stops processing new files. Prevents unbounded candidate accumulation in repos with very large session logs.

---

## Scoring settings

These weights adjust how the scanner scores candidates before assigning an initial priority.

| Field                     | Default | Effect                                                           |
| ------------------------- | ------- | ---------------------------------------------------------------- |
| `multiSessionBonus`       | `2`     | Priority boost when the same mistake is seen in 2+ sessions      |
| `multiProjectBonus`       | `1`     | Priority boost per additional project where the pattern was seen |
| `hangTimeoutBonus`        | `1`     | Boost when the error involved a process hang or timeout          |
| `userCorrectionBonus`     | `1`     | Boost when a user correction message was detected                |
| `singleOccurrencePenalty` | `-1`    | Penalty for patterns seen only once                              |

These scores inform the initial `priority` assigned to candidates. You can always override priority when reviewing or editing a lesson.

---

## Editing config

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
  <TabItem value="slash" label="Slash command" default>

```text
/lessons:config → "set injectionBudgetBytes to 6144"
```

  </TabItem>
  <TabItem value="cli" label="CLI">

```bash
node scripts/lessons.mjs config set injectionBudgetBytes 6144
```

  </TabItem>
  <TabItem value="direct" label="Direct edit">

Edit `data/config.json`, then verify with:

```bash
node scripts/lessons.mjs config
```

  </TabItem>
</Tabs>

Changes to `minConfidence` and `minPriority` require a manifest rebuild:

```bash
node scripts/lessons.mjs build
```

All other config changes take effect immediately (read at hook time).
