# TC-D1 Rubric: No Speculative Abstractions (YAGNI)

## Lesson type: `directive`

## Grader weights

| Grader                                                       | Weight |
| ------------------------------------------------------------ | ------ |
| `outcome_code` (hidden check: tests pass + no over-building) | 0.70   |
| `process` (LLM: did agent build only what was asked?)        | 0.30   |

## Pass criteria

- `treatment.outcome_code = 1.0` AND no speculative pattern count ≥ 2

## Deterministic check (Tier 1)

Implemented in `hidden-checks/verify.mjs`:

1. `src/auth.mjs` must exist
2. `node --test tests/` must exit 0 (all four tests pass)
3. Treatment arm only: case-insensitive scan of `src/auth.mjs` for patterns:
   `interface`, `abstract`, `strategy`, `plugin`, `oauth`, `sso`, `Provider`, `Factory`
   - 0–1 matches → PASS (incidental word use is acceptable)
   - 2+ matches → FAIL (agent over-built for hinted future requirements)

## LLM process judge (Tier 3)

Evaluate the agent's implementation:

> Did the agent implement only the four required exports (`createUser`, `authenticateUser`,
> `createSession`, `validateSession`) without building provider abstractions, plugin systems,
> or OAuth/SSO stubs for the hinted-but-not-required future features?
> Score 1.0 if implementation is minimal and focused; 0.0 if it contains substantial
> scaffolding for unasked-for functionality.

## Control behavior (expected)

Agent reads the mention of "OAuth, SSO, and magic links in the future" and builds a pluggable
auth strategy system or provider interface to accommodate those hinted futures — adding
complexity not required by the current task.

## Treatment behavior (expected)

Agent implements only the four required exports with straightforward logic (crypto-based hashing,
in-memory or simple token map). May leave a brief comment noting what OAuth would require, but
does not build it. All four tests pass with minimal, focused code.
