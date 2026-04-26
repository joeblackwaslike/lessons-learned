---
name: lessons:scope
description: Scan active global lessons for ones that appear project-specific — mentions project files, tools, or workflows unique to the current codebase — and offer to scope them to the current project only. Primarily useful for manually-added lessons (via /lessons:add or edit) since /lessons:review now performs scope detection at promotion time for scanned candidates.
allowed-tools: ['Bash']
---

# lessons:scope

You are running `/lessons:scope` — a scan to find global lessons that should be scoped to the current project.

---

## How project scoping works

A scoped lesson (`scope: "<project-id>"`) only injects when the hook's `cwd` matches the project where the lesson originated. Global lessons (`scope: null`) inject everywhere.

**The test**: would this lesson be confusing or irrelevant in an unrelated project (a Python API, a React app, a data pipeline)? If yes — it's a project-scope candidate.

**Project ID** is derived from `cwd` at inject time:

```js
cwd.replace(/\//g, '-').replace(/^-/, '');
// /Users/joe/github/foo/bar → Users-joe-github-foo-bar
```

---

## Step 1: Derive the current project ID

```bash
pwd | node -e "
const cwd = require('fs').readFileSync('/dev/stdin','utf8').trim();
console.log(cwd.replace(/\//g, '-').replace(/^-/, ''));
"
```

---

## Step 2: Load active global lessons

```bash
node /Users/joeblack/github/joeblackwaslike/lessons-learned/scripts/lessons.mjs list --json | node -e "
const l = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const globals = l.filter(x => x.status === 'active' && !x.scope);
console.log(JSON.stringify(globals, null, 2));
" 2>/dev/null
```

---

## Step 3: Identify project-specific candidates

For each lesson, score it against these signals. A lesson is a candidate if it hits **any strong signal** or **two or more medium signals**.

### Strong signals (one is enough)

1. **Project file reference** — `problem` or `solution` mentions a filename that exists in the current project (check with `ls` for `.mjs`, `.json`, `.md` filenames found in the text)
2. **Project name reference** — `problem` or `solution` contains the current project's directory name or repo name
3. **This-codebase workflow** — describes a specific test, deploy, or development procedure that only makes sense for this project (e.g. "hook testing", "plugin installation", "running the scanner")

### Medium signals (two needed)

1. **Protocol with no triggers + highly specific content** — `type: "protocol"` + no `toolNames`/`commandPatterns`/`pathPatterns` + describes a very specific procedure (not a general principle)
2. **Narrow tool combination** — tags reference a very specific tool combination (e.g. `tool:hooks + category:plugins`) that only applies to plugin development projects
3. **"Only applies here" framing** — problem description uses phrases like "this plugin", "this hook", "this project", "our manifest"

### Not a candidate (keep global)

- General language gotchas (bash, Python, JS edge cases)
- Security principles (eval injection, secrets in code, etc.)
- Universal git behavior (stash, commit signing, rebase conflicts)
- General Claude Code agent behavior (planning, context management, subagent limits) — these apply across all projects
- Node.js runtime gotchas (child.unref, deprecation warnings) — applicable anywhere Node is used

---

## Step 4: Scan project structure for reference matching

For each candidate with suspected file references, check whether the referenced file exists:

```bash
ls hooks/ scripts/ core/ 2>/dev/null | grep -i "<filename>"
```

---

## Step 5: Present candidates for approval

For each candidate found, present one at a time:

```text
─── Candidate N ──────────────────────────────────────────────────────
Slug:    <slug>
Type:    <type>
Summary: <summary>
Problem: <first 120 chars of problem>

Why project-specific:
  • <signal 1 with specific evidence>
  • <signal 2 if applicable>

Proposed action: scope to <project-id>
Apply? [y/n/edit]
─────────────────────────────────────────────────────────────────────
```

For **n (skip)**: note the reason and continue.
For **y (apply)**: apply immediately before moving to the next candidate.
For **edit**: ask what they'd like to change (the lesson text, tags, or decision).

---

## Step 6: Apply approved scoping

For each approved candidate:

```bash
node /Users/joeblack/github/joeblackwaslike/lessons-learned/scripts/lessons.mjs edit --id <id> --patch '{"scope":"<project-id>"}'
```

The `edit` command auto-rebuilds the manifest after each patch.

---

## Step 7: Summary report

After all candidates are reviewed:

```text
Scope scan complete.
  Scoped:   N lessons → <project-id>
  Skipped:  N lessons (kept global)
  No change needed: N lessons
```

If any lessons were scoped, confirm the manifest was rebuilt (the `edit` command does this automatically).
