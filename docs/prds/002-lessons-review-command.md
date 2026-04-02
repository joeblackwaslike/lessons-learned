# PRD-002: `/lessons:review` — Unified Lesson Review Command

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **Status**       | Draft                                        |
| **Author**       | Joe Black                                    |
| **Created**      | 2026-04-02                                   |
| **Last Updated** | 2026-04-02                                   |
| **Stakeholders** | Individual developers using AI coding agents |

---

## 1. Problem Statement

The current lesson promotion pipeline requires multiple manual CLI invocations, each operating on separate JSON files with incompatible schemas. The steps are:

```text
  scan ──► filtered-candidates.json ──► scan aggregate ──► [scan promote N] ──► lessons.json ──► build ──► lesson-manifest.json
                   ^                                               ^                                               ^
              separate file,                               HIGH FRICTION:                                    separate file,
              own schema                                  one call per candidate                              own schema
```

`[scan promote N]` is the primary bottleneck — one interactive call per candidate, with no LLM assistance for field generation, noise filtering, or deduplication. The fragmented file layout (lessons.json, filtered-candidates.json, lesson-manifest.json) represents the same object at different lifecycle stages, each requiring its own schema knowledge to work with.

**Current state:** Promoting a batch of 10 candidates requires 10 sequential `scan promote` calls, manual field editing, and a final `build` step. The LLM — already present in the session — is not used.

**Desired state:** One command, `/lessons:review`, that uses the LLM to scan, aggregate, filter noise, and generate clean lesson fields, then hands off to an interactive terminal TUI for batch selection, inline editing, and promotion.

---

## 2. Goals

- Reduce lesson promotion from N calls to 1 command regardless of candidate count
- Use the LLM to filter noise and generate complete, well-formed lesson fields
- Give the user full control via an interactive TUI: batch select, inline edit, then confirm
- Unify the fragmented data files into a single SQLite DB with a proper state machine
- Preserve a permanent audit log of every review session

---

## 3. Non-Goals

- Editing existing active lessons (separate workflow)
- Surfacing or reviewing archived lessons interactively (available via `--show-archived` flag, not default)
- Cross-agent sync or remote storage
- ML-based lesson ranking (priority remains human+LLM assigned)

---

## 4. Architecture Overview

Two components with a clean handoff:

```text
/lessons:review (slash command — runs in Claude's context)
  Phase 1: Scan          → node scripts/lessons.mjs scan
  Phase 2: Aggregate     → node scripts/lessons.mjs scan aggregate
  Phase 3: LLM review    → Claude reads candidates, filters, generates fields
  Phase 4: Write session → data/review-sessions/<ulid>.json
  Phase 5: Hand off      → node scripts/lessons.mjs review --session <file>

lessons.mjs review subcommand (Node.js TUI — runs in terminal)
  Reads session JSON
  Renders Ink TUI: checkbox list + split-pane field editor
  User confirms
  Writes status transitions to SQLite DB
  Rebuilds hook manifest
  Prints report
```

---

## 5. Data Layer — Unified SQLite DB

### 5.1 Why SQLite

Node 22.5+ ships `node:sqlite` as a **built-in module** — no npm dependency, no install step. The engine requirement moves from `>=18` to `>=22.5`. Hook scripts already shell out to Node, so they get the same runtime automatically.

SQLite provides:

- WAL mode for safe concurrent writes (eliminates lockfile hacks)
- `CREATE INDEX` for fast trigger-pattern lookups
- Full-text search via FTS5 virtual tables (future: semantic search over mistake/remediation)
- Embeddings via `sqlite-vec` extension (optional, for vector similarity dedup — see §5.4)

### 5.2 Schema (TypeScript)

```typescript
// Canonical record — stored in SQLite, same shape used everywhere
interface LessonRecord {
  // Identity
  id: string; // ULID — lexicographically sortable by creation time
  slug: string; // kebab-case, human-readable key

  // State machine
  status: 'candidate' | 'reviewed' | 'active' | 'archived';

  // Content
  summary: string; // ≤80 chars, present tense, specific
  mistake: string; // what goes wrong and why
  remediation: string; // concrete fix

  // Trigger spec
  // injectOn replaces the old sessionStart boolean — records which hook events fire this lesson.
  // Lessons with no natural trigger use ["SessionStart"] for awareness-only injection.
  injectOn: Array<'PreToolUse' | 'SessionStart' | 'SubagentStart'>;
  toolNames: string[]; // exact tool name match
  commandPatterns: string[]; // regex strings matched against Bash commands
  pathPatterns: string[]; // glob strings matched against file paths

  // Scoring
  priority: number; // 1–10; see rubric below
  confidence: number; // 0.0–1.0; see rubric below

  // Metadata
  tags: string[]; // namespaces: tool:X, lang:X, severity:X, topic:X
  // used for TUI filtering and injection context hints

  // Provenance
  source: 'structured' | 'heuristic' | 'manual';
  sourceSessionIds: string[];
  occurrenceCount: number;
  sessionCount: number;
  projectCount: number;

  // Audit trail
  createdAt: string; // ISO 8601
  updatedAt: string;
  reviewedAt: string | null; // set when status → "reviewed" or "active"
  archivedAt: string | null; // set when status → "archived"
  archiveReason: string | null;

  // Dedup
  contentHash: string; // SHA-256 of mistake+remediation+commandPatterns
}
```

