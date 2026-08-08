# lessons-learned

[![CI](https://github.com/joeblackwaslike/lessons-learned/actions/workflows/ci.yml/badge.svg)](https://github.com/joeblackwaslike/lessons-learned/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen)](package.json)
[![Discord](https://img.shields.io/discord/1486035859747897414?logo=discord&label=Discord&color=5865F2)](https://discord.gg/Fjc9zYHZyV)

> Stop repeating Claude's mistakes. Every session, automatically.

![lessons-learned: a session emits a #lesson tag, it's scanned, reviewed, promoted, and the next session's PreToolUse hook injects the warning before the mistake repeats](website/static/img/demo.gif)

_Real terminal output, not staged — see [`website/static/demo.tape`](website/static/demo.tape) to reproduce it._

**136 active lessons** · **87 eval scenarios** measuring whether injection actually changes behavior · **37 pages** of docs · **4 platforms** (Claude Code, Codex CLI, Gemini CLI, opencode)

```bash
# Step 1 — add the marketplace (once per machine)
claude plugin marketplace add joeblackwaslike/agent-marketplace

# Step 2 — install the plugin
claude plugin install lessons-learned@agent-marketplace
```

- **Captures** mistakes from session logs — structured tags and heuristic scanning
- **Injects** relevant warnings before tool calls at the exact moment they're needed
- **Compounds** — every session adds to a persistent store that follows you across projects

---

## Why this exists

Claude is stateless. Every session forgets every correction, every footgun hit, every `git stash` that silently dropped untracked files. Over long agentic runs, the same class of mistake appears again and again — because nothing carries forward.

lessons-learned creates a persistent, compounding memory of failure patterns. Mistakes are captured automatically from session logs. A background scanner extracts candidates, you promote the ones worth keeping, and the next time Claude is about to make the same move, a warning surfaces at the exact tool call where it matters.

The feedback loop tightens over time. The more sessions, the stronger the prevention.

---

## See it in action

**Step 1 — Claude makes a mistake and emits a lesson tag:**

```
#lesson
tool: Bash
trigger: git stash
problem: git stash silently omits untracked files — they stay in the working tree
         and are not stashed. Running git stash with new files present loses them.
solution: Use `git stash -u` (or `--include-untracked`) to capture all changes.
tags: tool:git, severity:data-loss
#/lesson
```

**Step 2 — Next session startup scans the log:**

```
$ node scripts/lessons.mjs scan --verbose
[scan] Scanning ~/.claude/projects/ for new lessons...
[scan] Processing session: abc123-2024-01-15.jsonl (42.3 KB)
  → tier1: found 1 structured lesson tag (#lesson)
  → tier2: found 1 heuristic pattern (error→correction)
[scan] Processing session: def456-2024-01-16.jsonl (38.1 KB)
  → tier1: no structured tags
  → tier2: no patterns detected
[scan] New candidates: 2 | Duplicates skipped: 0 | Total in DB: 47
```

**Step 3 — Review, then promote (review is read-only; promotion is explicit):**

```
$ node scripts/lessons.mjs review
── tool:git (1) ───────────────────────────────────────────────

┌─ [1/1] ✓ PASS ───────────────────────────────────────────────────────
│ Bash                      conf:0.8   pri:4    sessions:1
│ Tags: tool:git, severity:data-loss
│ ID:   01KZHWHQY4MHBKBZR0245NDVV9
├─ Problem ────────────────────────────────────────────────────────────
│ git stash silently omits untracked files -- they stay in the working tree...
├─ Solution ───────────────────────────────────────────────────────────
│ Use `git stash -u` (or `--include-untracked`) to capture all changes.
└──────────────────────────────────────────────────────────────────────

1 pass, 0 fail

$ node scripts/lessons.mjs promote --ids 01KZHWHQY4MHBKBZR0245NDVV9
Promoted 1 lesson(s):
  + git-stash-silently-omits-untracked-files-3232 (01KZHWHQY4MHBKBZR0245NDVV9)
Built manifest: 1 lessons included, 0 excluded
```

**Step 4 — Warning fires before the next `git stash`** (this is the actual
`additionalContext` a `PreToolUse` hook injects, extracted with `jq`):

```
<details>
<summary>[lessons-learned] 1 lesson matched for `git stash` — <em>Why am I seeing this?</em></summary>

The **lessons-learned** plugin matched this tool call against known pitfall
patterns and injected the following warnings for Claude to consider before
executing.

---

## Lesson: git stash silently omits untracked files -- they stay in the working tree and are not stashed.
git stash silently omits untracked files -- they stay in the working tree and
are not stashed. Running git stash with new files present loses track of
them across a branch switch.
**Fix**: Use `git stash -u` (or `--include-untracked`) to capture all changes,
including new files.

</details>
```

See it happen live in the demo GIF at the top of this page, or reproduce it
yourself with `vhs website/static/demo.tape`.

---

## Install

| Platform    | Install                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `claude plugin marketplace add joeblackwaslike/agent-marketplace` then `claude plugin install lessons-learned@agent-marketplace` |
| Codex CLI   | `codex plugin marketplace add joeblackwaslike/agent-marketplace` then `codex plugin install lessons-learned@agent-marketplace`   |
| Gemini CLI  | Clone repo, run `LESSONS_AGENT_PLATFORM=gemini node scripts/lessons.mjs onboard`                                                 |
| opencode    | Same as Claude Code — tool names match                                                                                           |
| Cursor      | `node scripts/lessons.mjs list --json > .cursorrules`                                                                            |
| Manual/MCP  | Coming soon (see Roadmap)                                                                                                        |

**Requirements:** Node.js ≥ 22.5

For manual hook wiring and platform-specific config, see [Installation](website/docs/user-guide/installation.md).

---

## How it works

```mermaid
graph LR
    subgraph "Session Start"
        SS1["Inject protocol\nand directives"]
        SS2["Background scan\nTier 1/2/3/4"]
        SS3["Reset dedup state"]
    end
    subgraph "Per Tool Call"
        PT["matchLessons()\ntool + pattern + path"]
        PO["Context monitor\nre-inject at 30/52/70%"]
    end
    subgraph "Data"
        DB[(lessons.db)]
        MF["lesson-manifest.json"]
    end
    SS2 --> DB
    DB --> MF
    PT --> MF
    PO --> MF
```

1. **Capture** — Claude emits `#lesson` tags in responses; the background scanner processes previous session JSONL files on startup using up to 4 tiers (structured tags, heuristic patterns, structural insights, LLM deep scan)
2. **Review & promote** — Candidates land in `lessons.db`; `lessons review` validates them (PASS/FAIL, read-only) and `lessons promote --ids ...` moves the ones worth keeping to active
3. **Build** — `lessons build` pre-compiles regexes into `lesson-manifest.json` for zero-latency runtime lookup
4. **Inject** — At each `PreToolUse` event, `matchLessons()` checks tool name + command patterns + file paths; matching lessons prepend as `additionalContext` before the tool runs

---

## Platforms

| Platform    | Status      | Notes                                                 |
| ----------- | ----------- | ----------------------------------------------------- |
| Claude Code | First-class | `Bash`, `Read`, `Edit`, `Write`, `Glob`               |
| Codex CLI   | Supported   | Same tool names as Claude Code                        |
| Gemini CLI  | Supported   | Set `LESSONS_AGENT_PLATFORM=gemini`                   |
| opencode    | Supported   | Same tool names as Claude Code                        |
| Cursor      | Export only | `node scripts/lessons.mjs list --json > .cursorrules` |
| MCP         | Roadmap     | Universal adapter planned                             |

---

## Features

| Feature                                         | Status     |
| ----------------------------------------------- | ---------- |
| PreToolUse lesson injection                     | ✅         |
| Session-start protocol injection                | ✅         |
| Guard lessons (block tool calls)                | ✅         |
| 4-tier background scanning (T1/T2/T3/T4 LLM)    | ✅         |
| Incremental scanning with byte offsets          | ✅         |
| Confidence and priority scoring                 | ✅         |
| 3-layer atomic dedup                            | ✅         |
| Budget-aware injection (3 lessons / 4 KB)       | ✅         |
| PostToolUse context re-injection at 30/52/70%   | ✅         |
| PreCompact session handoff                      | 🚧 Beta    |
| Subagent lesson protocol                        | ✅         |
| Cross-platform (CC / Codex / Gemini / opencode) | ✅         |
| MCP server adapter                              | 🗺 Roadmap |
| LLM-assisted candidate classification           | 🗺 Roadmap |
| Project stack auto-detection                    | 🗺 Roadmap |

---

## Measuring whether it actually works

Injecting a warning is easy. Knowing whether it _changed the agent's behavior_
is the hard part — so lessons-learned has an eval harness for that, not just
for the plugin's plumbing.

**87 hand-crafted scenarios** in [`evals/`](evals/), each graded on 3 tiers:

| Tier | Checks                          | How                                                                  |
| ---- | ------------------------------- | -------------------------------------------------------------------- |
| 1    | Filesystem/command outcome      | A deterministic `hidden-checks/verify.mjs`                           |
| 2    | Tool-call sequence              | Declarative trajectory rules in `scenario.json`                      |
| 3    | Did the lesson change behavior? | An LLM judge compares the agent with vs. without the lesson injected |

Every scenario runs a **control arm** (no lesson) against a **treatment arm**
(lesson injected) so a pass means the lesson caused the fix, not that the
model would have gotten it right anyway.

That measurement infrastructure has caught real bugs in itself. The eval
provider silently ran the agent arm on a different, stronger model than the
run was labeled and cached under — so a 2026-06 full-suite result reading
"~65% of lessons are obsolete" was confounded. From
[`evals/FINDINGS.md`](evals/FINDINGS.md):

> The improvement may be **the model, not lesson obsolescence** — any archive
> decision based on that run is provisional until re-validated on a pinned
> model.

The fix (pin the agent model, clear the cache, re-validate) is now a
documented, repeatable process — see [Pruning Obsolete Lessons](website/docs/developer-guide/pruning-obsolete-lessons.md).
Lessons the model has genuinely outgrown are archived, not deleted, into an
append-only [`obsoleted-lessons.json`](data/obsoleted-lessons.json) ledger so
a future model regression can restore them.

---

## Configuration

Edit `data/config.json` directly. Every field has a `LESSONS_*` env var equivalent that takes precedence.

| Field                            | Default               | Description                           |
| -------------------------------- | --------------------- | ------------------------------------- |
| `injectionBudgetBytes`           | `4096`                | Max bytes per injection payload       |
| `maxLessonsPerInjection`         | `3`                   | Max lessons per tool call             |
| `minConfidence`                  | `0.5`                 | Exclude lessons below this confidence |
| `minPriority`                    | `1`                   | Exclude lessons below this priority   |
| `compactionReinjectionThreshold` | `7`                   | Re-inject after N tool calls          |
| `scanPaths`                      | `~/.claude/projects/` | Where to find session JSONL files     |

**Tier 4 LLM deep scan** fires automatically at session start when an API key is available:

```bash
echo "sk-ant-..." > data/.api-key   # gitignored; scoped to deep scan only
```

Cost: ~$0.10–0.25/day at Haiku rates. Throttled to once per 24 hours.

---

## Development

```bash
npm test                  # all 297 tests
npm run test:unit         # unit tests only (fast)
npm run test:integration  # integration tests
npm run lint              # eslint
npm run typecheck         # tsc --noEmit
```

For evals (routes through meridian proxy):

```bash
cd evals
ANTHROPIC_API_KEY=meridian ANTHROPIC_BASE_URL=http://127.0.0.1:3456 \
  npx promptfoo eval --config promptfooconfig.yaml --filter-pattern "TC-H1"
```

See [docs](https://joeblackwaslike.github.io/lessons-learned) for the full reference and [CONTRIBUTING.md](CONTRIBUTING.md) for the dev workflow.

---

## License

MIT © Joe Black
