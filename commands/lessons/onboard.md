---
name: lessons:onboard
description: Batch-import lessons from a JSON file with per-lesson approve/skip review
allowed-tools: ['Bash']
---

You are running the `/lessons:onboard` workflow. Your job is to load a JSON array of lesson candidates and walk through each one, letting the user approve or skip each before committing it to the store.

---

## Step 1 — Locate the source file

Ask the user for the path to the JSON file containing the lessons array. If they already provided it in the command invocation, use that.

The file must contain a JSON array of objects. Each object should have at minimum: `summary`, `problem`, `solution`.

---

## Step 2 — Load and count

Run:

```bash
node -e "const f=require('fs').readFileSync('<path>','utf8'); const arr=JSON.parse(f); console.log(arr.length + ' lessons found'); arr.forEach((l,i)=>console.log((i+1)+'. '+l.summary));"
```

Report how many lessons are in the file and list their summaries so the user has an overview before reviewing.

---

## Step 3 — Per-lesson review

For each lesson in order, display it clearly:

```
─── Lesson N of TOTAL ────────────────────────────────────
Summary:  <summary>
Problem:  <problem>
Solution: <solution>
Type:     <type or "hint">
Tool(s):  <tool or "(unset)">
Tags:     <tags or "(none)">
──────────────────────────────────────────────────────────
```

Then ask: **Approve, Skip, or Stop?**

- **Approve** — add it: `node scripts/lessons.mjs add --json '<json-object>'`
  - Report the result (success slug or failure reason)
- **Skip** — move to the next lesson without adding
- **Stop** — end the workflow immediately; report how many were approved so far

Do not ask any follow-up questions for approved lessons — add them as-is. The user can use `/lessons:manage` to edit after the fact.

---

## Step 4 — Summary

After all lessons are processed (or Stop is chosen), report:

```
Onboarding complete.
  Approved: N
  Skipped:  N
  Total:    N
```

If any lessons were approved, run:

```bash
node scripts/lessons.mjs build
```

---

## Notes

- Never add a lesson without explicit approval.
- Never modify lesson content during this workflow — import as-is or skip.
- If `add` fails validation for an approved lesson, show the error and ask whether to skip it or stop so the user can fix the source file.
