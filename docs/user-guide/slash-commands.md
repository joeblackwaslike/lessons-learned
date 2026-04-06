# Slash Commands

Four slash commands give you a conversational interface to the lessons-learned plugin from within any Claude Code session.

---

## /lessons:add

Add a new lesson through a short guided conversation. Takes about two minutes.

### What Claude asks

1. **What went wrong?** — Describe the mistake and why it happens. This becomes the `mistake` field.
2. **How do you fix it?** — The concrete remedy: commands, flags, code. This becomes `remediation`.
3. **What triggers this?** — A command string, file pattern, or tool name. Claude converts it to the right trigger type.
4. **One-line summary?** — A short description (max 120 chars) for the manifest index.
5. **Tags and priority?** _(optional)_ — Category tags and priority 1–10. Claude suggests defaults.

After answering, Claude writes the lesson to `data/lessons.db`, validates it, and rebuilds the manifest automatically.

### Example session

```
You: /lessons:add

Claude: What went wrong? Describe the mistake.

You: When I run git stash without -u, untracked files get left behind silently.
     I didn't notice until the branch was already cleaned up.

Claude: What's the fix?

You: Always use git stash -u (or --include-untracked). Never bare git stash.

Claude: What command or pattern should trigger this warning?

You: git stash — but only when -u isn't already present.

Claude: One-line summary for the lesson index?

You: git stash silently drops untracked files without -u

Claude: Tags? (or press Enter to skip)

You: tool:git, severity:data-loss

Claude: Priority 1–10? (default: 7 for data-loss)

You: 9

Claude: ✓ Lesson written. Manifest rebuilt.
```

### CLI equivalent

```bash
node scripts/lessons.mjs add
```

Or inline with JSON:

```bash
node scripts/lessons.mjs add --json '{
  "summary": "git stash silently drops untracked files without -u",
  "mistake": "git stash only stashes tracked modified files — untracked files are silently left behind",
  "remediation": "Use git stash -u (--include-untracked) to include untracked files",
  "trigger": "git stash",
  "tags": ["tool:git", "severity:data-loss"],
  "priority": 9
}'
```

---

## /lessons:review

Review what the background scanner found and decide what to keep.

The scanner runs automatically on session startup and writes candidates to the database. `/lessons:review` walks you through them.

### Candidate types

**Tier 1 (structured)** — Claude emitted a `#lesson` tag during a session. These are high-fidelity and pass validation automatically. Claude shows you the candidate and asks to confirm or skip.

**Tier 2 (heuristic)** — The scanner detected an error→correction sequence but Claude didn't tag it. Noisier. Claude shows the raw context and asks you to confirm the mistake, fix, and trigger pattern before promoting.

### Review workflow

```
You: /lessons:review

Claude: Found 3 candidates.

--- Candidate 1 (Tier 1) ---
Mistake: npm link sets a symlink that breaks peer dependency resolution...
Fix: Use npm pack + npm install ./path instead of npm link
Tags: tool:npm, severity:peer-deps
Priority: 7 (suggested)

Promote this lesson? [yes / skip / edit priority]

You: yes

--- Candidate 2 (Tier 2) ---
Session: jobsearch-tracker (2026-04-01)
Error: Error: ECONNREFUSED 127.0.0.1:9222
Next message: "Let me restart Chrome with --remote-debugging-port..."

What was the root mistake? (or 'skip')

You: The Chrome DevTools endpoint wasn't running because Chrome wasn't started
     with remote debugging enabled.

Claude: Remediation?

You: Start Chrome with --remote-debugging-port=9222 before connecting via CDP

Claude: Trigger command or path?

You: chrome|chromium|puppeteer

Claude: ✓ Promoted. 1 more candidate.
```

### CLI equivalent

```bash
node scripts/lessons.mjs review          # interactive review
node scripts/lessons.mjs scan            # run the scanner manually
node scripts/lessons.mjs scan candidates # show cross-project patterns
node scripts/lessons.mjs scan promote 2  # promote candidate #2
```

---

## /lessons:manage

Browse and manage all lessons — active, archived, and candidates — from a conversational interface.

### What you can do

| Action              | Example phrase                                     |
| ------------------- | -------------------------------------------------- |
| List active lessons | "show active" / "list lessons"                     |
| Search by keyword   | "find lessons about pytest"                        |
| Edit a field        | "set priority on pytest-tty-hanging to 9"          |
| Archive a lesson    | "archive git-stash-untracked — no longer relevant" |
| Restore archived    | "restore git-stash-untracked"                      |
| Show candidates     | "show pending candidates"                          |
| Show by tag         | "show lessons tagged severity:data-loss"           |

### Example session

```
You: /lessons:manage

Claude: What would you like to do?

You: show active

Claude: 32 active lessons across 8 categories.

  #  slug                           priority  tags
  1  pytest-tty-hanging-k9m2             8  lang:python, tool:pytest, severity:hang
  2  git-stash-untracked-5x3q            9  tool:git, severity:data-loss
  3  npm-link-peer-deps-8m1k             7  tool:npm
  ...

You: edit priority on pytest-tty-hanging to 9

Claude: Updated. Manifest rebuilt.

You: archive npm-link-peer-deps — resolved in npm 10

Claude: Archived with reason "resolved in npm 10". It will no longer inject.
```

### CLI equivalent

```bash
node scripts/lessons.mjs list                              # formatted table
node scripts/lessons.mjs list --json                       # JSON array
node scripts/lessons.mjs edit --id <id> --patch '{"priority": 9}'
node scripts/lessons.mjs promote --archive "<id>:reason"
node scripts/lessons.mjs restore --ids <id>
```

---

## /lessons:config

View and edit injection settings with explanations of what each setting does.

### Example session

```
You: /lessons:config

Claude: Current configuration:

  injectionBudgetBytes: 4096         Max bytes injected per tool call
  maxLessonsPerInjection: 3          Max lessons per tool call
  minConfidence: 0.5                 Exclude lessons below this
  minPriority: 1                     Exclude lessons below this
  compactionReinjectionThreshold: 7  Re-inject after compaction above this priority

What would you like to change?

You: set maxLessonsPerInjection to 2

Claude: Updated. The hook will inject at most 2 lessons per tool call.
        Note: manifest rebuild not needed — config is read at hook time.

You: what does compactionReinjectionThreshold do?

Claude: When Claude Code compacts the conversation (its /compact command),
        the dedup state is cleared for all lessons with priority ≥ this value.
        This means high-priority lessons re-inject in the new context window
        even if they already fired earlier in the session. Set lower to re-inject
        more lessons; set higher (up to 10) to only re-inject the most critical ones.
```

### CLI equivalent

```bash
node scripts/lessons.mjs config          # show all settings
node scripts/lessons.mjs config set maxLessonsPerInjection 2
```

### All config fields

| Field                            | Default | Description                                            |
| -------------------------------- | ------- | ------------------------------------------------------ |
| `injectionBudgetBytes`           | 4096    | Max total bytes of context injected per tool call      |
| `maxLessonsPerInjection`         | 3       | Max number of lessons injected per tool call           |
| `minConfidence`                  | 0.5     | Lessons below this are excluded from the manifest      |
| `minPriority`                    | 1       | Lessons below this are excluded from the manifest      |
| `compactionReinjectionThreshold` | 7       | Lessons above this priority re-inject after `/compact` |

See [Configuration](configuration.md) for the full reference including scan and scoring settings.
