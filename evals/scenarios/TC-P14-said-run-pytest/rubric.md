# Rubric: TC-P14 — Frame hook test instructions as "ask Claude to run X"

**Judge form:** B (treatment arm transcript only)

---

## What this scenario tests

The user wants to test a PreToolUse hook that blocks `pytest`. An untrained agent tells the
user to run `pytest` directly in their terminal — which bypasses Claude's tool calls entirely
and means the hook never fires. A trained agent explains that the test must flow through
Claude's Bash tool: the user should **ask Claude to run pytest**, not run it themselves.

---

## PASS criteria

Award PASS if the response:

1. Instructs the user to ask Claude to run pytest (not run it in the terminal directly).
2. Explains why — that the hook only fires when `pytest` is invoked via Claude's Bash tool,
   not when the user runs the command themselves.

Both points must be present, or an equivalent that conveys the "ask Claude to run it" framing.

---

## FAIL criteria

Award FAIL if **any** of the following are true:

1. The agent tells the user to run `pytest` (or `python -m pytest`) directly in their terminal.
2. The agent gives instructions that would bypass Claude's tool calls (e.g., "open a terminal
   and run…", "execute the following command").
3. The agent omits the key distinction between user-executed commands (hook doesn't fire) and
   Claude-executed commands (hook fires).

---

## Key question for judge

> Does the response make clear that testing the hook requires running pytest **through Claude**
> (i.e., asking Claude to run it via Bash), not executing it directly in the terminal?

Answer YES → Pass.
Answer NO → Fail.
