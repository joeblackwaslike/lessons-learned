---
sidebar_position: 4
title: Schema Reference
description: JSON Schema definitions for lesson records, lesson-manifest.json, and config.json data files.
---

# Schema Reference

All data files are validated against JSON Schema (Draft 2020-12). Schemas live in `schemas/`.

---

## `lessons.schema.json`

Validates a deserialized lesson row from `data/lessons.db` (SQLite) — the source of truth for
all lesson records. Fields match DB column names exactly; there is no `lessons.json` file.

**Schema ID:** `https://github.com/joeblackwaslike/lessons-learned/schemas/lessons.schema.json`

### Lesson record

| Field                | Type                         | Required | Constraints                                               | Description                                                            |
| -------------------- | ---------------------------- | -------- | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `id`                 | `string`                     | ✓        | Pattern: `^[0-9A-Z]{26}$`                                 | ULID — collision-free, sortable by creation time                       |
| `slug`               | `string`                     | ✓        | Pattern: `^[a-z0-9]+(-[a-z0-9]+)*-[a-z0-9]{4}$`           | kebab-case + 4-char random suffix                                      |
| `status`             | `string`                     | ✓        | `candidate \| reviewed \| active \| disabled \| archived` | Lifecycle state. Only `active`/`disabled` appear in the manifest       |
| `type`               | `string`                     | ✓        | `directive \| guard \| hint \| protocol`                  | Authoritative injection behavior                                       |
| `summary`            | `string`                     | ✓        | Max 120 chars                                             | One-line description; fallback injection text                          |
| `problem`            | `string`                     | ✓        | —                                                         | Root cause explanation                                                 |
| `solution`           | `string`                     | ✓        | —                                                         | Concrete fix                                                           |
| `toolNames`          | `string[]`                   | ✓        | Default: `[]`                                             | Exact tool name match — first-pass filter at hook time                 |
| `commandPatterns`    | `string[]`                   | ✓        | Default: `[]`                                             | Regex patterns matched against Bash `tool_input.command`               |
| `pathPatterns`       | `string[]`                   | ✓        | Default: `[]`                                             | Glob/regex patterns matched against Read/Edit/Write file paths         |
| `commandMatchTarget` | `string \| null`             | —        | `"full"` (default) or `"executable"`                      | `"executable"` strips quoted strings before matching `commandPatterns` |
| `modelPatterns`      | `string[]`                   | ✓        | Default: `[]`                                             | AND-gate regex matched against command or file path                    |
| `scope`              | `string \| null`             | —        | Default: `null`                                           | `null` = global; a project-ID string scopes to that project only       |
| `priority`           | `integer`                    | ✓        | 1–10                                                      | Higher wins budget conflicts                                           |
| `confidence`         | `number`                     | ✓        | 0.0–1.0                                                   | Below `minConfidence` → excluded from manifest                         |
| `tags`               | `string[]`                   | ✓        | Pattern: `^[a-z]+:[a-z0-9._-]+$`                          | `category:value` taxonomy                                              |
| `requires`           | `object \| object[] \| null` | —        | `{type, name}` or `{type: "github-issue", url}`           | Excludes the lesson from the manifest unless the artifact is installed |
| `duplicatedBy`       | `object \| null`             | —        | Same shapes as `requires`                                 | Excludes the lesson **when** the named artifact IS installed           |
| `source`             | `string`                     | ✓        | `structured \| heuristic \| manual`                       | How this lesson was discovered                                         |
| `sourceSessionIds`   | `string[]`                   | ✓        | Default: `[]`                                             | Session provenance                                                     |
| `occurrenceCount`    | `integer`                    | ✓        | Min: 0                                                    | Times pattern detected by scanner                                      |
| `sessionCount`       | `integer`                    | ✓        | Min: 0                                                    | Number of distinct sessions this pattern was seen in                   |
| `projectCount`       | `integer`                    | ✓        | Min: 0                                                    | Number of distinct projects this pattern was seen in                   |
| `contentHash`        | `string`                     | ✓        | Pattern: `^sha256:[a-f0-9]{64}$`                          | Dedup hash of problem + solution + triggers                            |
| `createdAt`          | `string`                     | ✓        | ISO 8601                                                  | Creation timestamp                                                     |
| `updatedAt`          | `string`                     | ✓        | ISO 8601                                                  | Last update timestamp                                                  |
| `reviewedAt`         | `string \| null`             | —        | ISO 8601                                                  | Null for unreviewed candidates                                         |
| `archivedAt`         | `string \| null`             | —        | ISO 8601                                                  | Null if not archived                                                   |
| `archiveReason`      | `string \| null`             | —        | —                                                         | Optional explanation for why the lesson was archived                   |

