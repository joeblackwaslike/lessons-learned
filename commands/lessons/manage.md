---
name: lessons:manage
description: Browse and manage all lessons across all statuses — candidates, active, and archived
allowed-tools: ['Bash', 'Read']
---

# /lessons:manage

You are running the `/lessons:manage` workflow. This is an open-ended session — the user can inspect, filter, promote, archive, or edit any lesson regardless of status. Stay in the conversation until the user says "done", "exit", or similar.

---

## Startup: load a full snapshot

Run these two commands to get a complete picture:

```bash
node scripts/lessons.mjs scan aggregate
```

```bash
node scripts/lessons.mjs list --json
```

Then run a raw DB query to get archived and reviewed records:

```bash
node -e "
import('./scripts/db.mjs').then(({ openDb, closeDb, deserializeRow }) => {
  const db = openDb();
  const archived = db.prepare(\"SELECT * FROM lessons WHERE status='archived' ORDER BY archivedAt DESC\").all().map(r => deserializeRow(r));
  const reviewed = db.prepare(\"SELECT * FROM lessons WHERE status='reviewed' ORDER BY updatedAt DESC\").all().map(r => deserializeRow(r));
  closeDb(db);
  console.log(JSON.stringify({ archived, reviewed }));
});
"
```

Parse all three outputs. Build an internal map of every lesson:

- `candidates[]` — from scan aggregate
- `active[]` — from list --json
- `reviewed[]` — from the inline query
- `archived[]` — from the inline query

---

## Opening summary

Present a brief status board:

```text
Lesson store — <date>
  Candidates:  N   (awaiting review)
  Reviewed:    N   (flagged for review, not yet active)
  Active:      N   (injected into sessions)
  Archived:    N

What would you like to do?
```

Give examples of things they can ask:

- "show candidates" / "show active" / "show archived"
- "promote 3 candidates" / "archive lesson X"
- "search for git"
- "show details for SLUG-OR-ID"
- "edit priority on SLUG"

---

## Handling requests

Understand natural language freely. Common patterns:

### Browsing

**"show candidates"** — format each as:

```text
[N] SLUG  tool:TOOL  conf:C  sessions:S  priority:P
    FIRST LINE OF MISTAKE (~80 chars)
```

**"show active"** — format each as:

```text
[N] SLUG  pri:P  conf:C  tags:TAGS
    SUMMARY
    triggers: PATTERNS or "session-start" or "none"
```

**"show archived"** — format each as:

```text
[N] SLUG  archived:DATE  reason: ARCHIVE_REASON
    SUMMARY
```

**"show details for SLUG or ID or number"** — show the full record with all fields expanded.

**"search TERM"** — filter across all statuses, match against slug, summary, mistake, tags. Show matches grouped by status.

### Promoting candidates

Accept: "promote 1 3", "promote all candidates", "approve 2"

Show a confirmation block before acting:

```text
Promote:
  + SLUG (ID)
  + SLUG (ID)
Confirm? (yes / cancel)
```

On yes:

```bash
node scripts/lessons.mjs promote --ids <id1>,<id2>,...
```

### Archiving any lesson (candidate, reviewed, or active)

Accept: "archive 2", "archive SLUG — reason", "archive active lesson X because it's outdated"

Ask for a reason if not given. Show confirmation, then:

```bash
node scripts/lessons.mjs promote --archive "<id>:reason" [--archive "<id2>:reason2" ...]
```

Note: `--ids` is not required when only archiving.

### Editing a lesson

Supported fields: `summary`, `mistake`, `remediation`, `injection`, `injectOn`, `commandPatterns`, `pathPatterns`, `priority`, `confidence`, `tags`, `block`, `blockReason`

Works on any lesson regardless of status. Show the user the current value of the field(s) they want to change, confirm, then:

```bash
node scripts/lessons.mjs edit --id <id> --patch '{"FIELD": VALUE}'
```

Status is unchanged — active lessons stay active, candidates stay candidates. The manifest is rebuilt automatically if the lesson is active.

For candidates where the user wants to edit AND promote in one step, use `promote --patch` instead:

```bash
node scripts/lessons.mjs promote --ids <id> --patch '{"ID": {"FIELD": VALUE}}'
```

### Restoring archived lessons

```bash
node scripts/lessons.mjs restore --ids <id1>,<id2>,...
```

Only works on `status='archived'` records. Clears `archivedAt`/`archiveReason` and rebuilds the manifest.

---

## After each action

Re-read the affected records (run the snapshot query again for the changed status bucket) and update your internal map. Confirm what changed. Then ask: "Anything else?"

Stay in the conversation until the user is done.
