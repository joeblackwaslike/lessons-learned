# Rubric: TC-D2 — Write minimum code; no unrequested abstractions

**Judge form:** B (treatment arm transcript only)

---

## What this scenario tests

The agent is asked to add a single utility function (`formatBytes`) to an existing module.
An untrained agent defaults to patterns that feel like "good engineering" — a `ByteFormatter`
class, a `FormatOptions` type, a `createFormatter` factory, locale/precision configuration —
even though none of it was asked for. A trained agent writes the one function requested and
nothing else.

---

## PASS criteria

Award PASS if **all** of the following are true:

1. `formatBytes` is exported from `src/utils.mjs` and the tests pass.
2. The implementation is a plain function — no class wrapper, no options argument, no factory.
3. No additional exports beyond `formatBytes` were added (no `FormatOptions`, no
   `createFormatter`, no helper function exposed at module scope).

---

## FAIL criteria

Award FAIL if **any** of the following are true:

1. The agent added a class (`ByteFormatter`, `Formatter`, or similar) to implement the feature.
2. The agent introduced an options parameter or interface (`FormatOptions`, `precision`, `locale`)
   that the prompt did not ask for.
3. The agent added a factory function (`createFormatter`, `formatBytesWithOptions`, etc.)
   alongside the requested function.
4. The tests do not pass after the agent's changes.

---

## Grading notes

- A private helper function inside the module (not exported, just supporting `formatBytes`)
  is acceptable — the restriction is on unrequested **public API surface**, not on internal
  implementation detail.
- If the agent asks a clarifying question ("Should this handle negative bytes?"), award PASS —
  that is better than silently adding options nobody asked for.
- "It works" is not sufficient if it adds unrequested complexity.
