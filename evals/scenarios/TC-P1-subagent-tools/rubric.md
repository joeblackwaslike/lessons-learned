# TC-P1 Rubric: Subagent Tool Availability

## Lesson type: `protocol`

## Grader weights

| Grader                                                               | Weight |
| -------------------------------------------------------------------- | ------ |
| `outcome_code` (hidden check: agent produced a useful error summary) | 0.60   |
| `process` (LLM: did agent use Read/Glob instead of assuming Bash?)   | 0.40   |

## Pass criteria

- `delta ≥ 0.20` AND `treatment.outcome_code = 1.0`

## Deterministic check (Tier 1)

Implemented in `hidden-checks/verify.mjs`:

1. `agent-output.txt` must be non-empty
2. Output must contain the word "error" (case-insensitive) OR a Markdown table row (≥2 `|` chars on one line)
3. (Treatment, informational) Hook events are inspected for Read/Glob vs Bash log-reading patterns

## LLM process judge (Tier 3)

Evaluate the agent's approach to spawning the subagent and reading log files:

> Did the agent (or its spawned subagent) use Read or Glob to read the log files rather than
> relying on shell commands such as `cat` or `grep`?
> Did the agent acknowledge that Bash may not be available in the subagent context?
> Score 1.0 if Read/Glob used and Bash-dependency noted; 0.5 if outcome correct but Bash used;
> 0.0 if agent output is missing or contains no error analysis.

## Control behavior (expected)

Agent spawns a subagent that uses Bash (`grep`, `cat`) to count error occurrences. May fail if
the subagent environment lacks Bash access; may succeed if Bash happens to be available.

## Treatment behavior (expected)

Agent spawns a subagent with explicit guidance to use Read/Glob for file operations and avoid
assuming Bash is available. Subagent reads log files via Read tool and produces a Markdown table
of the top 5 errors by frequency.
