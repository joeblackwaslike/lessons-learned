---
sidebar_position: 1
title: CLI Reference
description: Complete reference for all lessons-learned CLI subcommands, options, and npm scripts.
---

# CLI Reference

All management goes through a single entry point:

```bash
node scripts/lessons.mjs <subcommand> [options]
```

Or via npm scripts:

```bash
npm run lessons -- <subcommand> [options]
```

---

## `add`

Add a new lesson to the store.

```bash
node scripts/lessons.mjs add [options]
```

### Options

| Option            | Description                               |
| ----------------- | ----------------------------------------- |
| (none)            | Interactive mode — prompts for all fields |
| `--json '<json>'` | Inline JSON string                        |
| `--file <path>`   | Read lesson from a JSON file              |

### Interactive mode

Prompts for: summary, problem, solution, trigger, tags, priority.

```bash
node scripts/lessons.mjs add
```

### JSON mode

```bash
node scripts/lessons.mjs add --json '{
  "summary": "git stash drops untracked files silently",
  "problem": "git stash only stashes tracked modified files — untracked files are silently left behind",
  "solution": "Use git stash -u (--include-untracked) to include untracked files",
  "trigger": "git stash",
  "tags": ["tool:git", "severity:data-loss"],
  "priority": 9
}'
```

### From file

```bash
node scripts/lessons.mjs add --file lesson.json
```

### Validation

All modes enforce:

- `summary`, `problem`, `solution` each ≥ 20 characters
- No unfilled template placeholders
- `summary` must not end with `...`
- Trigger must not be a prose gerund
- Jaccard similarity vs existing lessons < 0.5

Validation failures exit non-zero with a descriptive message.

### After add

The manifest is rebuilt automatically after a successful add.

---

## `build`

Rebuild `lesson-manifest.json` from the database.

```bash
node scripts/lessons.mjs build
```

Required after:

- Direct edits to `data/lessons.db` (via `edit` subcommand)
- Changing `minConfidence` or `minPriority` in `data/config.json`

Not required after config-only changes to injection budget or scan settings.

---

## `list`

List all lessons with metadata.

```bash
node scripts/lessons.mjs list [options]
```

### Options

| Option              | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| (none)              | Formatted table                                                     |
| `--json`            | JSON array                                                          |
| `--status <status>` | Filter by status: `active`, `candidate`, `archived`, `needs-review` |
| `--tag <tag>`       | Filter by tag (e.g. `tool:git`)                                     |

### Examples

```bash
node scripts/lessons.mjs list
node scripts/lessons.mjs list --json
node scripts/lessons.mjs list --status active
node scripts/lessons.mjs list --tag severity:data-loss
```

---

## `edit`

Edit a lesson field by ID.

```bash
node scripts/lessons.mjs edit --id <id> --patch '<json>'
```

### Options

| Option             | Description                     |
| ------------------ | ------------------------------- |
| `--id <id>`        | Lesson ID (ULID) or slug        |
| `--patch '<json>'` | JSON object of fields to update |

### Example

```bash
node scripts/lessons.mjs edit --id pytest-tty-hanging-k9m2 --patch '{"priority": 9}'
```

The manifest is rebuilt automatically after a successful edit.

---

## `review`

Interactive review of Tier 2 heuristic candidates.

```bash
node scripts/lessons.mjs review [options]
```

### Options

| Option        | Description                   |
| ------------- | ----------------------------- |
| (none)        | Review all pending candidates |
| `--limit <n>` | Review at most N candidates   |

For each Tier 2 candidate, the CLI shows the raw error context and prompts for:

- Summary
- Whether the mistake is real and reusable
- Trigger pattern
- Priority and tags

Accepted candidates are promoted to the lesson store and the manifest is rebuilt.

---

## `scan`

Incrementally scan session logs for lesson candidates.

```bash
node scripts/lessons.mjs scan [subcommand] [options]
```

### Options (base)

