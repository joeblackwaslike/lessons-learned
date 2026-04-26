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
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs scan
```

Report the number of bytes scanned and how many new candidates were saved to the DB.

---

## Phase 2: Aggregate

Pull all current candidates from the DB and capture the JSON output:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs scan aggregate
```

Parse the returned JSON. If `totalCandidates` is 0, tell the user "No candidates found — nothing to review." and stop.

---

## Phase 3: LLM Review Pass

Run both queries before starting the pass:

```bash
# Active lessons for duplicate/near-duplicate checks
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs list

# Current project ID for scope detection
pwd | node -e "const c=require('fs').readFileSync('/dev/stdin','utf8').trim(); console.log(c.replace(/\//g,'-').replace(/^-/,''));"
```

For each candidate in the aggregate JSON, silently apply the following filter rules in order:

1. **Exact duplicate** — if the candidate's `contentHash` appears in any active lesson → mark `archive:duplicate`.
2. **Near-duplicate** — if Jaccard similarity of `problem` text vs. an existing active lesson is ≥ 0.5 and the candidate adds nothing new → mark `archive:near-duplicate`.
3. **Situational / not generalizable** — problem only applies to a one-off context with no reusable rule → mark `archive:situational`.
4. **Keep** — everything else. For kept candidates, generate or validate:
   - `summary` (≤ 80 chars, present-tense description)
   - `problem` (clear description of what goes wrong and why)
   - `solution` (concrete fix or avoidance strategy)
   - `tags` (1–4 `category:value` tags)
   - `priority` (1–10, where 10 = highest severity)
   - `confidence` (0.0–1.0)
   - `toolNames` / `commandPatterns` / `pathPatterns` as applicable
5. **Project-scope check** — for each kept candidate, check for project-specific signals:

   **Strong signals** (one fires → flag as project-scope candidate):
   - Problem or solution mentions a filename that exists in the current project (check with `ls` on relevant directories)
   - Problem or solution contains the current project's directory name or repo name
   - Describes a workflow unique to this codebase (hook testing procedures, plugin installation steps, scanner behavior, manifest format)

   **Medium signals** (two fire → flag):
   - Type is `protocol` with no `toolNames`/`commandPatterns`/`pathPatterns` AND describes a codebase-specific procedure rather than a general principle
   - Tags reference a narrow tool combination only relevant to this project (e.g. `tool:hooks + category:plugins`)
   - Problem text uses "this plugin", "this hook", "our manifest", or similar possessive framing

   If flagged: mark `scope:project-candidate` with the specific signal(s) that fired. Leave as `scope:global-confirmed` if no signals fire.

---

## Phase 4: Present Numbered List

Show a numbered list of the candidates to the user. For each **kept** candidate:

```
[N] <slug>  tool:<tool>  tags:<tag1,tag2>  priority:<p>  conf:<c>
    Problem:     <problem>
    Solution:    <solution>
    Triggers:    <toolNames/commandPatterns/pathPatterns if any>
    Scope:       GLOBAL  (or PROJECT-SCOPE? — <signal that fired>)
```

Use `PROJECT-SCOPE?` with the specific evidence (e.g. "mentions `hooks/session-start-scan.mjs` which exists in this project") so the user can make an informed decision. Use `GLOBAL` when no signals fired.

Below the kept candidates, add a section **"LLM pre-archived"** listing each candidate marked for archival with its reason.

---

## Phase 5: Parse User Response

Wait for the user to respond. Accept natural-language input using this grammar:

| Input                               | Meaning                                               |
| ----------------------------------- | ----------------------------------------------------- |
| `approve 1 3`                       | Promote items 1 and 3 as-is (scope stays as assessed) |
| `approve all`                       | Promote all kept candidates                           |
| `skip 2`                            | Leave item 2 as a candidate (no change)               |
| `archive 3 "reason"`                | Archive item 3 with the given reason                  |
| `edit 1 summary "New summary text"` | Patch field before promoting                          |
| `edit 1 priority 8`                 | Patch numeric field before promoting                  |
| `scope project 1`                   | Mark item 1 as project-scoped before promoting        |
| `scope global 1`                    | Explicitly keep item 1 global (override assessment)   |

Multiple instructions can appear in one message (one per line or comma-separated).
Items not mentioned are left as candidates (no action taken).

---

## Phase 6: Confirm Then Promote

Before writing anything, show a confirmation block:

```
Ready to apply:
  Promote: <ids of items being promoted, one per line with slug>
           (include scope annotation: [global] or [project: <project-id>])
  Archive: <id: reason for each item being archived>
  Patches: <field changes per item if any>

Confirm? (yes / cancel)
```

Wait for "yes" (or "y"). If the user says anything else, return to Phase 5.

On confirmation, apply scope patches first (for any project-scoped items), then promote:

```bash
# Apply scope for project-scoped items (one per flagged lesson)
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs edit --id <id> --patch '{"scope":"<project-id>"}' 2>/dev/null

# Promote all confirmed items
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs promote \
  --ids <id1>,<id2>,... \
  [--archive "id1:reason" --archive "id2:reason" ...] \
  [--patch '{"id1":{"summary":"...","priority":8},...}']
```

Run both steps.

---

## Phase 7: Report

Print the output from `promote` verbatim, then add a one-line summary:

```
Done — N promoted, M archived. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs build` if the manifest needs refreshing (promote does this automatically).
```

---

## Phase 8: QA Audit

Automatically continue into `/lessons:doctor` immediately after reporting. Do not ask — just run it.

Say: "Running QA audit…" and proceed with the full doctor workflow (pre-check through final report and fix prompts).
