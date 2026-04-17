---
name: lessons:onboard
description: Batch-import lessons from a JSON file — choose approve-all, reject-all, batch, or one-by-one; supports early exit and resume
allowed-tools: ['Bash']
---

You are running the `/lessons:onboard` workflow. Load a JSON array of lesson candidates and walk through them according to the mode the user selects. Progress is saved to `data/onboard-progress.json` so the session can be resumed after an early exit.

---

## Step 0 — Resume check

Before asking anything, check whether a previous session was interrupted:

```bash
node -e "
const fs = require('fs');
const p = 'data/onboard-progress.json';
if (fs.existsSync(p)) {
  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  console.log(JSON.stringify(s, null, 2));
} else {
  console.log('none');
}
"
```

If a progress file exists, show the user:

```
Interrupted session found:
  File:      <file>
  Mode:      <mode>
  Progress:  <nextIndex> of <total> processed
  Approved:  <approved> | Skipped: <skipped> | Rejected: <rejected>

Resume where you left off, or start a new session?
```

- **Resume** — skip to Step 3 using the saved state (file, mode, batchSize, nextIndex, counts)
- **New session** — delete the progress file and continue to Step 1

---

## Step 1 — Locate the source file

Ask for the path to the JSON file if not already provided. The file must contain a JSON array of objects, each with at minimum: `summary`, `problem`, `solution`.

---

## Step 2 — Preview and mode selection

Load the file and list all lesson summaries:

```bash
node -e "
const arr = JSON.parse(require('fs').readFileSync('<path>', 'utf8'));
console.log(arr.length + ' lessons');
arr.forEach((l, i) => console.log((i+1) + '. ' + (l.summary || '(no summary)')));
"
```

Show the count and list, then ask the user to choose a mode:

```
How do you want to review these N lessons?

  1. Approve all   — import everything that passes validation (no review)
  2. Reject all    — skip everything (no import)
  3. Batch         — review in groups (default: 5 per batch)
  4. One by one    — review each lesson individually
```

For **Batch**, also ask: "Batch size? [5]" — default 5 if they just press enter.

Write the initial progress state before starting any imports:

```bash
node -e "
const fs = require('fs');
fs.writeFileSync('data/onboard-progress.json', JSON.stringify({
  file: '<absolute-path>',
  mode: '<mode>',
  batchSize: <batchSize>,
  total: <total>,
  nextIndex: 0,
  approved: 0,
  skipped: 0,
  rejected: 0,
  startedAt: new Date().toISOString()
}, null, 2));
"
```

---

## Step 3 — Process lessons

### Mode: Approve all

```bash
node scripts/lessons.mjs onboard --file '<path>'
```

Report the output. Run `node scripts/lessons.mjs build` if any were added. Delete the progress file and end.

---

### Mode: Reject all

Report: "All N lessons skipped — nothing imported." Delete the progress file and end.

---

### Mode: Batch

Group lessons into batches of `batchSize`. For each batch:

1. Display all lessons in the batch:

```
═══ Batch B of TOTAL_BATCHES (lessons START–END of TOTAL) ═══════════════

  [N] Summary:  <summary>
      Problem:  <problem>
      Solution: <solution>
      Type:     <type or hint> | Tool(s): <tool or unset> | Tags: <tags or none>

  [N+1] ...

═══════════════════════════════════════════════════════════════════════════
```

2. Ask: **Approve batch, Reject batch, Review individually, or Stop?**

- **Approve batch** — import all lessons in this batch:
  ```bash
  node scripts/lessons.mjs onboard --file '<path>' --from <startIndex> --count <batchSize>
  ```
  Report results. Update progress (nextIndex, approved, rejected counts).

- **Reject batch** — skip all in this batch. Update progress (nextIndex, skipped counts).

- **Review individually** — switch to one-by-one mode for this batch only (see below), then return to batch mode for the next batch.

- **Stop** — save current progress state and report:
  ```
  Session saved. Resume with /lessons:onboard.
    Processed: N of TOTAL
    Approved:  N | Skipped: N | Rejected: N
  ```
  End without deleting the progress file.

After each batch decision, update `data/onboard-progress.json` with the new `nextIndex` and counts.

---

### Mode: One by one

For each lesson, display:

```
─── Lesson N of TOTAL ────────────────────────────────────────────────────
Summary:  <summary>
Problem:  <problem>
Solution: <solution>
Type:     <type or "hint"> | Tool(s): <tool or "(unset)"> | Tags: <tags or "(none)">
──────────────────────────────────────────────────────────────────────────
```

Ask: **Approve, Skip, Reject, or Stop?**

- **Approve** — `node scripts/lessons.mjs add --json '<json-object>'`
  - Report slug on success or error reason on failure (ask skip or stop on validation failure)
- **Skip** — move to next, count as skipped
- **Reject** — move to next, count as rejected
- **Stop** — save progress state and report summary; end without deleting progress file

After each decision, update `data/onboard-progress.json`.

---

## Step 4 — Completion

When all lessons are processed (not stopped early), report:

```
Onboarding complete.
  Approved:  N
  Skipped:   N
  Rejected:  N
  Total:     N
```

If any were approved, run:

```bash
node scripts/lessons.mjs build
```

Delete the progress file:

```bash
node -e "require('fs').unlinkSync('data/onboard-progress.json');"
```

---

## Rules

- Never add a lesson without explicit approval.
- Never modify lesson content during this workflow — import as-is or skip/reject.
- Always update the progress file after each decision in one-by-one and batch modes.
- "Skip" = not now; "Reject" = intentionally excluded. Both result in no import; counts are tracked separately.
- In batch mode, "Review individually" does not change the overall mode — it is a one-time zoom-in.
