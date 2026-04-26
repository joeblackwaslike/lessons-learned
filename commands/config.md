---
name: lessons:config
description: View and edit lessons-learned configuration, with explanations of what each setting does
allowed-tools: ['Bash', 'Read']
---

# /lessons:config

You are running the `/lessons:config` workflow. Show the current configuration, explain what each setting does in plain terms, and let the user change anything conversationally.

---

## Startup: read current config

```bash
cat data/config.json
```

Parse the JSON. Then present the full configuration as an annotated display — not raw JSON, but a human-readable breakdown grouped by concern. Use this format:

```text
lessons-learned configuration  (data/config.json)

── Injection ──────────────────────────────────────────────
  injectionBudgetBytes          4096
    How many bytes of lesson text can be injected per tool call.
    Lower = less context noise. Higher = more lessons fit.
    Range: 256+   Default: 4096

  maxLessonsPerInjection        3
    Hard cap on lessons injected at once, regardless of budget.
    Range: 1–10   Default: 3

  minConfidence                 0.5
    Lessons below this confidence score are stored but never injected.
    Newly captured candidates start around 0.4–0.6.
    Range: 0.0–1.0   Default: 0.5

  minPriority                   1
    Lessons below this priority are excluded from the manifest entirely.
    Range: 1–10   Default: 1

  compactionReinjectionThreshold  7
    After context compaction, session-start lessons at or above this
    priority are cleared from dedup state so they re-inject.
    Lower = more re-injection after compaction.
    Range: 1–10   Default: 7

── Scanning ───────────────────────────────────────────────
  scanPaths                     ["~/.claude/projects/"]
    Directories scanned for session JSONL files.
    Add paths here if your projects live outside ~/.claude/.

  autoScanIntervalHours         24
    Background scan fires if the last scan is older than this.
    Range: 1+   Default: 24

  maxCandidatesPerScan          50
    Cap on new candidates saved per scan run.
    Range: 1+   Default: 50

── Scoring ────────────────────────────────────────────────
  These bonuses/penalties are applied to candidate priority during
  scan ranking. Higher priority = more likely to surface in review.

  multiSessionBonus             +2    (seen in 2+ sessions)
  multiProjectBonus             +1    (seen in 2+ projects)
  hangTimeoutBonus              +1    (hang/timeout failure pattern)
  userCorrectionBonus           +1    (explicit user correction)
  singleOccurrencePenalty       -1    (only seen once)
```

After showing this, say:

> Which setting would you like to change? Or type "done" to exit.

---

## Handling changes

Accept natural language. Examples:

- "set maxLessonsPerInjection to 5"
- "add ~/projects to scanPaths"
- "set minConfidence to 0.6"
- "set multiSessionBonus to 3"
- "reset injectionBudgetBytes to default"

For each change:

1. Show the current value and the proposed new value
2. Note any constraint violations (e.g. value out of range) before confirming
3. Ask: "Apply this change? (yes / cancel)"

On yes, read the current file, apply the change, and write it back:

```bash
cat data/config.json
```

Then construct the updated JSON, preserving all other fields and the `$schema`/`type`/`version` fields exactly, and write it:

```bash
node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('data/config.json', 'utf8'));
// apply change here
fs.writeFileSync('data/config.json', JSON.stringify(cfg, null, 2) + '\n');
console.log('Saved.');
"
```

After writing, show only the changed field with its new value and ask: "Anything else?"

---

## Special cases

**"reset X to default"** — set the field to the schema default value:

| Field                             | Default |
| --------------------------------- | ------- |
| `injectionBudgetBytes`            | 4096    |
| `maxLessonsPerInjection`          | 3       |
| `minConfidence`                   | 0.5     |
| `minPriority`                     | 1       |
| `compactionReinjectionThreshold`  | 7       |
| `autoScanIntervalHours`           | 24      |
| `maxCandidatesPerScan`            | 50      |
| `scoring.multiSessionBonus`       | 2       |
| `scoring.multiProjectBonus`       | 1       |
| `scoring.hangTimeoutBonus`        | 1       |
| `scoring.userCorrectionBonus`     | 1       |
| `scoring.singleOccurrencePenalty` | -1      |

**Adding to scanPaths** — append without duplicating. Expand `~` in the display but store as-is (the scanner handles tilde expansion).

**Removing from scanPaths** — confirm before removing; warn if it would leave scanPaths empty.

**Changes that affect injection** (injectionBudgetBytes, maxLessonsPerInjection, minConfidence, minPriority) — note: "This takes effect immediately. Run `node /Users/joeblack/github/joeblackwaslike/lessons-learned/scripts/lessons.mjs build` to rebuild the manifest if you want to verify what's included."

---

## Staying in the conversation

After each change or "no change", ask if there's anything else. Only exit when the user says "done", "exit", "quit", or similar.