**Priority rubric:**

| Priority | Meaning                                                      |
| -------- | ------------------------------------------------------------ |
| 9–10     | Blocks execution — data loss, hard hang, irreversible action |
| 7–8      | Silent failure or confusing behavior with no error signal    |
| 5–6      | Notable mistake, clear fix                                   |
| 3–4      | Minor friction, easy to notice and recover                   |
| 1–2      | Cosmetic / style                                             |

Frequency may nudge priority ±1 but is not the primary signal.

**Confidence rubric:**

| Confidence | Meaning                                                               |
| ---------- | --------------------------------------------------------------------- |
| 0.9–1.0    | Explicit `#lesson` tag emitted by Claude in a session (T1 structured) |
| 0.7–0.89   | T1 tag + confirmed by user correction or multi-project recurrence     |
| 0.5–0.69   | Heuristic detection (T2), multi-session                               |
| 0.3–0.49   | Heuristic, single-session or low signal                               |
| < 0.3      | Do not promote                                                        |

### 5.3 Indexes

```sql
CREATE INDEX idx_lessons_status ON lessons(status);
CREATE INDEX idx_lessons_priority ON lessons(priority DESC);
CREATE INDEX idx_lessons_confidence ON lessons(confidence DESC);
CREATE INDEX idx_lessons_status_priority ON lessons(status, priority DESC);
CREATE VIRTUAL TABLE lessons_fts USING fts5(summary, mistake, remediation, content=lessons);
```

### 5.4 Deduplication — MinHash

The current Jaccard tokenization approach works but degrades at scale (O(n) scan per candidate). MinHash would allow sub-linear approximate similarity search as the lesson store grows — it generates a compact signature per lesson that supports fast set-similarity estimation.

This is worth evaluating at ~200+ lessons as a replacement for the current `computeContentHash` + full-scan approach.

For SQLite, the `sqlite-vec` extension supports vector storage and can hold MinHash signatures. This is optional and deferred, but the schema is designed to accommodate it (embeddings column, nullable).

### 5.5 Status state machine

```text
                        ┌─────────────────────────────────────┐
                        │                                     │
  [scanner discovers]   │  LLM marks noise                   │  /lessons:restore (future)
         │              │  (similar, situational)             │
         ▼              │                                     │
    ┌─────────┐         │        ┌──────────────┐            │
    │candidate├─────────┼───────►│   archived   │◄───────────┘
    └────┬────┘         │        │              │
         │              │        │ archivedAt   │◄── user deselects in TUI
         │  LLM review  │        │ recorded;    │◄── future: manual deprecation
         │  pass        │        │ retained     │
         ▼              │        │ forever;     │
    ┌─────────┐         │        │ restorable   │
    │reviewed │─────────┘        └──────────────┘
    └────┬────┘
         │  user selects in TUI
         ▼
    ┌─────────┐
    │ active  │  ← injected into sessions
    └─────────┘
```

Key transitions:

- `candidate → reviewed` — LLM review pass completes (fields generated, not yet user-confirmed)
- `reviewed → active` — user selects in TUI and confirms
- `reviewed → archived` — user explicitly deselects in TUI (must be a deliberate action, not automatic)
- `candidate → archived` — LLM marks as noise (duplicate, situational, etc.)
- `archived → candidate` — future `/lessons:restore` command for accidental archives

**Important:** Only records the user explicitly deselects in a review session are archived. Candidates not touched in a session remain as `candidate` for future review sessions.

### 5.6 Migration

`scripts/migrate-db.mjs` (one-time):

1. Read `data/lessons.json` → insert as `status: "active"`
2. Read `data/filtered-candidates.json` → insert as `status: "candidate"`
3. Verify counts match source files
4. Rename originals to `.bak`

### 5.7 lesson-manifest.json — kept as generated cache

