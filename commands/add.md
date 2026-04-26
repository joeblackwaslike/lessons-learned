---
name: lessons:add
description: Interactively add a new lesson to the store through a short conversation
allowed-tools: ['Bash']
---

You are running the `/lessons:add` workflow. Guide the user through adding a lesson in a short conversational sequence. Do not ask all questions at once — ask one (or at most two closely related) at a time and wait for each answer before proceeding.

Keep your questions brief and concrete. Use examples where helpful.

---

## Step 1 — Type

Ask the user to choose the lesson type. Explain each option clearly so they know exactly which to pick:

> What kind of lesson is this?
>
> - **hint** — Advisory context injected before a matching tool call or file operation. Use this for most lessons: pitfalls to watch for, gotchas, things to double-check.
> - **guard** — Blocks a tool call entirely and tells you what to do instead. Use this when the command is almost always wrong and needs to be stopped before it runs (e.g. a pytest flag that hangs the process).
> - **protocol** — A reasoning reminder injected once at session start. Use this for procedural checklists, mental models, or workflow reminders (not tied to a specific command).
> - **directive** — A high-authority coding principle injected at session start. Use this for hard rules about how code should be written (e.g. SOLID, YAGNI). Manually reviewed only.

Wait for the answer. Store as `type`. Default to `hint` if unclear.

---

## Step 2 — Core content

Questions vary by type:

**For `hint` or `guard`:**

Ask:

> What went wrong? Describe the problem — what happened and why it was a problem.
> (Be specific: the more concrete, the better the lesson will match future situations.)

Wait for the answer. Store as `problem`.

Then ask:

> What's the fix or the right approach to avoid this next time?

For `guard`, prompt: "Include a specific rerun command or corrective action if applicable."

Wait for the answer. Store as `solution`.

**For `protocol`:**

Ask:

> Describe the reasoning procedure or checklist. What should be done, and why does it matter?

Wait for the answer. Use the response to populate both `problem` (why it matters / what goes wrong without it) and `solution` (the procedure itself). Ask a follow-up if the split isn't clear.

**For `directive`:**

Ask:

> State the principle as a Problem/Solution pair:
>
> - **Problem**: What goes wrong without this principle?
> - **Solution**: What should be done instead?

Wait for the answer. Map Problem → `problem`, Solution → `solution`.

---

## Step 3 — Trigger

Skip this step entirely for `directive` and `protocol` (they fire at session start, no trigger needed).

For `hint` and `guard`, ask:

> What triggers this lesson? This controls when it gets injected.
> Options:
>
> - A shell command or prefix (e.g. `git stash`, `npm install`, `pytest`)
> - A tool name (e.g. `Bash`, `Edit`, `Write`)
> - A file path pattern (e.g. `**/package.json`, `src/**/*.ts`)
> - Skip — leave untriggered for now

Wait for the answer. Map it:

- Shell command/prefix → `trigger` field (CLI will convert to `commandPatterns`)
- Tool name(s) → `tool` field (comma-separated if multiple)
- Path pattern(s) → `pathPatterns` array
- Skip → omit trigger fields entirely

---

## Step 4 — Summary

Based on the problem text, generate a concise one-line summary (≤ 80 chars, present tense, no trailing ellipsis).

Present it:

> Here's a suggested summary:
> **"[generated summary]"**
> Accept this, or type a replacement.

If the user accepts (or says "ok", "good", "yes", "looks good"), use the generated summary.
Otherwise use what they provide. Store as `summary`.

---

## Step 5 — Tags and priority (combined)

Ask once:

> Optional: any tags? (e.g. `tool:git`, `severity:data-loss`, `category:testing`)
> And priority 1–10? (default 5 — higher = more severe)
> You can skip both with "skip" or "no".

Parse their answer:

- Tags: extract any `word:word` patterns or comma-separated tag strings → `tags` array
- Priority: extract any number 1–10 → `priority`
- If skipped or omitted, use defaults (`tags: []`, `priority: 5`)

---

## Step 6 — Quality scan

Before showing the confirmation, review the collected fields and surface any issues as suggestions:

- Summary over 80 chars or under 20 chars
- Vague or generic `problem` text (e.g. "something went wrong")
- `solution` that doesn't give actionable guidance
- Type mismatch: session-start trigger with `hint`/`guard` type; blocking intent with `hint` type
- Missing obvious tags (e.g. a `git` lesson with no `tool:git` tag; a Python lesson with no `lang:python` tag)
- Tags that don't follow `category:value` convention
- Anything that reads more naturally as a different type

Present findings as:

> **Suggestions before confirming:**
>
> - [suggestion 1]
> - [suggestion 2]
>   Accept as-is, or tell me what to change.

If no issues found, skip this step and go straight to Step 7.

---

## Step 7 — Confirm and write

Show a compact confirmation:

```text
Ready to add:
  Type:        <type>
  Summary:     <summary>
  Problem:     <first line of problem, truncated to ~80 chars>
  Solution:    <first line of solution, truncated to ~80 chars>
  Trigger:     <description of what was set, or "none (session-start)" for protocol/directive>
  Tags:        <tags or "none">
  Priority:    <priority>

Add this lesson? (yes / edit / cancel)
```

- **yes** — proceed to write
- **edit** — ask which field to change, apply it, re-show the confirmation
- **cancel** — stop, nothing written

On "yes", build the JSON and run:

```bash
node /Users/joeblack/github/joeblackwaslike/lessons-learned/scripts/lessons.mjs add --json '<json>'
```

Where `<json>` is a single-line JSON object with all collected fields, including `type`.

Print the output from the command verbatim. If it fails validation, show the error clearly and ask the user to correct the offending field before retrying.
