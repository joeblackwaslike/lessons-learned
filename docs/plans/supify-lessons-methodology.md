# Supify Lessons Methodology Plan

**Date:** 2026-05-14  
**Scope:** Apply Jesse Vincent / Superpowers-style behavior engineering to `lessons-learned`, its eval harness, and the active lesson corpus.

## Goal

Turn lessons from passive reminders into pressure-tested behavioral interventions: trigger-focused, context-efficient, objectively verifiable, and evaluated against realistic agent failure modes.

This plan applies to:

- Core repo: `/Users/joe/github/joeblackwaslike/lessons-learned`
- Eval repo: `/Users/joe/github/joeblackwaslike/lessons-learned/evals`
- Generated manifest: `data/lesson-manifest.json`
- Source of truth: `data/lessons.db`
- Project-local methodology skill: `.agents/skills/supify-lessons/`
- Project-local discovery links: `.claude/skills/supify-lessons`, `.codex/skills/supify-lessons`, `.gemini/skills/supify-lessons`

## Current Baseline

Observed on 2026-05-14:

- Runtime manifest has 99 active lessons.
- Lesson types: 69 `hint`, 15 `protocol`, 8 `directive`, 7 `guard`.
- Priorities are spread from 3 to 10, with many mid/high priority lessons.
- `node scripts/lessons.mjs doctor --json` currently fails with quality issues:
  - `directive/protocol has toolNames` on at least one lesson.
  - Many summaries exceed the 80-character target.
  - Some hint/guard lessons have no command/path patterns and therefore over-inject.
  - Some regexes are overspecified.
  - Some solution/problem fields contain time- or version-sensitive claims.
  - Store-level gap: no hint/guard lessons cover `WebFetch` or `WebSearch`.
- Evals already support control/treatment arms, hidden checks, trajectory assertions, and an LLM judge.
- Existing project-local skill `skills/lessons-learned/` documents the plugin but does not yet encode the Jesse/Superpowers improvement workflow for lesson quality.

## Design Principles

### Lessons Are Behavioral Code

Any lesson text that changes agent behavior should be treated like code:

- Define the desired behavior.
- Create a pressure scenario that exposes the failure.
- Rewrite the lesson minimally.
- Rebuild the manifest.
- Run targeted evals.
- Only then claim the lesson improved.

### Manifest Is Generated

Do not hand-edit `data/lesson-manifest.json`. Lesson changes must go through:

```bash
node scripts/lessons.mjs edit --id <id> --patch '<json>'
node scripts/lessons.mjs build
```

Use the manifest only as the runtime artifact to inspect and verify.

### Trigger Before Reminder

A lesson is valuable only if it appears at the moment of risk. Every lesson should answer:

```text
When the agent is about to <trigger>, it should <observable behavior>, even if <pressure>.
```

### Gates Over Advice

Weak lesson:

```text
Be careful with git stash.
```

Jessified lesson:

```text
Before running git stash, check whether untracked files must be preserved. Use git stash -u when they do.
```

### Eval Before Confidence

For behavior-changing rewrites, require at least one of:

- Existing scenario updated and run.
- New scenario created.
- RED/GREEN manual transcript documented.
- Doctor/preflight improvement with no eval needed because change is mechanical.

## Target Lesson Shape

Each lesson should have:

- **Summary:** Under 80 chars, one-line risk.
- **Problem:** Root cause and failure mode, not symptoms.
- **Solution:** Concrete action or gate the agent can apply immediately.
- **Trigger:** Tool + command/path pattern that fires before the risky action.
- **Type:** `hint`, `guard`, `protocol`, or `directive` chosen by injection behavior, not severity.
- **Priority:** Reflects consequence and frequency.
- **Tags:** Useful for grouping and eval selection.
- **Eval mapping:** Scenario ID or explicit reason no eval is needed.

Recommended injected message pattern:

```markdown
## Lesson: <short risk>

<root cause and failure mode>
**Fix**: Before <risky action>, <objective gate or concrete correction>.
```

For adherence-sensitive lessons, include compact rationalization language:

```markdown
Do not treat "just this once" or "manual check is enough" as an exception.
```

## Workstreams

### Workstream 1: Project-Local Methodology Skill

Create a project-local skill under the repo-local `.agents` directory and symlink the agent-specific discovery directories to it:

```text
.agents/skills/supify-lessons/
.claude/skills/supify-lessons -> ../../.agents/skills/supify-lessons
.codex/skills/supify-lessons -> ../../.agents/skills/supify-lessons
.gemini/skills/supify-lessons -> ../../.agents/skills/supify-lessons
```

Purpose: give future agents working inside this repo a workflow for applying Superpowers methodology to lesson data, evals, and manifest quality.

Minimum files:

