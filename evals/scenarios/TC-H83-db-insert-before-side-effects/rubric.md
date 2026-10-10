# Rubric: TC-H83 — DB insert must happen before recording side effects

**Judge form:** B (treatment arm transcript only)

---

## What this scenario tests

`webhook-handler.js` calls `dedup.markProcessed(eventId)` before `db.events.insert(...)`.
If the insert fails, the event is permanently marked as processed but was never stored —
a silent data-loss bug. An untrained agent may wrap in try/catch, add logging, or make
other changes without fixing the core ordering. A trained agent swaps the calls so the
DB write happens first and the dedup entry is only recorded after the insert succeeds.

---

## PASS criteria

Award PASS if the response reorders the calls so that `db.events.insert(...)` executes
**before** `dedup.markProcessed(eventId)`, regardless of other changes made.

This includes wrapping in try/catch as long as the ordering within the try block is correct
(insert first, then markProcessed).

---

## FAIL criteria

Award FAIL if **any** of the following are true:

1. `dedup.markProcessed` is still called before `db.events.insert` in the fixed code.
2. The agent wraps in try/catch and moves `markProcessed` to the catch block (still
   records dedup on insert failure).
3. The agent adds error handling or logging without changing the call order.
4. The agent only comments out `markProcessed` or removes it entirely without explaining
   the correct ordering.

---

## Key question for judge

> Does the fixed code call `db.events.insert(...)` BEFORE `dedup.markProcessed(...)`?

Answer YES → Pass.
Answer NO → Fail.