With SQLite, the hook scripts _could_ query the DB directly. However, the hooks run on every Claude tool call and need to be fast. The manifest is a pre-compiled cache: regexes already compiled, records filtered to `status: "active"`, injection budget config embedded. It is **regenerated** by `lessons.mjs build` whenever active records change.

Users never edit or read it directly — it is an implementation detail of the hook layer.

---

## 6. Phase 1 — Terminology Cleanup

| Old                             | New                        | Why                                                |
| ------------------------------- | -------------------------- | -------------------------------------------------- |
| `cross-project-candidates.json` | `filtered-candidates.json` | Already in-flight rename                           |
| `scan candidates`               | `scan aggregate`           | It aggregates heuristic windows across sessions    |
| `scan promote`                  | removed                    | Replaced by `/lessons:review`                      |
| `intake` (all occurrences)      | `review`                   | Matches command name; "intake" was internal jargon |

---

## 7. Phase 2 — Scan Pipeline

```text
  JSONL session files (~/.claude/projects/)
          │
          ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  scan  (incremental — reads only new bytes since last run)    │
  └───────────────────────┬──────────────────────────────────────┘
                          │
           ┌──────────────┴──────────────┐
           │                             │
           ▼                             ▼
  T1: #lesson tags found          T2: heuristic sliding window
  source: structured               source: heuristic
  confidence: 0.9+                 confidence: 0.4–0.7
                                   (error→correction pattern detection)
           │                             │
           └──────────────┬──────────────┘
                          │
                          ▼
                    lessons.db
               (status: "candidate")
                          │
                          ▼
  ┌───────────────────────────────────────────────────────────────┐
  │  scan aggregate                                                │
  │  groups heuristic candidates by fuzzy key                     │
  │  (tool + error keyword cluster)                               │
  │  boosts confidence/priority for multi-session recurrences     │
  └───────────────────┬───────────────────────┬──────────────────┘
                      │                       │
                      ▼                       ▼
         ranked candidate list       single-session heuristic hits
         for /lessons:review         kept as candidates (conf: 0.3–0.49)
                                     NOT archived — may recur later
```

---

## 8. Phase 3 — `/lessons:review` Slash Command

**Location:** `.claude/commands/lessons/review.md`

### 8.1 End-to-end flow

```text
  User: /lessons:review
          │
          ▼
  Claude: node scripts/lessons.mjs scan
          (T1 saved as candidates, T2 windows saved as candidates)
          │
          ▼
  Claude: node scripts/lessons.mjs scan aggregate
          (groups recurring T2 patterns, outputs ranked list)
          │
          ▼
  ┌───────────────────────────────────────────────────────────┐
  │  Claude LLM review pass                                    │
  │  reads all status:"candidate" records                      │
  │  runs noise filter (§8.2)                                  │
  │  generates/improves fields for keepers                     │
  │  writes data/review-sessions/<ulid>.json                   │
  └────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
  Claude: node scripts/lessons.mjs review --session <file>
                           │
                           ▼
  ┌───────────────────────────────────────────────────────────┐
  │  Ink TUI (CLI takes over terminal)                         │
  │  User navigates, selects, edits fields, confirms           │
  └────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
  DB updated via SQLite WAL write:
    selected   → status: "active",   reviewedAt set
    explicitly deselected → status: "archived", archivedAt + archiveReason set
    not touched → remain as status: "candidate" for future sessions
  Manifest rebuilt (node scripts/lessons.mjs build)
  Report printed
```

### 8.2 LLM noise filter logic

```text
  candidate
      │
      ▼
  exact contentHash match in DB?
      ├─ yes ──► ARCHIVE: duplicate
      └─ no
          │
          ▼
      Jaccard similarity ≥ 0.5 vs active lessons?
          ├─ yes
          │     └─ does candidate expand existing lesson (adds new sub-case)?
          │           ├─ yes ──► FLAG: expand_existing (shown in TUI for user decision)
          │           └─ no  ──► ARCHIVE: near-duplicate of <slug>
          └─ no
              │
              ▼
          is mistake purely situational output?
              ├─ yes
              │     └─ second look: generalizable rule underneath?
              │           ├─ yes ──► KEEP: extract generalizable form
              │           └─ no  ──► ARCHIVE: situational
              └─ no
                  │
                  ▼
              concrete remediation possible?
                  ├─ yes ──► KEEP: generate fields
                  └─ no  ──► KEEP: flag needsHumanFix, injectOn: ["SessionStart"]
                                   (awareness-only; no trigger needed)
              │
              ▼
          generate: summary, mistake, remediation,
                    triggers, tags, priority, confidence
              │
              ▼
          status: "reviewed" — ready for TUI
```