- `.agents/skills/supify-lessons/SKILL.md`
- `.agents/skills/supify-lessons/references/lesson-supification.md`
- `.agents/skills/supify-lessons/references/eval-workflow.md`

The skill should route agents through:

1. Audit current lesson.
2. State behavior.
3. Identify pressure scenario.
4. Rewrite fields through CLI patch.
5. Rebuild manifest.
6. Run doctor/preflight.
7. Run or create eval.

### Workstream 2: Lesson Quality Audit

Add a deterministic audit/report command or script that categorizes every active lesson by Jesse/Superpowers quality dimensions.

Suggested script:

```text
scripts/supify/audit-lessons.mjs
```

Output:

```json
{
  "slug": "...",
  "id": "...",
  "issues": [
    "missing-behavior-statement",
    "weak-solution-no-gate",
    "overbroad-trigger",
    "session-start-toolnames",
    "no-eval-scenario"
  ],
  "recommendedAction": "mechanical-fix | rewrite | eval-needed | archive"
}
```

Initial checks:

- Summary over 80 chars.
- Hint/guard missing trigger patterns.
- Tool-name-only broad triggers.
- Protocol/directive with ignored `toolNames`.
- Problem lacks root cause language.
- Solution lacks concrete command/action/gate.
- Message over injection budget risk threshold.
- Tags missing `tool:*`, `topic:*`, or `severity:*` where obvious.
- No matching `evals/scenarios/*/scenario.json` by slug.

### Workstream 3: Lesson Corpus Rewrite

Process lessons in batches instead of mass-rewriting.

Batch order:

1. **Doctor failures that are mechanical.**
   - Summary length.
   - Ignored `toolNames` on session-start lessons.
   - Invalid or overspecified regexes.
2. **Overbroad injections.**
   - Hint/guard lessons with no command or path patterns.
   - Tool-only lessons that should become command/path targeted.
3. **High-priority behavior lessons.**
   - Priority 8-10 lessons first.
   - Security/data-loss/hang lessons first.
4. **Session-start protocols/directives.**
   - Convert to trigger-scoped hints when possible.
   - Keep session-start only when no natural trigger exists.
5. **Stale/version-sensitive lessons.**
   - Verify current facts or rewrite without volatile claims.
6. **Low-priority/situational lessons.**
   - Consider archive, scope, or downgrade.

Per-lesson procedure:

```text
1. Inspect DB/manifest lesson by slug.
2. Write behavior statement.
3. Classify current weakness.
4. Decide field patch.
5. Apply via scripts/lessons.mjs edit.
6. Rebuild manifest.
7. Run doctor.
8. Run existing eval or create scenario.
```

### Workstream 4: Eval Harness Upgrade

Keep Promptfoo as the current harness, but add Drill-inspired concepts:

- **Naive posture:** user prompt does not mention the lesson.
- **Spec-aware posture:** user or prompt points at the relevant warning.
- **Pressure posture:** prompt includes time/sunk-cost/shortcut pressure.
- **RED variant:** treatment lesson removed or weakened where feasible.

Add scenario metadata fields to `evals/scenarios/*/scenario.json`:

```json
{
  "posture": "naive | spec-aware | pressure",
  "failureMode": "verification-skip | unsafe-command | overbroad-scope | ...",
  "expectedBehavior": "...",
  "redVariant": {
    "type": "lesson-disabled | lesson-weakened | none",
    "notes": "..."
  }
}
```

Add eval assertions where possible:

- Lesson injected before hazardous tool call.
- Hazardous command was avoided or corrected.
- Required verification command ran before completion.
- Agent did not merely acknowledge the lesson.
- Agent did not over-apply the lesson outside the trigger.

### Workstream 5: Manifest-Level Supification Report

Add a generated report:

```text
docs/reports/lesson-supification-audit.md
```

Report sections:

- Corpus counts by type, priority, tag.
- Doctor issues.
- Supification issues.
- Lessons without eval scenarios.
- Lessons with overbroad triggers.
- Session-start lessons and rationale.
- Recommended batch order.

This gives future agents a concrete work queue.

### Workstream 6: WebFetch/WebSearch Coverage

Doctor reports no hint/guard lessons cover `WebFetch` or `WebSearch`.

Do not add generic web-search lessons blindly. First identify real observed failures or common high-consequence failure modes:

- Stale package/API docs.
- Relying on blogs instead of primary docs for technical work.
- Failing to verify current facts.
- Copying long copyrighted text.
- Search-result overtrust.

For each candidate:

- Create pressure scenario.
- Add trigger-targeted lesson.
- Add eval scenario.

## Implementation Tasks

### Task 1: Add Project-Local Methodology Skill

Files:

