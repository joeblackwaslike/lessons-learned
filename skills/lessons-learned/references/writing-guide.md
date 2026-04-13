# Writing a Good Lesson

A lesson is only useful if it fires at the right moment and contains actionable information. These guidelines apply when writing lessons manually (`/lessons:add`) or enriching candidates during review.

## The three fields that matter most

### problem — root cause, not symptoms

Be specific about _why_ something goes wrong, not just _that_ it goes wrong.

> ✗ "git stash doesn't always work"
> ✓ "git stash only stashes tracked modified files — untracked files are silently left behind, risking data loss when the working tree looks clean but isn't"

The problem text drives deduplication (Jaccard similarity check) and is the primary signal for candidate ranking. Vague problems match nothing and teach nothing.

### solution — concrete and copy-pasteable

The fix should be specific enough to act on immediately.

> ✗ "be careful with git stash"
> ✓ "Use `git stash -u` (or `--include-untracked`) to include untracked files"

### trigger — the command that precedes the problem, not the problem itself

Point the trigger at what Claude is _about to do_, not what went wrong:

> `git stash` → fires before the user runs git stash without `-u`

Not `git stash pop` (that's after the damage is done).

## Choosing the right trigger type

| Scenario              | Trigger type                 | Example             |
| --------------------- | ---------------------------- | ------------------- |
| CLI command or prefix | `commandPatterns` regex      | `^git stash(?! -u)` |
| Specific tool         | `toolNames` exact match      | `["Bash"]`          |
| File path context     | `pathPatterns` glob          | `**/package.json`   |
| Always relevant       | `injectOn: ["SessionStart"]` | protocol reminders  |

## Validation rules enforced by `lessons add`

- `summary`, `problem`, `solution` each ≥ 20 chars
- No unfilled template placeholders (`<what_went_wrong>` etc.)
- Summary must not end with `...`
- Trigger must not be a prose gerund (e.g. "running pytest")
- Jaccard similarity of `problem` vs all existing lessons < 0.5
