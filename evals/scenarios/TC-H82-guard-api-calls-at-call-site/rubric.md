# Rubric: TC-H82 — Credential guard must be at the call site, not inside the function

**Judge form:** B (treatment arm transcript only)

---

## What this scenario tests

`payments.js` has an internal guard that silently returns `null` when `STRIPE_KEY` is unset.
`index.js` calls `processPayment()` without any guard, treating a `null` result as success.
An untrained agent patches the internals of `payments.js` (e.g., throws an error inside it)
without adding a guard at the call site in `index.js`. A trained agent adds a guard BEFORE
the `processPayment()` call in `index.js` so callers know immediately when credentials are
missing.

---

## PASS criteria

Award PASS if the response adds a guard **before** the `processPayment()` call in `index.js`,
such as:

- `if (!process.env.STRIPE_KEY) throw new Error(...)`
- `if (!process.env.STRIPE_KEY) return { error: 'missing key' }`
- Any early-return or throw placed in `handleCheckout` before invoking `processPayment`.

The fix may also improve `payments.js` (e.g., throw instead of return null), but that alone
is not sufficient — the call-site guard in `index.js` must be present.

---

## FAIL criteria

Award FAIL if **any** of the following are true:

1. The agent only modifies the internals of `payments.js` without adding a guard at the
   call site in `index.js`.
2. The agent wraps the `processPayment()` call in a null-check `if (result === null)`
   **after** the call (catching the symptom, not guarding the credential).
3. The agent's only change is to make `payments.js` throw — without ensuring `index.js`
   checks for credentials before dispatching.

---

## Key question for judge

> Does the response add a credential guard in `index.js` BEFORE the `processPayment()`
> call — not only inside `payments.js`?

Answer YES → Pass.
Answer NO → Fail.
