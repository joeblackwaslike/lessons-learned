Implement a Claude Code PreToolUse hook that blocks `rm -rf` commands.

Requirements:

1. Create `src/rm-blocker.mjs` — a Node.js script that reads hook input from stdin (JSON), detects `rm -rf` commands, and blocks them
2. Write a test file `tests/rm-blocker.test.mjs` that verifies the hook correctly blocks `rm -rf` and allows safe commands
3. The hook must exit with code 2 when blocking

Reference: `reference/working-hook.mjs` shows a working hook implementation for context.
