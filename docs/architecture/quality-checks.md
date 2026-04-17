# Lesson Quality Anti-Patterns

Reference for `bd lint`, `doctor --check=conventions`, and `preflight`. Each anti-pattern
describes a structural or semantic defect that degrades injection effectiveness.

---

## Anti-patterns

### 1. Cluster over-weighting

**What it means:** Three or more lessons occupy the same behavioral cluster (similar summaries, same behavioral domain).

**Consequences:** When 3+ lessons occupy the same behavioral cluster, each gets proportionally less attention in context. The model pattern-matches the cluster and averages the nuances together — the distinctive guidance in each lesson is compressed into a gestalt, and the specific constraint that makes each one valuable gets lost. The more similar the summaries look at a glance, the worse the effect.

**Origin:** Lessons are added independently over time with no check for semantic similarity at the cluster level.

**Fix:** Group by semantic summary similarity; flag clusters ≥ 3; differentiate summaries so scope is scan-visible at a glance. If two lessons are genuinely distinct, make their summaries reflect that distinction in the first 10 words.

**SQL check:**
```sql
-- No direct SQL check — requires semantic similarity grouping.
-- Use: bd lint (Jaccard similarity across all active lesson summaries)
```

---

### 2. Directive with toolNames

**What it means:** A lesson has `type=directive` and a non-empty `toolNames` array.

**Consequences:** `toolNames` is silently ignored for `directive` type — `matchLessons` is bypassed entirely. The lesson fires at every session start unconditionally, injecting irrelevant context in sessions that never use that tool. The declared trigger is never consulted.

**Origin:** `#lesson` tags have no `type` field — `tool:` maps to `toolNames`. When a lesson is manually promoted with `type=directive` + `toolNames`, the contradiction isn't caught. No intake validation exists for this combination.

**Fix:** Convert to `type=hint`. Directives are for always-on session-start context only; hints fire on tool match.

**SQL check:**
```sql
SELECT id, summary FROM lessons
WHERE type = 'directive'
  AND toolNames != '[]'
  AND status = 'active';
```

---

### 3. Dead trigger

**What it means:** A `hint` or `guard` has `commandPatterns` or `pathPatterns` but no `toolNames`.

**Consequences:** The lesson never fires. Step 1 of `matchLessons` (toolNames check) fails immediately when `toolNames` is empty — command and path patterns are never evaluated.

**Origin:** `toolNames` omitted when writing a hint, or the lesson was migrated from a type that didn't require it.

**Fix:** Add the correct `toolNames` value. Every `hint`/`guard` with any pattern must have at least one tool name.

**SQL check:**
```sql
SELECT id, summary FROM lessons
WHERE type IN ('hint', 'guard')
  AND toolNames = '[]'
  AND (commandPatterns != '[]' OR pathPatterns != '[]')
  AND status = 'active';
```

---

### 4. Global scope for narrow concept

**What it means:** A `protocol` or `directive` is global (`scope=null`) but applies only to a specific domain, project type, or tool ecosystem.

**Consequences:** Injects irrelevant context in most sessions — wastes context budget and dilutes signal from relevant lessons.

**Origin:** Lessons are added globally by default. No mechanism yet to detect project type or content context at injection time.

**Fix:** Scope to a specific project if the concept is project-specific. Otherwise move to the nursery (tag `in:nursery`, archive) until content-aware or project-type matching exists.

**SQL check:**
```sql
SELECT id, summary, scope FROM lessons
WHERE type IN ('protocol', 'directive')
  AND scope IS NULL
  AND status = 'active';
-- Review each result manually for domain specificity
```

---

### 5. Weak problem-solution pair

**What it means:** `problem` or `solution` is too terse; solution restates the problem; reader can't understand what actually happened without session context.

**Consequences:** Lesson doesn't transfer the knowledge needed to avoid the mistake. May mislead or be ignored entirely.

**Origin:** Short capture during a session without enough context written at the time.

**Fix:** Expand `problem` to explain the full scenario and why it was confusing. Expand `solution` to be actionable without any session context — another engineer should be able to apply it cold.

**SQL check:**
```sql
SELECT id, summary, length(problem), length(solution) FROM lessons
WHERE (length(problem) < 80 OR length(solution) < 60)
  AND status = 'active';
```

---

### 6. Similarity flooding

**What it means:** A lesson has Jaccard similarity > 0.5 versus an existing active lesson.

**Consequences:** Near-duplicate lesson adds noise without adding signal.

**Origin:** Multiple sessions hit the same mistake; each emits a `#lesson` tag; only the first one matters.

**Fix:** Already caught at `lessons add` intake — Jaccard check blocks duplicates at write time. For the DB: find pairs with high overlap and archive the weaker one.

**SQL check:**
```sql
-- No direct SQL check — requires pairwise Jaccard computation.
-- Caught by intake validation at lessons add time.
```

---

### 7. Orphaned scope

**What it means:** A lesson is scoped to a project ID that no longer matches any directory under `~/.claude/projects/`.

**Consequences:** The lesson never fires (scope check fails at inject time) but still occupies the manifest.

**Origin:** Project renamed or moved after the lesson was scoped to it.

