---
name: lessons:add
description: Interactively add a new lesson to the store through a short conversation
allowed-tools: ['Bash']
---

You are running the `/lessons:add` workflow. Guide the user through adding a lesson in a short conversational sequence. Do not ask all questions at once — ask one (or at most two closely related) at a time and wait for each answer before proceeding.

Keep your questions brief and concrete. Use examples where helpful.

---

## Step 1 — Anchor: what went wrong?

Ask:

> What went wrong? Describe the mistake — what happened and why it was a problem.
> (Be specific: the more concrete, the better the lesson will match future situations.)

Wait for the answer. Store it as `mistake`.

---

## Step 2 — Remediation

Ask:

> What's the fix or the right approach to avoid this next time?

Wait for the answer. Store it as `remediation`.

---

## Step 3 — Trigger

Ask:

> What triggers this lesson? This controls when it gets injected.
> Options:
>
> - A shell command or prefix (e.g. `git stash`, `npm install`)
> - A tool name (e.g. `Bash`, `Edit`, `Write`)
> - A file path pattern (e.g. `**/package.json`, `src/**/*.ts`)
> - Session start (inject once at the top of every session)
> - Skip — leave untriggered for now

Wait for the answer. Map it:

- Shell command/prefix → `trigger` field (CLI will convert to `commandPatterns`)
- Tool name(s) → `tool` field (comma-separated if multiple)
- Path pattern(s) → `pathPatterns` array
- Session start → `sessionStart: true`
- Skip → omit trigger fields entirely

---

## Step 4 — Summary

Based on the mistake text, generate a concise one-line summary (≤ 80 chars, present tense, no trailing ellipsis).

Present it:

> Here's a suggested summary:
> **"<generated summary>"**
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

## Step 6 — Confirm and write

Show a compact confirmation:

```
Ready to add:
  Summary:     <summary>
  Mistake:     <first line of mistake, truncated to ~80 chars>
  Remediation: <first line of remediation, truncated to ~80 chars>
  Trigger:     <description of what was set, or "none">
  Tags:        <tags or "none">
  Priority:    <priority>

Add this lesson? (yes / edit / cancel)
```

- **yes** — proceed to write
- **edit** — ask which field to change, apply it, re-show the confirmation
- **cancel** — stop, nothing written

On "yes", build the JSON and run:

```bash
node scripts/lessons.mjs add --json '<json>'
```

Where `<json>` is a single-line JSON object with all collected fields.

Print the output from the command verbatim. If it fails validation, show the error clearly and ask the user to correct the offending field before retrying.
