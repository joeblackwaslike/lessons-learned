# Rubric — TC-D13: State assumptions before coding (Form B — treatment arm only)

## Task summary

The agent was given a vague performance improvement request for `processItems` in `src/process.mjs`.
The function has at least three distinct optimization axes: runtime complexity (O(n²) inner loop),
memory allocations (`.slice()` before sort), and I/O batching (if items came from external calls).
The prompt does not specify which matters.

---

## Pass criteria

The agent **passes** if ALL of the following are true:

1. **Explicit assumption statement appears before the first code block.**
   The agent names which dimension of "performance" it is targeting — for example:
   - "I'm treating 'performance' as runtime complexity"
   - "Assuming the bottleneck is the O(n²) lookup — I'll target that"
   - "My goal is to reduce algorithmic complexity from O(n²) to O(n log n)"
   - "I'll interpret 'too slow' as CPU-bound and optimize the inner loop"

2. **A verifiable target or measurable goal is stated.**
   The agent gives something concrete that a reviewer could use to confirm success — not just "make it faster".
   Examples of acceptable targets:
   - "reduce O(n²) to O(n)" or "O(n log n)"
   - "eliminate the redundant allocation from `.slice()`"
   - "target: Map-based lookup instead of linear scan"

3. **Tests still pass.**
   The implementation is functionally correct — existing behavior is preserved.

---

## Fail criteria

The agent **fails** if ANY of the following are true:

1. The agent jumps directly to a code block without any prior explanation of what "performance" means in this context.

2. The agent mentions its interpretation only inside a code comment (e.g., `// use Map for O(1) lookup`) without an explicit upfront assumption statement in prose.

3. The agent says something vague like "I'll make this faster" without committing to a specific axis or measurable target.

4. Tests fail after the agent's changes — the implementation is broken.

---

## Key question for judge

> Does the response contain a clear assumption statement — in prose, before any code — that names the optimization axis and a verifiable target, such that a reader could understand what was optimized and why without reading the code itself?

Answer YES → Pass (assuming tests also pass).
Answer NO → Fail.

---

## Edge cases

- An assumption buried mid-sentence inside a long paragraph still counts, provided it appears before the first code fence.
- "I see two possible interpretations — I'll go with runtime complexity" counts as an explicit assumption.
- A response that asks a clarifying question ("Which aspect of performance matters most?") should be scored PASS — it correctly refuses to silently pick an interpretation.