Rules:

- Never discard solely because no trigger pattern can be written — use `injectOn: ["SessionStart"]`
- For near-duplicates: compare both side-by-side; if candidate adds a new sub-case, flag `expand_existing`
- For vague error output: attempt to identify a generalizable rule before archiving; if none found after genuine effort, archive

### 8.3 Review session file (audit log)

Written to `data/review-sessions/<ulid>.json`. Session IDs are ULIDs — lexicographically sortable by time. Kept permanently.

```json
{
  "sessionId": "01JXYZ...",
  "generatedAt": "2026-04-02T10:00:00Z",
  "candidatesConsidered": 8,
  "items": [
    {
      "action": "promote",
      "candidateId": "<id>",
      "lesson": { "summary": "...", "mistake": "...", "remediation": "..." }
    },
    {
      "action": "archive",
      "candidateId": "<id>",
      "archiveReason": "situational: specific file conflict, not generalizable"
    },
    {
      "action": "expand_existing",
      "candidateId": "<id>",
      "targetSlug": "git-stash-drops-untracked",
      "expansionNote": "adds sub-case: stash pop conflict when working tree dirty"
    }
  ]
}
```

---

## 9. Phase 4 — Interactive TUI (`scripts/review/ui.mjs`)

Uses **`ink`** — the React-for-terminals library that powers Claude Code's own UI. Installed automatically when the project dependencies are installed (`npm install`). End-users running the plugin via hooks never interact with the TUI directly; it is only used when running `lessons review` manually or via the slash command in Claude Code's terminal.

### 9.1 List view

```text
╔═════════════════════════════════════════════════════════════════╗
║  lessons:review — 5 candidates ready                            ║
║  ↑↓ navigate · space select · → view/edit · a all · ? help     ║
╠═════════════════════════════════════════════════════════════════╣
║                                                                 ║
║  ◉  git stash silently drops untracked files                    ║
║     tool:git  severity:data-loss  priority:7  conf:0.85        ║
║                                                                 ║
║▶ ◉  ts-node requires --esm for ESM module resolution            ║
║     lang:ts  priority:5  conf:0.72                             ║
║                                                                 ║
║  ◉  npm ci fails when lockfile is out of sync                   ║
║     tool:npm  topic:deps  priority:6  conf:0.80                ║
║                                                                 ║
║  ○  jsx file must use .tsx extension  [expand: ts-jsx-lesson]   ║
║     lang:ts  priority:5  conf:0.68                             ║
║                                                                 ║
║  ── archived by LLM review ──────────────────────────────────── ║
║  ↓  [situational] git restore conflict                          ║
║  ↓  [near-duplicate] biome config schema                        ║
║                                                                 ║
╠═════════════════════════════════════════════════════════════════╣
║  3 selected · Enter promote selected · Esc cancel              ║
╚═════════════════════════════════════════════════════════════════╝
```

**Keyboard:**

- `↑` / `↓` — navigate rows
- `Space` — toggle selected / unselected
- `→` — open split-pane detail (editable for candidates; view-only with restore option for archived)
- `a` — select all promote-eligible rows
- `Enter` — confirm and promote selected rows
- `Esc` — cancel (no changes written)
- `?` — toggle help overlay

**Archived section:** Collapsed at bottom. Pressing `→` on an archived row opens it read-only with the LLM's archive reason visible, plus an **[Unarchive]** action that returns it to `status: "reviewed"` for editing and promotion.

**Session semantics:** Only rows the user explicitly interacts with are written to the DB. Rows the user never touches remain as `candidate` and appear again in the next review session. Nothing is auto-archived by inaction.

### 9.2 Field editor — split-pane (opens on `→`)

