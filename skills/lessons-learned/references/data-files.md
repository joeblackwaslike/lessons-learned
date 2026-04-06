# Data Files Reference

All runtime data lives in `data/`. Most files are generated — edit only `config.json` and `lessons.db` (via the CLI).

| File                        | Purpose                                                      | Edit?                       |
| --------------------------- | ------------------------------------------------------------ | --------------------------- |
| `data/lessons.db`           | SQLite source of truth — all lessons across all statuses     | Via CLI only                |
| `data/lesson-manifest.json` | Generated runtime index read by hooks                        | Never (run `build`)         |
| `data/config.json`          | Plugin configuration — injection limits, scan paths, scoring | Yes (via `/lessons:config`) |
| `data/review-sessions/`     | Audit log of promote/archive decisions                       | Read-only                   |
| `data/scan-state.json`      | Byte offsets for incremental scanning                        | Never (auto-managed)        |

## Generated files

**`lesson-manifest.json`** is rebuilt by `node scripts/lessons.mjs build`. It is always regenerated from `lessons.db` — never hand-edit it. Hooks read this file at runtime to match lessons against tool calls.

**`scan-state.json`** stores byte offsets so the scanner knows where it left off in each JSONL file. Deleting it forces a full re-scan on next run (safe but slower).

## Config file

`data/config.json` controls injection behavior, scan settings, and scoring weights. Use `/lessons:config` for a guided interface, or edit directly and run `node scripts/lessons.mjs build` to apply changes to the manifest.

See the schema at `schemas/config.schema.json` for field definitions and valid ranges.
