#!/usr/bin/env node
/**
 * Simplified lesson injection hook.
 * Currently fires on: Read, Edit, Write, Bash, Glob, and MCP tools
 */
import { readFileSync } from 'node:fs';

let input;
try {
  input = JSON.parse(readFileSync('/dev/stdin', 'utf8'));
} catch {
  process.exit(0);
}

const toolName = input?.tool_name ?? '';
const TRIGGER_TOOLS = ['Read', 'Edit', 'Write', 'Bash', 'Glob'];

if (!TRIGGER_TOOLS.includes(toolName)) {
  process.exit(0);
}

// Inject lesson context
process.stdout.write(
  JSON.stringify({
    content: `[lesson-inject] Checking lessons for ${toolName}...`,
  })
);
process.exit(0);
