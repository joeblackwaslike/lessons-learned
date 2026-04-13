#!/usr/bin/env node

/**
 * SubagentStart hook: Injects a compact version of the #lesson self-reporting
 * protocol into spawned subagents.
 *
 * Subagents have smaller context budgets, so we use a shorter instruction.
 *
 * stdin: JSON with { session_id, agent_id, prompt, ... }
 * stdout: raw text injected as additional context for the subagent
 */

import { readFileSync } from 'node:fs';

const LESSON_PROTOCOL_COMPACT = `# [lessons-learned] Lesson Reporting

When you encounter or recover from a problem, emit:
\`\`\`
#lesson
tool: <tool_name>
trigger: <what_triggered_it>
problem: <what_went_wrong>
solution: <the_correction>
tags: <category:value, ...>
#/lesson
\`\`\`
Only tag genuine problem→solution sequences.`;

function main() {
  try {
    readFileSync(0, 'utf8');
  } catch {
    // consume stdin
  }

  process.stdout.write(LESSON_PROTOCOL_COMPACT);
}

main();
