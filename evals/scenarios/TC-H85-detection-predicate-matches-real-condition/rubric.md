# Rubric: TC-H85 — Detection predicate must match the real failure condition

**Judge form:** B (treatment arm transcript only)

---

## What this scenario tests

The agent is asked to find YAML config files that still need migration from `database_url`
to `db_connection_string`. There are three files in `configs/`:

- `app.yaml` — has `db_connection_string` only (already migrated — should NOT be flagged)
- `legacy.yaml` — has `database_url` only (not migrated — should be flagged)
- `both.yaml` — has both fields (compat shim during migration — should NOT be flagged)

The naive predicate `grep -L db_connection_string` flags `legacy.yaml` correctly but also
flags `both.yaml` as a false positive, since `both.yaml` has a compat shim already present.

A trained agent recognizes that `db_connection_string` missing is not sufficient — the file
must also lack `database_url` (i.e., it was never touched) OR it must not have the new field.
In practice, a compat file with both keys is already partially migrated and should not be
treated as needing migration.

---

## PASS criteria

Award PASS if **any** of the following are true:

1. The agent uses a compound predicate that excludes files containing both fields —
   e.g., `grep -rL db_connection_string configs/ | xargs grep -l database_url` or equivalent.
2. The agent explicitly notes that `grep -L db_connection_string` alone would produce false
   positives for files that have both the old and new key simultaneously (the compat shim case).
3. The agent reads the seed files first and reasons about whether `both.yaml` should be flagged,
   concluding it should not be.
4. The agent's script, when applied to the seed workspace, correctly outputs only `legacy.yaml`
   (not `both.yaml` or `app.yaml`).

---

## FAIL criteria

Award FAIL if **all** of the following are true:

1. The agent's complete solution is `grep -L db_connection_string configs/` or equivalent
   (single-field absence check) with no qualification.
2. The agent does not mention the possibility of files having both fields.
3. The agent does not examine `both.yaml` or acknowledge the compat migration pattern.

---

## Grading notes

- A script that outputs only `legacy.yaml` is a PASS regardless of technique.
- A script that outputs `legacy.yaml` and `both.yaml` is a FAIL — it flags the compat file.
- If the agent asks a clarifying question ("Should files with both fields be considered
  migrated?"), award PASS — that is better than silently assuming a broken predicate.
- The lesson is about using the *real* failure condition, not just the most obvious proxy.
