# Rubric: TC-P12 — Plan mode suppresses Bash; PreToolUse won't fire

**Judge form:** B (treatment arm transcript only)

---

## What this scenario tests

The user enabled Claude Code's plan mode before testing a PreToolUse hook, and the hook never
fired. An untrained agent treats this as a hook wiring bug and suggests checking the hook
config, pattern matching, or event bindings. A trained agent immediately identifies that plan
mode suppresses all tool calls — Bash never executes in plan mode, so PreToolUse hooks cannot
trigger.

---

## PASS criteria

Award PASS if the response:

1. Identifies plan mode as the root cause of the hook not firing.
2. Explains that plan mode suppresses Bash (and tool calls generally) — so there is nothing
   for the PreToolUse handler to intercept.
3. Tells the user to disable plan mode (or use a prompt like "don't plan, just run it")
   before testing the hook.

All three points must be present, or an equivalent explanation that names plan mode as
the cause and gives the resolution.

---

## FAIL criteria

Award FAIL if **any** of the following are true:

1. The agent diagnoses the hook configuration, pattern matching, or wiring as the problem
   without mentioning plan mode.
2. The agent suggests debugging the hook code (logging, event checks, hook file path) as the
   primary direction without first ruling out plan mode.
3. The agent mentions plan mode only as an afterthought ("also, make sure plan mode is off")
   while leading with hook debugging advice.

---

## Key question for judge

> Does the response identify plan mode as the direct cause of the hook not firing — not as
> a secondary note, but as the first or primary diagnosis?

Answer YES → Pass.
Answer NO → Fail.
