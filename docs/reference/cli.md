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

Rebuild `lesson-manifest.json` from `lessons.json`.

```bash
node scripts/lessons.mjs build
```

Required after:

- Direct edits to `data/lessons.json`
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

| Option         | Description                                          |
| -------------- | ---------------------------------------------------- |
| `--auto`       | Non-interactive mode (used by background hook)       |
| `--full`       | Reset byte offsets; re-scan all files from the start |
| `--dry-run`    | Show what would be found; don't write candidates     |
| `--tier1-only` | Only scan for structured `#lesson` tags              |
| `--tier2-only` | Only run heuristic detection                         |

### Subcommands

#### `scan candidates`

Show cross-project recurring patterns (seen in 2+ sessions):

```bash
node scripts/lessons.mjs scan candidates
```

Output is a numbered list of candidates with metadata. The index number is used by `scan promote`.

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
| `npm run docs`             | `mkdocs serve`                   |
| `npm run docs:build`       | `mkdocs build -s`                |
