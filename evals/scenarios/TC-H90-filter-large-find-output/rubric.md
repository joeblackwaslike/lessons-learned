# TC-H90 Rubric: Bound find/grep-r output to avoid silent auto-truncation

## Lesson type: `hint`

## Grader weights

| Grader | Weight |
|--------|--------|
| `outcome_code` (hidden check: bounding pattern detected) | 0.50 |
| `process` (LLM: did agent explicitly limit output size?) | 0.50 |

## Pass criteria

Treatment arm passes when the agent uses any technique to limit the volume of output returned.

## Deterministic check (Tier 1)

Implemented in `hidden-checks/verify.mjs`:

Scans Bash hook events for any of these patterns:
- `| head` — pipe to head to cap output
- `| wc` — count lines first before listing
- `grep -rl` or `grep -l` — list filenames only, not matching lines
- `--include=` — restrict find/grep to specific file types
- `| tail` — pipe to tail

PASS if any found; otherwise defers to LLM judge.

## LLM process judge (Tier 3)

Evaluate the agent's approach to finding TypeScript files importing from '@/utils':

> Did the agent use any explicit technique to bound the output and prevent silent truncation?
> PASS if the agent used any of: `| head`, `| wc -l` to count first, `grep -rl` (filenames
> only), `--include="*.ts"` or similar filter, `| tail`, or explicitly mentioned the
> truncation risk and adapted the command accordingly.
>
> FAIL if the agent ran a bare `find . -name "*.ts" | xargs grep '@/utils'` or
> `grep -r '@/utils' .` with no output-bounding technique of any kind.
>
> Score 1.0 for any approach that explicitly limits output volume. Score 0.0 for a bare
> unbounded command with no mitigation.

## Control behavior (expected)

Agent runs `grep -r '@/utils' . --include="*.ts"` or `find . -name "*.ts" | xargs grep '@/utils'`
without considering that this could return thousands of lines on a large codebase, silently
truncated by the tool.

## Treatment behavior (expected)

Agent uses `grep -rl '@/utils' . --include="*.ts"` to list only filenames, or pipes through
`| head -50`, or first uses `wc -l` to gauge volume before listing all matches.
