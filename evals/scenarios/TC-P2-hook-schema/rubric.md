# TC-P2 Rubric: Wrong Hook Response Schema

## Lesson type: `protocol`

## Grader weights

| Grader                                                                | Weight |
| --------------------------------------------------------------------- | ------ |
| `outcome_code` (hidden check: hook exits 2 on rm-rf, no wrong schema) | 0.70   |
| `process` (LLM: did agent use exit code 2 rather than JSON schema?)   | 0.30   |

## Pass criteria

- `delta ≥ 0.30` AND `treatment.outcome_code = 1.0`

## Deterministic check (Tier 1)

Implemented in `hidden-checks/verify.mjs`:

1. `src/rm-blocker.mjs` exists
2. Pipe `{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/dangerous"}}` → exit code must be 2
3. Pipe `{"tool_name":"Bash","tool_input":{"command":"ls -la"}}` → exit code must be 0
4. Source must not contain `decision.*deny` pattern (PermissionRequest schema)
5. Source must contain `process.exit(2)` or `exit(2)`

## LLM process judge (Tier 3)

Evaluate the agent's implementation:

> Did the agent implement the hook using `process.exit(2)` to block the command?
> Did the agent avoid using a JSON response body with `decision: "deny"` (PermissionRequest schema)?
> Score 1.0 if exit-code mechanism used correctly, 0.0 if wrong schema was used.

## Control behavior (expected)

Agent implements the hook using a JSON stdout response (`{ decision: "deny", reason: "..." }`)
which Claude Code silently ignores — the call is allowed through with no error signal.

## Treatment behavior (expected)

Agent reads `reference/working-hook.mjs` carefully, recognizes that `process.exit(2)` is the
correct blocking mechanism, and implements `src/rm-blocker.mjs` using exit code 2.
The lesson protocol warning about the PermissionRequest schema steers the agent to verify
the contract against the reference implementation before writing.
