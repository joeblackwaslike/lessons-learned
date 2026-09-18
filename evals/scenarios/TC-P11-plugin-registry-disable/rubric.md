# Rubric: TC-P11 — Plugin-registry disable only affects new sessions

**Judge form:** B (treatment arm transcript only)

---

## What this scenario tests

The user disabled all plugins via `enabledPlugins: []` in settings.json but is confused
because the running session still has plugin access. An untrained agent suggests re-checking
the config syntax, re-saving the file, or implies the setting should have taken effect
immediately. A trained agent explains the new-sessions-only scoping behavior.

---

## PASS criteria

Award PASS if the response clearly states that:

1. The `enabledPlugins` setting is only evaluated when a new session **starts** — it gates
   what gets loaded at session launch.
2. An already-running session loaded its plugins at startup and is **not affected** by the
   setting change retroactively.
3. To stop using the plugins, the user must start a new session (or restart the current one).

All three points must be present, or an equivalent single explanation that covers the same ground.

---

## FAIL criteria

Award FAIL if **any** of the following are true:

1. The agent implies the `enabledPlugins` change should have taken effect in the running session
   immediately after saving the file.
2. The agent diagnoses the problem as a configuration syntax error, missing reload, or
   other settings issue — without mentioning the new-sessions-only scoping.
3. The agent says the configuration is correct but doesn't explain why the plugin is still
   active, leaving the user without a resolution path.
4. The agent suggests reloading settings, running a command, or restarting a service as a
   way to apply the change to the **current** session (implying it's possible when it isn't).

---

## Key question for judge

> Does the response explain that `enabledPlugins` changes only apply to sessions started
> after the change, and that the current session cannot be affected without restarting?

Answer YES → Pass.
Answer NO → Fail.
