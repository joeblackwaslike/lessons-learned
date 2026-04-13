# Lesson Type Examples

Reference document showing 3 representative examples per lesson type.

---

## `hint` — PreToolUse context injection

Injected as `additionalContext` when a trigger matches. Informs without blocking.

### 1. Parallel agents corrupting a shared git worktree

**Mistake:** Multiple concurrent git processes writing to the same worktree corrupt the index and lose commits silently.

**Fix:** Each parallel agent must use an isolated git worktree via `git worktree add`; never share a worktree between concurrent agents.

---

### 2. `eval` on user-supplied strings enables shell injection

**Mistake:** `eval "$cmd"` interprets shell metacharacters from untrusted input; an attacker-controlled value can execute arbitrary commands.

**Fix:** Replace `eval` with `bash -c` for subprocess isolation or use array-based invocation: `cmd_arr=(...); "${cmd_arr[@]}"`.

---

### 3. Secrets hardcoded in source files are permanently exposed

**Mistake:** API keys, passwords, or tokens written directly into `.py`/`.js` files and committed to git are irreversibly exposed in history.

**Fix:** Use environment variables, `.env` files (in `.gitignore`), or a secrets manager. Rotate any credential that was committed.

---

## `guard` — Tool call denial

Blocks the tool call entirely and surfaces a corrective message. Use only when executing the command as written would cause immediate, hard-to-reverse harm.

### 1. pytest hangs in non-interactive environments

**Mistake:** Running bare `pytest` or `pytest -v` in Claude Code causes the process to hang indefinitely because pytest's rich output module detects a non-interactive terminal and stalls.

**Fix:** Use `python -m pytest --no-header -rN -p no:faulthandler` or prepend `TERM=dumb`. Pipe through `cat` if rich output is still suspected.

> _Note: Only one guard lesson currently exists — this type should be reserved for high-certainty, high-severity hangs or destructive operations._

---

## `protocol` — Session-start reasoning reminders

Injected once at session start. Used for meta-cognitive corrections — situations where the mistake is in how Claude reasons, not in what tool it uses.

### 1. Subagents may not have access to the Bash tool

**Mistake:** Subagents spawned via the Agent tool may have a restricted tool set. Attempting to use `Bash` when unavailable produces `Error: No such tool available: Bash`, wasting a turn and breaking the workflow.

**Fix:** Before assuming Bash is available, check the agent context. Use Read/Grep/Glob for file operations and only fall back to Bash for commands that truly require shell execution.

---

### 2. Wrong hook response schema is silently ignored

**Mistake:** Used `{ decision: "deny", reason, systemMessage }` (PermissionRequest schema) instead of the correct `hookSpecificOutput` shape — Claude Code silently ignored the unknown schema and executed anyway, giving no error signal.

**Fix:** Always read the compiled source of a working plugin before implementing an underdocumented protocol, and write a schema assertion test so a wrong contract fails loudly instead of silently.

---

### 3. Overfitting a fix to a narrow observation

**Mistake:** Observed that Read tool results caused false positives, then jumped from "exclude Read" to "only allow Bash/TaskOutput" — an allowlist that silently dropped MCP tools, Edit, Write, and all future tools not explicitly listed.

**Fix:** Match the scope of the fix to the scope of the observation. If the problem is "X is noisy," exclude X — don't redesign around the absence of X.

---

## `directive` — Session-start AND PreToolUse injection

Fires both at startup (as a standing principle) and on matched tool calls (as a contextual reminder). Use for principles that should govern broad categories of behavior throughout a session.

### 1. Speculative abstractions accumulate faster than they can be repaid

**Problem:** Code generation without explicit principle constraints produces speculative abstractions, premature flexibility, mixed responsibilities, and future-requirement implementations that accumulate technical debt faster than it can be repaid.

**Solution:** Follow SOLID, YAGNI, and KISS principles in all code generation. Do not add features, abstractions, or complexity not demanded by the current requirements. Every added element must earn its place against immediate need.

---

### 2. Implementing before requirements are clear produces solutions to the wrong problem

**Problem:** Jumping to implementation before requirements are clear produces solutions to the wrong problem, forces costly rewrites, and locks in architectural decisions that should have been made with fuller context.

**Solution:** Do not write code until requirements are clearly established and agreed upon. Probe for business context, constraints, and edge cases first. A well-understood problem is 80% of the solution.

---

### 3. Solo-authored plans are full of unvalidated assumptions

**Problem:** Plans built without the user's input are full of unvalidated assumptions. Early wrong assumptions compound — every downstream decision built on them is invalid. Reviewing a solo-authored plan shifts correction work onto the user, who must trace cascading errors root-to-leaf instead of preventing them with upfront dialogue.

**Solution:** Before planning anything, collaborate first. Explore context, ask clarifying questions one at a time, propose 2–3 approaches with trade-offs, and get approval on each design section before moving forward. Never present a completed plan as a fait accompli — the user is a required input to the design, not a reviewer of the output.
