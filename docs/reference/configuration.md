# Configuration Reference

Full reference for all fields in `data/config.json`.

Schema: [`schemas/config.schema.json`](../../schemas/config.schema.json)

---

## Injection settings

### `injectionBudgetBytes`

**Type:** `integer` **Default:** `4096` **Min:** `256`

Maximum total bytes of lesson text injected as `additionalContext` per hook invocation.

When multiple lessons match a tool call, they are added in priority order until the budget is exhausted:

1. Full text injected if it fits
2. Summary injected if full text doesn't fit (`**Lesson**: {summary}`)
3. Lesson dropped if neither fits

The first lesson is always injected regardless of budget.

---

### `maxLessonsPerInjection`

**Type:** `integer` **Default:** `3` **Min:** `1` **Max:** `10`

Hard cap on the number of lessons injected per hook invocation. Applied after priority sorting, before the byte budget check.

Set to `1` for maximum focus on the single highest-priority lesson. Set higher to inject more lessons per call.

---

### `minConfidence`

**Type:** `number` **Default:** `0.5` **Range:** `0.0–1.0`

Lessons with `confidence` below this value are excluded from the manifest at `lessons build` time. They still exist in `lessons.json`.

| Confidence range | Meaning                                   |
| ---------------- | ----------------------------------------- |
| ≥ 0.9            | Manually curated / hand-authored          |
| 0.7–0.9          | Strong heuristic or user-confirmed Tier 2 |
| 0.5–0.7          | Tier 1 with sparse tags                   |
| < 0.5            | Unreviewed Tier 2 candidate               |

Changes require `node scripts/lessons.mjs build`.

---

### `minPriority`

**Type:** `integer` **Default:** `1` **Range:** `1–10`

Lessons with `priority` below this value are excluded from the manifest. Use to suppress low-confidence or low-priority lessons from injection without archiving them.

Changes require `node scripts/lessons.mjs build`.

---

### `compactionReinjectionThreshold`

**Type:** `integer` **Default:** `7` **Range:** `1–10`

After Claude Code's `/compact` command compresses the conversation, dedup state is partially cleared. Lessons with `priority >= compactionReinjectionThreshold` have their dedup entries removed, allowing them to re-inject in the new context window.

Set lower to re-inject more lessons after compaction. Set to `10` to prevent any re-injection. Default `7` re-injects high-priority and critical lessons (priorities 7–10).

---

## Scan settings

### `scanPaths`

**Type:** `string[]` **Default:** `["~/.claude/projects/"]`

Directories to search for Claude Code session JSONL files. Tilde (`~`) is expanded at scan time.

Add additional paths if your agent writes session logs to non-standard locations.

---

### `autoScanIntervalHours`

**Type:** `integer` **Default:** `24` **Min:** `1`

Minimum interval between automatic background scans in hours. The background scan (fired on session `startup`) is skipped if the last scan was less than this many hours ago.

Set to `0` to scan on every session startup. Set higher to reduce scan frequency on large log archives.

Note: setting to `0` is not in the schema minimum (`1`) — force a scan manually with `node scripts/lessons.mjs scan` instead.

---

### `maxCandidatesPerScan`

**Type:** `integer` **Default:** `50` **Min:** `1`

Maximum number of candidates written per scan run. Prevents unbounded candidate accumulation in repositories with very large session archives.

---

## Scoring settings

These weights adjust initial priority scores assigned to candidates by the scanner. They influence the priority field of new candidates — you can always override manually via `lessons edit`.

### `scoring.multiSessionBonus`

**Type:** `integer` **Default:** `2`

Priority boost when the same mistake pattern is observed in 2 or more distinct sessions.

---

### `scoring.multiProjectBonus`

**Type:** `integer` **Default:** `1`

Priority boost per additional project directory where the pattern was observed. A pattern seen in 3 projects gets `+2` (2 additional × 1).

---

### `scoring.hangTimeoutBonus`

**Type:** `integer` **Default:** `1`

Priority boost when the error involved a process hang or timeout (detected from error signals in the tool result).

---

### `scoring.userCorrectionBonus`

**Type:** `integer` **Default:** `1`

Priority boost when a user correction message was detected near the error turn (e.g., "no", "wrong", "that's not right").

---

### `scoring.singleOccurrencePenalty`

**Type:** `integer` **Default:** `-1`

Priority penalty for patterns observed only once. Single-occurrence patterns are less likely to be recurring mistakes and more likely to be one-off incidents.

---

## Full example

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
