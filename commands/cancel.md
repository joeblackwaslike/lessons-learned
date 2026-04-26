---
name: lessons:cancel
description: Retroactively cancel a lesson tag you just emitted — prevents it from being promoted or removes it if already active. Works for lessons in the DB (any status) and for lessons emitted this session but not yet scanned.
allowed-tools: ['Bash']
---

You are running `/lessons:cancel` — a tool for retracting lesson tags after the fact.

---

## How lesson cancellation works

When Claude emits a `#lesson` block, it lands in the session JSONL file. The background scan at the **next** session start picks it up and stores it as a `candidate`. From there it can be promoted to `active` during `/lessons:review`.

Cancellation has two paths depending on timing:

**Already in DB** (scanned, any status): Archive it directly. It will no longer inject and cannot be promoted.

**Not yet scanned** (emitted this session, scan hasn't fired): Emit a `#lesson:cancel` block in this response. The scanner recognizes this format and skips the matching lesson when it processes the file, so it never enters the DB.

---

## Step 1: Find recent lessons

Run both queries in parallel — one for DB records, one for unscanned tags in the current session file.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs list --json | node -e "
const l = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
const recent = l.filter(x => x.createdAt >= cutoff)
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
console.log(JSON.stringify(recent.map((x, i) => ({
  n: i + 1,
  id: x.id,
  slug: x.slug,
  status: x.status,
  source: x.source,
  summary: x.summary,
  problemPrefix: x.problem.substring(0, 80),
  createdAt: x.createdAt,
})), null, 2));
"
```

Then find unscanned lessons in the current session file (if SESSION_ID is available in the environment):

```bash
node -e "
const { homedir } = require('os');
const { join } = require('path');
const { readdirSync, readFileSync } = require('fs');

// Find session files modified in the last hour
const projectsDir = join(homedir(), '.claude', 'projects');
let recent = [];
try {
  for (const proj of readdirSync(projectsDir)) {
    const projDir = join(projectsDir, proj);
    try {
      for (const f of readdirSync(projDir)) {
        if (!f.endsWith('.jsonl')) continue;
        const path = join(projDir, f);
        const stat = require('fs').statSync(path);
        if (Date.now() - stat.mtimeMs < 3600_000) recent.push({ path, mtime: stat.mtimeMs });
      }
    } catch {}
  }
} catch {}

recent.sort((a, b) => b.mtime - a.mtime);
const sessionFile = recent[0]?.path;
if (!sessionFile) { console.log(JSON.stringify([])); process.exit(0); }

const lines = readFileSync(sessionFile, 'utf8').split('\n').filter(Boolean);
const tags = [];

for (const line of lines) {
  if (!line.includes('#lesson') || line.includes('#lesson:cancel')) continue;
  let obj;
  try { obj = JSON.parse(line); } catch { continue; }
  if (obj.type !== 'assistant') continue;
  const blocks = obj.message?.content ?? [];
  for (const block of blocks) {
    if (block.type !== 'text') continue;
    const re = /#lesson\s*\n([\s\S]*?)#\/lesson/g;
    let m;
    while ((m = re.exec(block.text)) !== null) {
      const fields = {};
      for (const l of m[1].split('\n')) {
        const p = l.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/);
        if (p) fields[p[1].toLowerCase()] = p[2];
      }
      if (fields.problem) tags.push({
        source: 'session-unscanned',
        problemPrefix: fields.problem.substring(0, 80),
        problem: fields.problem,
        summary: fields.problem.substring(0, 60),
        sessionFile,
      });
    }
  }
}
console.log(JSON.stringify(tags, null, 2));
"
```

---

## Step 2: Present the list

Combine both result sets and show a numbered list. Label each entry clearly:

- `[DB:candidate]` — in DB, not yet promoted
- `[DB:active]` — in DB, currently injecting
- `[DB:archived]` — already archived (no action needed)
- `[session:unscanned]` — emitted this session, not yet in DB

Format:

```
N. [STATUS] <slug or problem prefix>
   Summary: <summary>
   Problem: <first 80 chars>
   Created: <date>
```

If no lessons found in either source, say so and exit.

---

## Step 3: Ask which to cancel

Ask the user: **"Which lessons would you like to cancel? (Enter numbers, e.g. 1 3 5, or 'all')"**

Wait for their response before proceeding.

---

## Step 4: Apply cancellations

For each selected lesson:

### DB records (status = candidate, active, reviewed)

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs edit --id <id> --patch '{"status":"archived","archiveReason":"user-cancelled via /lessons:cancel"}'
```

After archiving any active lessons, rebuild the manifest:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs build
```

### Session-unscanned lessons

For each unscanned lesson being cancelled, emit a `#lesson:cancel` block in your response. The scanner will match against the problem prefix and skip the lesson when it next processes this session file.

The cancel block format — include this literally in your text output (NOT in a code block, so it's part of the raw response that gets scanned):

```
#lesson:cancel
problem: <first 60 chars of the problem field, verbatim>
#/lesson:cancel
```

Emit one block per unscanned lesson being cancelled.

---

## Step 5: Confirm

Report what was done:

- N DB records archived (list slugs)
- N session-unscanned lessons cancelled via `#lesson:cancel` markers
- Manifest rebuilt: yes/no

If the user wants to verify, suggest: `node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs list --json | node -e "const l=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(l.filter(x=>x.status==='archived').slice(-5).map(x=>x.slug+' '+x.archivedAt).join('\n'))"`