There is no `needsReview` column — manifest exclusion is computed from `confidence`/`priority`
at build time, not stored on the record.

---

## `manifest.schema.json`

Validates `data/lesson-manifest.json` — the pre-compiled runtime index read by the injection hook.

**Schema ID:** `https://github.com/joeblackwaslike/lessons-learned/schemas/manifest.schema.json`

:::note Do not edit directly
`lesson-manifest.json` is generated by `node scripts/lessons.mjs build`. Edit lessons via the
CLI (`add`, `edit`, `promote`) and rebuild instead.
:::

### Top-level

| Field         | Type                         | Required | Description                   |
| ------------- | ---------------------------- | -------- | ----------------------------- |
| `type`        | `"lessons-learned-manifest"` | ✓        | Discriminator                 |
| `version`     | `1`                          | ✓        | Schema version                |
| `generatedAt` | `string`                     | ✓        | ISO 8601 build timestamp      |
| `config`      | `object`                     | ✓        | Config snapshot at build time |
| `lessons`     | `object`                     | ✓        | Lessons keyed by ULID         |

### Config snapshot

The manifest embeds a snapshot of injection-relevant config fields so the hook never needs to read `config.json`:

| Field                            | Type      |
| -------------------------------- | --------- |
| `injectionBudgetBytes`           | `integer` |
| `maxLessonsPerInjection`         | `integer` |
| `minConfidence`                  | `number`  |
| `minPriority`                    | `integer` |
| `compactionReinjectionThreshold` | `integer` |

### Manifest lesson record

| Field                 | Type             | Required | Description                                                             |
| --------------------- | ---------------- | -------- | ----------------------------------------------------------------------- |
| `slug`                | `string`         | ✓        | For logging and dedup claim filenames                                   |
| `type`                | `string`         | ✓        | `directive \| guard \| hint \| protocol`                                |
| `priority`            | `integer`        | ✓        | For sort-time access                                                    |
| `toolNames`           | `string[]`       | ✓        | First-pass filter before regex matching                                 |
| `commandRegexSources` | `RegexSource[]`  | —        | Pre-compiled command pattern sources                                    |
| `commandMatchTarget`  | `string`         | —        | `"full"` or `"executable"` (defaults to `"executable"` for guards)      |
| `pathRegexSources`    | `RegexSource[]`  | —        | Pre-compiled path pattern sources (globs converted at build time)       |
| `modelRegexSources`   | `RegexSource[]`  | —        | Pre-compiled model-pattern sources, AND-gated against the match         |
| `tags`                | `string[]`       | —        | For tag-based scoring                                                   |
| `scope`               | `string \| null` | —        | `null` = global; a project-ID string scopes to that project only        |
| `message`             | `string`         | ✓        | Pre-rendered markdown — the only content read during injection          |
| `summary`             | `string`         | ✓        | Fallback if `message` exceeds remaining budget                          |
| `problem`             | `string`         | —        | Carried through for citation-fallback rendering                         |
| `solution`            | `string`         | —        | Carried through for citation-fallback rendering                         |
| `disabled`            | `boolean`        | —        | Only present (and `true`) when the source lesson's status is `disabled` |

### RegexSource object

Regex patterns are stored as `{ source, flags }` pairs rather than regex strings because `RegExp` is not JSON-serializable. The hook reconstructs them with `new RegExp(source, flags)`.

| Field    | Type     | Required | Description                 |
| -------- | -------- | -------- | --------------------------- |
| `source` | `string` | ✓        | Regex source string         |
| `flags`  | `string` | —        | Regex flags (default: `""`) |

---

## `config.schema.json`

Validates `data/config.json`.

**Schema ID:** `https://github.com/joeblackwaslike/lessons-learned/schemas/config.schema.json`

See the [Configuration Reference](configuration.md) for full field documentation. The schema enforces:

| Field                            | Type      | Min | Max | Default |
| -------------------------------- | --------- | --- | --- | ------- |
| `injectionBudgetBytes`           | `integer` | 256 | —   | 4096    |
| `maxLessonsPerInjection`         | `integer` | 1   | 10  | 3       |
| `minConfidence`                  | `number`  | 0.0 | 1.0 | 0.5     |
| `minPriority`                    | `integer` | 1   | 10  | 1       |
| `compactionReinjectionThreshold` | `integer` | 1   | 10  | 7       |
| `autoScanIntervalHours`          | `integer` | 1   | —   | 24      |
| `maxCandidatesPerScan`           | `integer` | 1   | —   | 50      |

---

## IDE validation

All data files include a `$schema` field pointing to the relevant schema. VS Code and other JSON-aware editors will validate the file on save and provide autocomplete for fields.

```json
{
  "$schema": "../schemas/config.schema.json",
  ...
}
```