- Create `.agents/skills/supify-lessons/SKILL.md`
- Create `.agents/skills/supify-lessons/references/lesson-supification.md`
- Create `.agents/skills/supify-lessons/references/eval-workflow.md`
- Symlink `.claude/skills`, `.codex/skills`, and `.gemini/skills` entries to `.agents/skills/supify-lessons`.

Acceptance:

- Skill description triggers when improving lesson data.
- Skill routes to references instead of loading all detail.
- References name the actual repo commands and files.

### Task 2: Add Supification Audit Script

Files:

- Create `scripts/supify/audit-lessons.mjs`
- Add package script if useful: `"supify:audit": "node scripts/supify/audit-lessons.mjs"`

Acceptance:

- Reads `data/lesson-manifest.json`.
- Emits JSON and human-readable modes.
- Does not mutate the DB.
- Flags the first batch of known issues from current `doctor` output.

### Task 3: Add Report Renderer

Files:

- Create `scripts/supify/render-report.mjs`
- Generate `docs/reports/lesson-supification-audit.md`

Acceptance:

- Report groups lessons by action category.
- Report includes exact slugs and IDs.
- Report includes eval coverage gaps.

### Task 4: Upgrade Eval Scenario Schema

Files:

- Update `docs/eval-scenario-writing.md`
- Update `evals/README.md`
- Update `evals/scripts/generate-scenarios.mjs`
- Update relevant tests if scenario validation exists.

Acceptance:

- New scenario metadata is documented.
- Existing scenarios remain valid.
- Generator can emit `posture`, `failureMode`, and `expectedBehavior`.

### Task 5: Add RED/GREEN Eval Support

Files:

- Update `evals/providers/claude-agent.mjs`
- Update `evals/scripts/judge.mjs`
- Update `evals/scripts/render-report.mjs`
- Add helper if needed for disabled/weakened lesson variants.

Acceptance:

- Treatment can run with lesson enabled.
- RED/control variant can run with lesson disabled or absent.
- Report distinguishes `CONTROL_CORRECT`, `LESSON_LOAD_BEARING`, and `LESSON_NOT_LOAD_BEARING`.

### Task 6: Mechanically Fix Doctor Failures

Use CLI patches, not manifest edits.

Examples:

```bash
node scripts/lessons.mjs edit --id <id> --patch '{"summary":"Shorter summary"}'
node scripts/lessons.mjs build
node scripts/lessons.mjs doctor
```

Acceptance:

- `doctor` issue count reduced.
- Manifest rebuilt.
- Existing eval smoke still runs or skipped with reason.

### Task 7: Supify High-Priority Lessons

Process priority 8-10 lessons in small batches.

For each:

- Write behavior statement.
- Check trigger precision.
- Rewrite solution as a gate or concrete action.
- Add rationalization counter only if useful.
- Run or create eval.

Acceptance:

- Every priority 8-10 lesson has either an eval scenario or documented reason.
- Overbroad high-priority hints are trigger-scoped or retyped.

### Task 8: Review Session-Start Lessons

Files/data:

- `type: protocol`
- `type: directive`

Acceptance:

- Every session-start lesson has a rationale for why no narrower trigger exists.
- Session-start lessons with natural tool/path triggers are converted to `hint` or `guard`.
- Ignored `toolNames` on session-start lessons are removed or type is changed.

### Task 9: Add WebFetch/WebSearch Lessons From Evidence

Acceptance:

- Add only evidence-backed lessons.
- Each has a trigger and eval.
- No generic "use better sources" always-on lesson unless justified as protocol.

## Verification Plan

Run after each batch:

```bash
node scripts/lessons.mjs build
node scripts/lessons.mjs doctor
pnpm test
pnpm eval:smoke
```

Run before merge:

```bash
node scripts/lessons.mjs preflight
pnpm test
pnpm eval:report
```

If full evals are too expensive, run targeted evals for changed lesson slugs and document what was skipped.

## Risks

- **Over-supification:** making every lesson too strict or verbose. Mitigation: keep lessons compact and trigger-scoped.
- **Context bloat:** adding rationalization tables into every lesson. Mitigation: only add adherence language where RED tests show rationalization.
- **Generated-file drift:** hand-editing manifest. Mitigation: only edit DB through CLI and rebuild.
- **Eval false confidence:** control already succeeds. Mitigation: add RED/pressure variants.
- **Overblocking:** converting too many hints to guards. Mitigation: guards only for irreversible or destructive actions.

## Deliverables

- Project-local skill: `.agents/skills/supify-lessons/`
- Agent discovery links to the project-local skill in Claude, Codex, and Gemini.
- Audit script: `scripts/supify/audit-lessons.mjs`
- Report: `docs/reports/lesson-supification-audit.md`
- Eval metadata upgrade for posture/failure mode.
- Batch PRs that rewrite lessons through the CLI with eval evidence.
