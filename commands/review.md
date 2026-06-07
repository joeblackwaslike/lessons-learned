---
name: lessons:review
description: Review scan candidates interactively — one at a time, with suggested edits and a decision question per candidate
allowed-tools: ['Bash', 'Read', 'AskUserQuestion']
---

You are running the `/lessons:review` workflow. Work through every phase below in order.

---

## Phase 1: Scan

Run an incremental scan to pick up any new candidates from recent session logs:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs scan
```

Report the number of bytes scanned and how many new candidates were saved to the DB.

---

## Phase 2: Aggregate

Pull all current candidates from the DB:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs scan aggregate
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs list
pwd | node -e "const c=require('fs').readFileSync('/dev/stdin','utf8').trim(); console.log(c.replace(/\//g,'-').replace(/^-/,''));"
```

Parse the JSON. If `totalCandidates` is 0, tell the user "No candidates found — nothing to review." and stop.

Save the full candidate list and the active lesson list and current project ID for use in Phase 3.

---

## Phase 3: One-at-a-time interactive review

Process candidates one at a time. For each candidate:

### 3a. Pre-filter silently (no output)

Apply these filters before displaying. If any match, skip to **3e (archive)** immediately without asking:

- **Exact duplicate** — `contentHash` appears in an active lesson
- **Near-duplicate** — Jaccard similarity of `problem` vs. any active lesson ≥ 0.5 and candidate adds nothing new
- **Hallucinated** — describes a tool behavior that is demonstrably false (e.g. "Read tool has a consecutive read counter", "tool resets after N reads")

### 3b. Prepare suggested edits

For every kept candidate, prepare the following before displaying:

| Field                | How to generate                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `summary`            | ≤80 chars, present-tense, imperative. Must describe the problem clearly to someone who hasn't seen the context.                                                                                                                                         |
| `type`               | `hint` (informational), `guard` (blocks destructive action), `protocol` (session-start once), `directive` (session-start always)                                                                                                                        |
| `toolNames`          | **Required.** Use exact casing: `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Agent`, `TodoWrite`, `WebFetch`, `WebSearch`. "TypeScript", "SQL", "Git", "npm", "curl", "Vercel" are NOT valid — map them to `Bash`, `Edit`, `Write` as appropriate. |
| `commandPatterns`    | Regex array for Bash commands. Use `\\b` for word boundaries and `\\` before `\|` for a literal pipe. Escape backslashes for JSON.                                                                                                                      |
| `pathPatterns`       | Glob array for file paths. Use `**/*pattern*` for anywhere in tree.                                                                                                                                                                                     |
| `commandMatchTarget` | Set `"executable"` only for guards where trigger words may appear inside `--patch` JSON args.                                                                                                                                                           |
| `scope`              | Global (null) by default. Set to `Users-joe-github-joeblackwaslike-<repo>` for project-specific lessons. Always strip leading `-` from computed paths.                                                                                                  |
| `tags`               | 1–4 `category:value` tags. Use `tool:X`, `severity:X`, `platform:X`, `workflow:X`, `library:X` namespaces. Drop `scan:*` and `candidate_type:*` tags.                                                                                                   |
| `priority`           | 1–10. Default 5. Bump to 7–8 for data-loss/security/silent-failure. Bump to 9–10 for destructive guards.                                                                                                                                                |

**Trigger analysis:**

- A lesson with `toolNames` but no `commandPatterns`/`pathPatterns` fires on _every_ call to that tool — only acceptable for rare tools or when scoped
- Guards must have precise `commandPatterns` to avoid blocking unrelated commands
- If no clean trigger exists, suggest archiving rather than forcing a noisy lesson

**Scope detection signals:**

- Problem/solution mentions a specific filename that exists in the current project → project-scoped
- Describes a workflow unique to this codebase → project-scoped
- References a specific library only used in one known project (e.g. snoowrap → ai-listings) → project-scoped

### 3c. Display the candidate

Use this exact format:

```text
**Candidate N/Total** — `slug`

| Field | Value |
|---|---|
| **Tool** | (raw tool value from candidate) |
| **Confidence** | (value) |
| **Problem** | (problem text) |
| **Solution** | (solution text) |
| **Tags** | (original tags) |

**Suggested edits:**
- **summary**: `"<suggested summary>"`
- **type**: `<type>`
- **toolNames**: `[<list>]`
- **commandPatterns**: `[<list>]` _(if applicable)_
- **pathPatterns**: `[<list>]` _(if applicable)_
- **scope**: `<scope or "global">` _(if project-specific)_
- **tags**: `[<cleaned tags>]`
- **priority**: <N>

**My take:** <one or two sentences explaining why these edits, or why you'd archive it>
```

Only show fields that apply. If no `commandPatterns` or `pathPatterns`, omit those rows.

### 3d. Ask one decision question

Use `AskUserQuestion` with this structure:

```
question: "Candidate N: <short 5-10 word description of what it's about> — promote or archive?"
header: "Decision"
options:
  - label: "Promote with my edits (Recommended)"
    description: "Apply the suggested edits then promote to active"
  - label: "Archive"
    description: "<your reason for why archiving is valid>"
  - label: "Modify before promoting"
    description: "You want to change something about the suggested edits first"
  - label: "Skip (leave as candidate)"
    description: "Come back to this one later"
```

Adjust option order if you'd recommend archiving — put the recommended option first.

### 3e. Apply decision immediately

**Promote with edits:**

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs edit --id <id> --patch '<json of all suggested edits>'
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs promote --ids <id>
```

**Archive:**

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs promote --archive "<id>:<reason>"
```

**Modify before promoting:** Ask a follow-up question to clarify the change, apply the edit, then promote.

**Skip:** Do nothing. Note it in the session summary.

After applying, output one line: `✓ [promoted|archived|skipped] (N active lessons total)`

Then immediately move to the next candidate.

---

## Phase 4: Session Summary

After all candidates are processed, print:

```
**Review complete**
- Promoted: N
- Archived: M
- Skipped: K
- Active lessons: <final count from last manifest build>
```

---

## Phase 5: QA Audit

Automatically run `/lessons:doctor` immediately after the summary. Do not ask — just run it. Say "Running QA audit…" and proceed.
