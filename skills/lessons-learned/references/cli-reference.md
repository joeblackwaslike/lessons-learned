# CLI Reference

All lesson management goes through a single entry point:

```bash
node scripts/lessons.mjs <subcommand> [options]
```

Run any subcommand with `--help` for full options.

## Subcommands

| Subcommand       | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `add`            | Add a lesson (`--interactive`, `--json`, `--file`, or stdin)   |
| `build`          | Rebuild `lesson-manifest.json` from the DB                     |
| `edit`           | Edit fields on any lesson in place (`--id`, `--patch`)         |
| `list`           | List all active lessons (`--json` for machine-readable output) |
| `promote`        | Promote candidates → active, archive any lesson, patch fields  |
| `restore`        | Restore archived lessons back to active                        |
| `review`         | Validate candidates against intake rules (text report)         |
| `scan`           | Incremental scan of session logs for new candidates            |
| `scan aggregate` | Output ranked candidate JSON (input for `/lessons:review`)     |

## Common invocations

```bash
# Add a lesson from JSON (used by /lessons:add)
node scripts/lessons.mjs add --json '{"summary":"...","mistake":"...","remediation":"..."}'

# Promote candidates to active
node scripts/lessons.mjs promote --ids id1,id2

# Archive a lesson with a reason
node scripts/lessons.mjs promote --archive "id1:superseded by newer lesson"

# Edit a field on any lesson
node scripts/lessons.mjs edit --id <id> --patch '{"priority": 8}'

# Restore an archived lesson
node scripts/lessons.mjs restore --ids <id>

# Rebuild the manifest after any change to active lessons
node scripts/lessons.mjs build
```

## npm scripts

| Script            | Command                          |
| ----------------- | -------------------------------- |
| `npm run lessons` | `node scripts/lessons.mjs`       |
| `npm run build`   | `node scripts/lessons.mjs build` |
| `npm run scan`    | `node scripts/lessons.mjs scan`  |
| `npm test`        | Run all tests                    |
