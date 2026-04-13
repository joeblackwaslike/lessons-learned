---
name: lessons:review
description: Review scan candidates and promote lessons to the active store
allowed-tools: ['Bash', 'Read']
---

You are running the `/lessons:review` workflow. Work through every phase below in order.
Do not ask clarifying questions before Phase 4 — gather all information first.

---

## Phase 1: Scan

Run an incremental scan to pick up any new candidates from recent session logs:

```bash
node scripts/lessons.mjs scan
```

Report the number of bytes scanned and how many new candidates were saved to the DB.

---

## Phase 2: Aggregate

Pull all current candidates from the DB and capture the JSON output:

```bash
node scripts/lessons.mjs scan aggregate
```

Parse the returned JSON. If `totalCandidates` is 0, tell the user "No candidates found — nothing to review." and stop.

---

## Phase 3: LLM Review Pass

Read the active lessons for context:

```bash
node scripts/lessons.mjs list
```

For each candidate in the aggregate JSON, silently apply the following filter rules:

1. **Exact duplicate** — if the candidate's `contentHash` appears in any active lesson → mark `archive:duplicate`.
2. **Near-duplicate** — if Jaccard similarity of `problem` text vs. an existing active lesson is ≥ 0.5 and the candidate adds nothing new → mark `archive:near-duplicate`.
3. **Situational / not generalizable** — problem only applies to the specific project or one-off context with no reusable rule → mark `archive:situational`.
4. **Keep** — everything else. For kept candidates, generate or validate:
   - `summary` (≤ 80 chars, present-tense description)
   - `problem` (clear description of what goes wrong and why)
   - `solution` (concrete fix or avoidance strategy)
   - `tags` (1–4 `category:value` tags)
   - `priority` (1–10, where 10 = highest severity)
   - `confidence` (0.0–1.0)
   - `injectOn` (`["PreToolUse"]` or `["SessionStart"]` or both)
   - `toolNames` / `commandPatterns` / `pathPatterns` as applicable

---

## Phase 4: Present Numbered List

Show a numbered list of the candidates to the user. For each **kept** candidate:

```
[N] <slug>  tool:<tool>  tags:<tag1,tag2>  priority:<p>  conf:<c>
    Problem:     <problem>
    Solution:    <solution>
    Triggers:    <injectOn>  <toolNames/commandPatterns/pathPatterns if any>
```

Below the kept candidates, add a section **"LLM pre-archived"** listing each candidate marked for archival with its reason.

---

## Phase 5: Parse User Response

Wait for the user to respond. Accept natural-language input using this grammar:

| Input                               | Meaning                                 |
| ----------------------------------- | --------------------------------------- |
| `approve 1 3`                       | Promote items 1 and 3 as-is             |
| `approve all`                       | Promote all kept candidates             |
| `skip 2`                            | Leave item 2 as a candidate (no change) |
| `archive 3 "reason"`                | Archive item 3 with the given reason    |
| `edit 1 summary "New summary text"` | Patch field before promoting            |
| `edit 1 priority 8`                 | Patch numeric field before promoting    |

Multiple instructions can appear in one message (one per line or comma-separated).
Items not mentioned are left as candidates (no action taken).

---

## Phase 6: Confirm Then Promote

Before writing anything, show a confirmation block:

```
Ready to apply:
  Promote: <ids of items being promoted, one per line with slug>
  Archive: <id: reason for each item being archived>
  Patches: <field changes per item if any>

Confirm? (yes / cancel)
```

Wait for "yes" (or "y"). If the user says anything else, return to Phase 5.

On confirmation, build the `promote` command from the approved items:

```bash
node scripts/lessons.mjs promote \
  --ids <id1>,<id2>,... \
  [--archive "id1:reason" --archive "id2:reason" ...] \
  [--patch '{"id1":{"summary":"...","priority":8},...}']
```

Run it.

---

## Phase 7: Report

Print the output from `promote` verbatim, then add a one-line summary:

```
Done — N promoted, M archived. Run `node scripts/lessons.mjs build` if the manifest needs refreshing (promote does this automatically).
```
