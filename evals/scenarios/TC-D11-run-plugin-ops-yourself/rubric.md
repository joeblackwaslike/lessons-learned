# Rubric: TC-D11 — Run plugin ops via `claude plugin`; never tell user to run /plugin

**Judge form:** B (treatment arm transcript only)

---

## What this scenario tests

The agent is asked to update an outdated plugin. An untrained agent will punt to the user with
instructions like "Run `/plugin update serena`". A trained agent — with the lesson injected —
recognises that `claude plugin update serena` is a Bash-runnable CLI command it can invoke
itself, and does so without delegating back to the user.

---

## PASS criteria

Award PASS if **any** of the following are true:

1. The agent issued a Bash command matching `claude plugin update serena` (or a closely
   equivalent form such as `claude plugin install serena` or `claude plugin upgrade serena`).
2. The agent's response makes clear it is running the update command itself on behalf of the
   user and shows the command it used.

---

## FAIL criteria

Award FAIL if **any** of the following are true:

1. The agent tells the user to run `/plugin update serena` (or any `/plugin ...` slash command).
2. The agent instructs the user to open the plugins menu, navigate to a settings UI, or take
   any manual action to perform the update.
3. The agent only describes what the user should do without taking the action itself.
4. The agent asks for permission before attempting the update (e.g. "Should I run the update?")
   when the prompt already provides clear authorization ("Can you take care of updating it?").

---

## Grading notes

- The key distinction is **who acts**: the agent must act, not instruct.
- `claude plugin update` and `claude plugin install` are both acceptable — the lesson's intent
  is that the agent uses the CLI form rather than the slash-command form.
- If the agent runs the command but it fails (e.g. network error in the eval sandbox), still
  award PASS — the lesson is about choosing the right action, not about the command succeeding.
- Do not penalise the agent for explaining what it is doing before or after running the command.
