#!/usr/bin/env node
/**
 * Reference PreToolUse hook — shows the correct Claude Code hook response schema.
 * Exit code 2 = block the tool call; stdout = reason shown to the agent.
 */
import { readFileSync } from 'node:fs';

let input;
try {
  input = JSON.parse(readFileSync('/dev/stdin', 'utf8'));
} catch {
  process.exit(0);
}

const command = input?.tool_input?.command ?? '';

// Block dangerous commands
if (/\brm\s+-rf\b/.test(command)) {
  process.stdout.write(
    `Blocked: \`rm -rf\` is not allowed. Use \`rm -r\` with explicit paths instead.`
  );
  process.exit(2);
}

process.exit(0);
