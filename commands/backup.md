---
name: lessons:backup
description: Snapshot data/lessons.db to an out-of-tree backup, or restore it from an existing snapshot. data/lessons.db is intentionally untracked in git (a full dump would ship unreviewed candidates and personal lessons to every install) — this is the only recovery path if it's ever lost or corrupted.
allowed-tools: ['Bash']
---

# /lessons:backup

You are running `/lessons:backup`. Handle three flows based on what the user asks for: a plain
run with no arguments should default to **creating a snapshot now**.

---

## Snapshot now (default)

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs backup
```

Report the destination path and whether any old backups were pruned. Mention the default
location (`~/.lessons-learned-backups/`, overridable via `LESSONS_BACKUP_DIR`) and retention
(last 14 backups, overridable via `LESSONS_BACKUP_KEEP`) if the user seems unfamiliar with the
mechanism.

## Listing backups

If the user asks to see existing backups ("list backups", "what backups exist", "when was the
last backup"):

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs backup --list
```

## Restoring from a backup

If the user says the DB is missing, corrupted, or asks to restore/roll back:

1. List backups first (see above) so the user can pick one, unless they already named a
   specific file or said "latest"/"newest".
2. Confirm before restoring — this can overwrite the current `data/lessons.db`:

```text
Restore data/lessons.db from <backup file>?
This will replace the current DB. Confirm? (yes / cancel)
```

3. On confirmation:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs restore --db [--file <path>] [--force]
```

- Omit `--file` to restore the newest snapshot.
- The command refuses to overwrite a DB that looks healthy unless `--force` is passed — if it
  refuses and the user really does want to roll back (e.g. recovering from a bad bulk edit),
  re-confirm explicitly before adding `--force`.
- The manifest (`data/lesson-manifest.json`) is rebuilt automatically after a successful
  restore.

Report the restored path and prompt the user to spot-check `lessons list` or `lessons doctor`
afterward if they were recovering from corruption rather than simple loss.
