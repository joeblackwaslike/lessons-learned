---
name: lessons:doctor
description: Audit the lessons DB for quality issues — dead triggers, misclassified types, truncated summaries, near-duplicates, over-broad guards, over-weighted clusters, and more. Reports findings and offers to fix them.
allowed-tools: ['Bash']
---

You are running `/lessons:doctor` — a QA audit of the lesson store.

The audit logic lives in the CLI's `auditLesson`/`auditStore` (the same code
`lessons doctor` runs directly). This command's job is to run that real audit,
present its findings clearly, and offer to fix them — it does not reimplement checks itself.
An earlier version of this file hand-rolled its own 10 ad-hoc checks in bash, which drifted from
the real CLI's checks (missing several: directive-with-toolNames, orphaned-scope, cluster
over-weighting, narrow global scope, similarity flooding, priority-homogeneity, and every
store-level check). Keep it that way — if a check needs adding, add it to `auditLesson`/
`auditStore` in the CLI script (with tests), not here.

Reference for what each check means and why: `website/docs/architecture/quality-checks.md`.

---

## Step 1: Pending candidates banner

Candidates aren't part of the active-lesson audit below (they're not injecting yet), but flag
them first so they aren't mistaken for a clean store:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs scan aggregate 2>/dev/null
```

If `totalCandidates` > 0, show this banner before anything else:

> ⚠ **N candidate lesson(s) are waiting for review.**
> These lessons have been scanned but not yet promoted — they are not currently injecting.
> Run `/lessons:review` to filter, scope, and promote them.
> Continuing audit of active lessons only.

## Step 2: Run the real audit

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs doctor --json
```

This returns `{ "lessons": [{ "slug": "...", "issues": ["..."] }], "store": ["..."] }` — `store`
is store-level warnings (patterns across the whole active set); `lessons` is per-lesson issues.
An empty result on both means the store is clean — report that plainly and stop; skip the
mechanical-fix pass below.

Cross-reference each issue message against the CLI's `auditLesson`/`auditStore`
(or `quality-checks.md`) if you need to understand _why_ a check fires — the strings below are
illustrative, not exhaustive, since the real check set evolves independently of this file.

## Step 3: Present the report

Summarize before proposing fixes. Group store-level warnings separately from per-lesson issues,
and within per-lesson issues, group by which check fired so patterns are visible at a glance
(e.g. "3 lessons have a summary over 80 chars" reads better than three disconnected bullets).

| Category             | Found      |
| -------------------- | ---------- |
| Store-level warnings | N          |
| Lessons with issues  | N of TOTAL |

Then list each, lesson slug + its issue message(s) verbatim from the JSON.

## Step 4: Propose fixes

For each finding, read the issue message and propose the smallest correct patch via:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs edit --id <id> --patch '<json>'
```

Most issue messages are self-describing enough to derive the fix directly (e.g. "summary too
long (96 chars, max 80)" → tighten the summary; "missing toolNames — lesson can never fire" →
add the correct `toolNames`). Use judgment the way you would reviewing a PR comment — some are
purely mechanical (truncate a string, add a `commandMatchTarget: "executable"`), others need a
real decision (which of two near-duplicate lessons to archive, whether a flagged tool/lang-tagged
directive should actually be scoped or whether it turned out to generalize). For the latter,
show your reasoning and the current value before patching, same as `/lessons:manage`.

**Store-level warnings needing judgment, not a single-lesson patch:**

- `similarity flooding` / `cluster over-weighting`: identify which lesson in the pair/cluster is
  weaker (shorter solution, lower confidence, fewer `sourceSessionIds`) and propose archiving it
  via `promote --archive "<id>:reason"`, or differentiating the survivors' summaries if they're
  genuinely distinct enough to keep.
- `uncovered-tools` / `tool-concentration` / `blanket-bash` / `untagged-majority`: these describe
  a gap in the corpus, not a bug in an existing lesson — surface them as backlog items (a `bd`
  ticket) rather than an `edit` patch, unless the fix is obviously a single lesson's missing tag.

Ask once, after presenting the full report:

> "Apply all high-confidence mechanical fixes automatically, review judgment calls interactively,
> or handle everything manually?"

After applying any fixes, rebuild and re-verify:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs build
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs doctor
```

Confirm the fixed findings are gone and report the new clean/remaining count.

Mention at the end: "Run `/lessons:scope` to find lessons that should only inject in the current
project."