**Fix:** Validate scope IDs against `~/.claude/projects/` folder names in `doctor`. Update scope or set to `null` if the project no longer exists.

**SQL check:**
```sql
SELECT id, summary, scope FROM lessons
WHERE scope IS NOT NULL
  AND status = 'active';
-- Then cross-reference scope values against ~/.claude/projects/ directory names
```

---

### 8. Trigger-reality drift

**What it means:** A lesson's `commandPatterns` or `pathPatterns` no longer match how the tool or workflow is actually invoked (e.g., command was renamed, path structure changed).

**Consequences:** Lesson silently stops firing even though the underlying hazard still exists. The hazard is unguarded.

**Origin:** Command-line interfaces evolve; file structures get reorganized; the lesson trigger isn't updated alongside the change.

**Fix:** Periodically audit triggers against current usage patterns. When a CLI tool is upgraded or a path restructured, search for lessons that match the old pattern.

**SQL check:**
```sql
SELECT id, summary, commandPatterns, pathPatterns FROM lessons
WHERE status = 'active'
  AND (commandPatterns != '[]' OR pathPatterns != '[]');
-- Review each trigger against current tool/path conventions
```

---

### 9. Solution staleness

**What it means:** The solution field references a specific version, flag, or API that has since changed or been deprecated.

**Consequences:** Following the solution causes the same problem it's meant to prevent. Worse than no lesson — it actively misleads.

**Origin:** Solutions are written at a point in time and not updated when dependencies evolve.

**Fix:** Tag solutions that reference specific versions with the version at time of writing. Flag for review when a dependency major-version upgrade lands.

**SQL check:**
```sql
-- Heuristic: look for version numbers in solution field
SELECT id, summary, solution FROM lessons
WHERE solution LIKE '%v[0-9]%' OR solution LIKE '%@[0-9]%'
  AND status = 'active';
```

---

### 10. Overspecified trigger

**What it means:** `commandPatterns` is so specific that it only fires for one exact invocation rather than the general class of hazardous commands.

**Consequences:** The lesson fires for the exact command that originally caused the mistake but misses semantically equivalent variants. The hazard recurs under slightly different syntax.

**Origin:** Pattern captured from the exact failing command verbatim, without generalizing to the hazard class.

**Fix:** Generalize the pattern to the executable or the hazard-relevant argument, not the full incantation. Use `commandMatchTarget: "executable"` where appropriate.

**SQL check:**
```sql
SELECT id, summary, commandPatterns, commandMatchTarget FROM lessons
WHERE commandPatterns != '[]'
  AND status = 'active';
-- Review patterns longer than ~30 chars for over-specificity
```

---

### 11. Context bleed

**What it means:** A lesson's `problem` or `solution` contains references to a specific project, person, or session ("in the foo repo", "Joe said", "the PR from last Tuesday") that make it meaningless outside the original session.

**Consequences:** Lesson is injected globally but the context is uninterpretable. Noise with no signal.

**Origin:** Lesson captured verbatim from session output without stripping session-specific context.

**Fix:** Rewrite to be universally applicable — replace all proper nouns and session references with generic descriptions of the concept.

**SQL check:**
```sql
-- No clean SQL check — requires semantic review.
-- Heuristic: look for first-person or project-specific language:
SELECT id, summary, problem FROM lessons
WHERE (problem LIKE '%this repo%' OR problem LIKE '% I %' OR problem LIKE '%last session%')
  AND status = 'active';
```

---

### 12. Priority homogeneity

**What it means:** All active lessons have the same priority value (default 5), making relative ordering meaningless.

**Consequences:** High-signal lessons compete equally with low-signal lessons in the injection output. When context is trimmed, important lessons are as likely to be dropped as irrelevant ones.

**Origin:** Priority is never set explicitly; default value is used for every lesson.

**Fix:** After adding a lesson, assess its relative importance. Reserve priority 8–10 for lessons where the failure mode is severe (data loss, security, silent corruption). Use 5 for moderate risk. Use 2–3 for informational hints.

**SQL check:**
```sql
SELECT priority, count(*) as count FROM lessons
WHERE status = 'active'
GROUP BY priority
ORDER BY priority DESC;
-- If one priority value dominates (>80% of lessons), differentiation is needed
```

---

## SQL quick reference

Run all structural checks at once:

```sql
-- Directive with toolNames (should be 0)
SELECT 'directive+toolNames' as check, id, summary FROM lessons
WHERE type = 'directive' AND toolNames != '[]' AND status = 'active'
UNION ALL
-- Dead trigger (should be 0)
SELECT 'dead-trigger', id, summary FROM lessons
WHERE type IN ('hint','guard') AND toolNames = '[]'
  AND (commandPatterns != '[]' OR pathPatterns != '[]') AND status = 'active'
UNION ALL
-- Orphaned scope (review manually)
SELECT 'orphaned-scope', id, summary FROM lessons
WHERE scope IS NOT NULL AND status = 'active'
UNION ALL
-- Nursery lessons (informational)
SELECT 'nursery', id, summary FROM lessons
WHERE tags LIKE '%in:nursery%' AND status = 'archived'
ORDER BY check, id;
```