| Option               | Description                                               |
| -------------------- | --------------------------------------------------------- |
| `--auto`             | Non-interactive mode (used by background hook)            |
| `--full`             | Reset byte offsets; re-scan all files from the start      |
| `--dry-run`          | Show what would be found; don't write candidates          |
| `--tier1-only`       | Only scan for structured `#lesson` tags (Tier 1)          |
| `--tier2-only`       | Only run heuristic detection (Tier 2)                     |
| `--structural`       | Also run Tier 3 structural/insight detection              |
| `--structural-full`  | Tier 3 full re-scan (ignore saved offsets)                |
| `--deep`             | Also run Tier 4 LLM deep scan (requires API key)          |
| `--deep-full`        | Tier 4 full re-scan (ignore saved offsets)                |
| `--max-sessions <n>` | Limit Tier 4 deep scan to the N most recent sessions      |
| `--path <dir>`       | Scan a specific directory instead of configured scanPaths |
| `--verbose`          | Print per-file progress and candidate details             |

### Subcommands

#### `scan aggregate`

Show cross-project recurring patterns (seen in 2+ sessions):

```bash
node scripts/lessons.mjs scan aggregate
```

Output is a ranked JSON list of candidates with metadata. The index number is used by `scan promote`.

#### `scan promote <index>`

Promote a specific candidate into the lesson store:

```bash
node scripts/lessons.mjs scan promote 3
```

The CLI prompts for any fields not already present (summary, trigger, priority, tags). The manifest is rebuilt after promotion.

---

## `promote`

Archive or restore a lesson.

```bash
node scripts/lessons.mjs promote [options]
```

### Options

| Option                    | Description                             |
| ------------------------- | --------------------------------------- |
| `--archive "<id>:reason"` | Archive a lesson with a reason          |
| `--restore`               | Restore an archived lesson              |
| `--ids <id,...>`          | Comma-separated IDs for bulk operations |

### Examples

```bash
# Archive
node scripts/lessons.mjs promote --archive "01JQSEED00000000000000001:resolved in npm 10"

# Restore
node scripts/lessons.mjs promote --restore --ids 01JQSEED00000000000000001

# Bulk restore
node scripts/lessons.mjs promote --restore --ids id1,id2,id3
```

---

## `restore`

Restore an archived lesson (alias for `promote --restore`).

```bash
node scripts/lessons.mjs restore --ids <id,...>
```

---

## `onboard`

Interactive onboarding flow for new installations.

```bash
node scripts/lessons.mjs onboard
```

Walks through verifying the installation, reviewing the seed lesson store, and configuring scan paths.

---

## `doctor`

Check the health of the installation: manifest freshness, config validity, hook wiring.

```bash
node scripts/lessons.mjs doctor
```

Exits non-zero with a diagnostic message if any check fails.

---

## `preflight`

Run a quick sanity check before a session (manifest exists, no schema errors, hook files present).

```bash
node scripts/lessons.mjs preflight
```

---

## `purge`

Remove all candidates from the store.

```bash
node scripts/lessons.mjs purge [options]
```

### Options

| Option      | Description                        |
| ----------- | ---------------------------------- |
| `--confirm` | Required to execute (safety guard) |

---

## `windows`

List all active dedup session windows (temp files in `TMPDIR`).

```bash
node scripts/lessons.mjs windows
```

Useful for debugging dedup state — shows which sessions have active temp files and claim directories.

---

## `config`

View and edit configuration.

```bash
node scripts/lessons.mjs config [options]
```

### Options

| Option              | Description                         |
| ------------------- | ----------------------------------- |
| (none)              | Show all settings with descriptions |
| `set <key> <value>` | Set a specific config field         |

### Examples

```bash
node scripts/lessons.mjs config
node scripts/lessons.mjs config set maxLessonsPerInjection 2
node scripts/lessons.mjs config set injectionBudgetBytes 6144
```

Changes to `minConfidence` and `minPriority` require a manifest rebuild.

---

## npm scripts

| Script                     | Equivalent                       |
| -------------------------- | -------------------------------- |
| `npm run lessons`          | `node scripts/lessons.mjs`       |
| `npm run build`            | `node scripts/lessons.mjs build` |
| `npm run scan`             | `node scripts/lessons.mjs scan`  |
| `npm test`                 | All tests                        |
| `npm run test:unit`        | Unit tests only                  |
| `npm run test:integration` | Integration tests only           |
| `npm run test:e2e`         | E2E tests only                   |
| `npm run test:coverage`    | Tests with coverage              |
| `npm run lint`             | ESLint (report)                  |
| `npm run lint:fix`         | ESLint (auto-fix)                |
| `npm run format`           | Prettier (write)                 |
| `npm run format:check`     | Prettier (check)                 |
| `npm run typecheck`        | TypeScript check                 |
