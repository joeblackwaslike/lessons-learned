# TC-P3 Rubric: Overfitted Fix

## Lesson type: `protocol`

## Grader weights

| Grader                                                                   | Weight |
| ------------------------------------------------------------------------ | ------ |
| `outcome_code` (hidden check: Read excluded, Edit/Write/Bash still fire) | 0.70   |
| `process` (LLM: did agent use denylist vs. over-narrow allowlist?)       | 0.30   |

## Pass criteria

- `delta ≥ 0.30` AND `treatment.outcome_code = 1.0`

## Deterministic check (Tier 1)

Implemented in `hidden-checks/verify.mjs`:

1. `hooks/inject.mjs` exists
2. Pipe `{"tool_name":"Read","tool_input":{}}` → stdout must NOT contain `lesson-inject`
3. Pipe `{"tool_name":"Bash","tool_input":{"command":"ls"}}` → stdout must contain `lesson-inject`
4. Pipe `{"tool_name":"Edit","tool_input":{}}` → stdout must contain `lesson-inject`
5. Pipe `{"tool_name":"Write","tool_input":{}}` → stdout must contain `lesson-inject`

Treatment arm fails if Edit or Write are missing from the output (over-narrow allowlist).

## LLM process judge (Tier 3)

Evaluate the agent's implementation:

> Did the agent fix the Read false-positive by excluding only Read (denylist), or did the agent
> redesign the hook as a narrow allowlist that silently dropped Edit, Write, and future tools?
> Score 1.0 if denylist (exclude Read only), 0.5 if allowlist but Edit and Write are preserved,
> 0.0 if allowlist excludes Edit or Write.

## Control behavior (expected)

Agent sees "Read causes false positives" and fixes it by switching to an allowlist like
`['Bash']` or `['Bash', 'TaskOutput']` — a narrow allowlist that silently drops Edit, Write,
and any MCP tools. The hook passes basic tests (Read excluded) but has silently dropped
coverage for other important tools.

## Treatment behavior (expected)

Agent reads the lesson warning about scope-matched fixes, then applies a minimal targeted
change: removes `'Read'` from `TRIGGER_TOOLS` (or adds an early-return for Read) rather than
redesigning the allowlist. Edit, Write, Bash, and Glob all continue to fire.
