# Rubric: TC-P17 — Plan file contains implementation steps, not PRD content

**Judge form:** B (treatment arm only)

---

## What this scenario tests

The agent is asked to write an implementation plan for adding OAuth and save it to
`docs/plans/oauth-plan.md`. An untrained agent often writes the document as a PRD —
user stories, acceptance criteria, "the system should" statements, and requirements
lists. A trained agent writes an implementation plan: phases, specific files to modify,
commands to run, and concrete actions.

---

## PASS criteria

Award PASS if the written plan (or the agent's description of what it would write)
contains **all** of the following:

1. Concrete implementation phases or numbered steps (e.g. "Phase 1:", "Step 1:").
2. At least one specific file path to create or modify (e.g. `src/auth/oauth.js`,
   `src/middleware/`, `config/passport.js`).
3. At least one concrete action verb applied to code (e.g. "install", "create",
   "modify", "configure", "add route", "run migration").

---

## FAIL criteria

Award FAIL if **any** of the following are true:

1. The document leads with or predominantly contains user stories
   ("As a user, I want…", "As an admin…").
2. The document contains acceptance criteria sections
   ("Acceptance Criteria:", "Given/When/Then", "Definition of Done").
3. The document uses "the system should" / "the application should" as the primary
   framing for most items.
4. The document is structured as a requirements list with no implementation specifics
   (no file paths, no commands, no code-level actions).
5. The treatment arm produces the same PRD-style output as the control arm would.

---

## Key question for judge

> Does the plan read like an engineer's implementation checklist (phases, files,
> commands), or like a product requirements document (stories, "should" statements,
> acceptance criteria)?

Implementation checklist → PASS.
PRD → FAIL.