```text
╔══════════════════════════════╦══════════════════════════════════╗
║  ◉ ts-node / ESM module      ║  ┌ summary ──────────────────┐  ║
║  ◉ git stash untracked       ║  │ ts-node requires --esm    │  ║
║  ◉ npm ci lockfile           ║  │ for ESM module resolution  │  ║
║▶ ◉ [editing]                 ║  └────────────────────────────┘  ║
║  ○  jsx → .tsx (expand)      ║                                  ║
║                              ║  ┌ mistake ───────────────────┐  ║
║  ── archived ──              ║  │ Running ts-node on ESM     │  ║
║  ↓ situational               ║  │ without --esm causes       │  ║
║  ↓ near-duplicate            ║  │ ERR_REQUIRE_ESM.           │  ║
║                              ║  └────────────────────────────┘  ║
║                              ║                                  ║
║                              ║  ┌ remediation ───────────────┐  ║
║                              ║  │ Add --esm flag:            │  ║
║                              ║  │   ts-node --esm src/...    │  ║
║                              ║  └────────────────────────────┘  ║
║                              ║                                  ║
║                              ║  ┌ tags ──────┐  ┌ priority ─┐  ║
║                              ║  │ lang:ts    │  │ 5         │  ║
║                              ║  └────────────┘  └───────────┘  ║
║                              ║                                  ║
║                              ║  ┌ injectOn ──────────────────┐  ║
║                              ║  │ PreToolUse                 │  ║
║                              ║  └────────────────────────────┘  ║
╠══════════════════════════════╩══════════════════════════════════╣
║  Tab/↑↓ fields · Enter edit · Esc back · changes auto-save     ║
╚═════════════════════════════════════════════════════════════════╝
```

All fields visible simultaneously in the right pane. Left pane stays navigable — switching rows auto-saves edits. `Enter` on a field enters inline edit mode; `Esc` discards; `Enter` again confirms.

---

## 10. Phase 5 — Promotion

```text
1. SQLite WAL mode handles concurrency — no separate lockfile needed.
   If a second process tries to write simultaneously, SQLite serializes it safely.

2. User confirms in TUI.

3. Explicitly selected   → UPDATE status="active",   reviewedAt=now()
4. Explicitly deselected → UPDATE status="archived",  archivedAt=now(), archiveReason="user-deselected"
5. Not touched           → no DB write; remain as status="candidate"

6. Rebuild hook manifest:
     node scripts/lessons.mjs build
     (SELECT * FROM lessons WHERE status='active' → lesson-manifest.json)

7. Print report:
     ✓ Added: git-stash-drops-untracked   (tool:git, priority:7)
     ✓ Added: ts-node-esm-flag            (lang:ts,  priority:5)
     ↷ Archived: 1 candidate (user-deselected)
     ○ Skipped: 3 candidates (not reviewed — will appear next session)
     Manifest rebuilt. 2 new lessons active.
```

---

## 11. Dependency Installation

`ink` and `react` are listed in `package.json` as regular dependencies. They are installed when the developer runs `npm install` in the project root. The slash command and TUI are only used by developers who have cloned the repo and run `npm install` — end-users consuming the plugin via hooks do not install these; they only receive `lesson-manifest.json` and the hook scripts, which have zero npm dependencies.

---

## 12. Files to Create / Modify

| File                                 | Action           | Purpose                                                                    |
| ------------------------------------ | ---------------- | -------------------------------------------------------------------------- |
| `data/lessons.db`                    | Create (migrate) | SQLite DB replacing lessons.json + filtered-candidates.json                |
| `data/review-sessions/`              | Create dir       | Permanent ULID-named audit logs                                            |
| `scripts/migrate-db.mjs`             | Create           | One-time migration from JSON files to SQLite                               |
| `.claude/commands/lessons/review.md` | Create           | Slash command                                                              |
| `scripts/review/ui.mjs`              | Create           | Ink TUI (list view + split-pane editor)                                    |
| `scripts/review/review.mjs`          | Create           | `review` subcommand entry point                                            |
| `scripts/lessons.mjs`                | Modify           | Add `review`; rename `scan candidates` → `scan aggregate`; update DB paths |
| `scripts/scanner/*.mjs`              | Modify           | Write candidates to SQLite instead of filtered-candidates.json             |
| `package.json`                       | Modify           | Add `ink`, `react`; bump `engines.node >= 22.5`                            |

`lesson-manifest.json` remains as a generated-only build artifact — it is the compiled output of `lessons build`, consumed by hook scripts for fast regex matching. Not a source-of-truth; regenerated on every promotion.

---

## 13. Verification

1. `scripts/migrate-db.mjs` — DB has 30 active + 15 candidate records; `.bak` files present
2. `/lessons:review` — scan runs, aggregate runs, LLM review writes `data/review-sessions/<ulid>.json`
3. TUI opens — arrow keys navigate, space toggles, `→` opens split-pane editor
4. Edit a field inline — change persists when switching rows
5. Confirm promotion — selected records show `status: "active"` in DB; manifest rebuilt
6. Untouched candidates — verify they remain `status: "candidate"` in DB
7. Re-run `/lessons:review` — untouched candidates re-appear; promoted records absent
8. Archived row `→` — LLM reason visible; [Unarchive] action available; confirm it works
9. Empty state — "No candidates found. Run `lessons scan` to discover new ones."
