---
name: lessons:help
description: Print the full command and configuration reference for the lessons-learned plugin — slash commands with descriptions, all config options with current values, and what's been added recently.
allowed-tools: ['Bash']
---

# lessons:help

You are running `/lessons:help`. Produce a single self-contained reference output. No follow-up questions.

---

## Step 1: Gather data

Run all three queries in parallel:

```bash
# 1. Extract name + description from every command file
node -e "
const fs = require('fs'), path = require('path');
const dir = 'commands/lessons';
const out = [];
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) continue;
  const name = (fm[1].match(/^name:\s*(.+)$/m)||[])[1]?.trim();
  const desc = (fm[1].match(/^description:\s*['\"]?(.*?)['\"]?\s*$/m)||[])[1]?.trim();
  if (name) out.push({ file: f, name, desc: desc ?? '' });
}
console.log(JSON.stringify(out, null, 2));
"
```

```bash
# 2. Current config values
cat data/config.json
```

```bash
# 3. Files in commands/lessons/ added or modified in the last 21 days
git log --since="21 days ago" --name-status --pretty=format: -- 'commands/lessons/*.md' | grep -E '^[AM]' | awk '{print $1, $2}' | sort -u
```

---

## Step 2: Render the reference

Use the gathered data to produce output in this exact format. Fill in real values — do not leave placeholders.

```
lessons-learned  ·  slash command & config reference
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SLASH COMMANDS
──────────────────────────────────────────────────────────────────
  /lessons:add      <description from frontmatter>
  /lessons:review   <description>
  /lessons:manage   <description>
  /lessons:config   <description>
  /lessons:doctor   <description>          ← NEW  (if added/modified in last 21d)
  /lessons:cancel   <description>          ← NEW
  /lessons:scope    <description>          ← NEW
  /lessons:help     Print this reference
──────────────────────────────────────────────────────────────────
Commands are in commands/lessons/. Run any command to get started.


CONFIGURATION  (data/config.json)
──────────────────────────────────────────────────────────────────
  Injection
    injectionBudgetBytes        <value>    Max bytes of lesson text per tool call
    maxLessonsPerInjection      <value>    Hard cap on lessons injected at once
    minConfidence               <value>    Lessons below this score are never injected
    minPriority                 <value>    Lessons below this priority excluded entirely
    compactionReinjectionThreshold <value> Priority threshold for re-injection after compaction

  Scanning
    scanPaths                   <value>    Directories searched for session JSONL files
    autoScanIntervalHours       <value>    Hours between automatic background scans
    maxCandidatesPerScan        <value>    Max new candidates saved per scan run

  Scoring bonuses (applied to candidate priority at scan time)
    multiSessionBonus           <value>    Seen in 2+ sessions
    multiProjectBonus           <value>    Seen in 2+ projects
    hangTimeoutBonus            <value>    Hang/timeout failure pattern
    userCorrectionBonus         <value>    Explicit user correction
    singleOccurrencePenalty     <value>    Only seen once (negative)
──────────────────────────────────────────────────────────────────
Run /lessons:config to view explanations or change any value.


WHAT'S NEW  (last 21 days)
──────────────────────────────────────────────────────────────────
<For each file from the git query, derive the command name and write one line:>
  /lessons:doctor   Added — QA audit for dead triggers, casing, near-dupes, summaries
  /lessons:cancel   Added — Retract a #lesson tag (DB archive or #lesson:cancel marker)
  /lessons:scope    Added — Project-specific lesson detection and scoping
  /lessons:review   Updated — scope detection integrated into Phase 3 at review time
  /lessons:doctor   Updated — pending candidate count shown before audit

<If no files match the git query, write: "  Nothing new in the last 21 days.">
──────────────────────────────────────────────────────────────────


QUICK RECIPES
──────────────────────────────────────────────────────────────────
  Weekly routine        /lessons:review
  After bulk edits      /lessons:doctor
  Retract a lesson      /lessons:cancel
  First time setup      /lessons:config  then  /lessons:review
  Scope cleanup         /lessons:scope   (or happens automatically in /lessons:review)
──────────────────────────────────────────────────────────────────
```

Rules for the "WHAT'S NEW" section:
- Only include commands whose file appears in the `git log` output (status A or M)
- For each file, map it to the command name from the frontmatter
- Keep descriptions tight — one clause each, action-first
- If a file was modified (M), use "Updated —"; if added (A), use "Added —"
- Sort: Added entries first, then Updated

Rules for ← NEW markers in the command list:
- Add `← NEW` to any command whose file was added (git status A) in the last 21 days
- Do not add it to modified-only files

Do not show this output in a code block — render it as plain preformatted text so it reads clearly.
