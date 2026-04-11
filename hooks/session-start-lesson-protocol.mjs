#!/usr/bin/env node

/**
 * SessionStart hook: Injects the #lesson self-reporting protocol into every session.
 *
 * On startup/resume: inject the protocol instruction.
 * On clear/compact: re-inject (context was lost).
 *
 * stdin: JSON with { hook_event_name, session_id }
 * stdout: raw text (Claude Code SessionStart convention — NOT JSON)
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, '..', 'data', 'lesson-manifest.json');

const LESSON_PROTOCOL = `# [lessons-learned] Lesson Reporting Protocol

When you encounter or recover from a mistake during this session, emit a structured
lesson tag in your response. This enables automatic capture for future prevention.

Format:
\`\`\`
#lesson
tool: <tool_name>
trigger: <what_command_or_action_triggered_the_issue>
mistake: <what_went_wrong_and_why>
fix: <the_correction_that_resolved_it>
tags: <comma_separated_category:value_tags>
#/lesson
\`\`\`

Example:
\`\`\`
#lesson
tool: Bash
trigger: git stash
mistake: git stash only stashes tracked modified files — untracked files are silently left behind, risking data loss
fix: Use \`git stash -u\` (or \`--include-untracked\`) to include untracked files
tags: tool:git, severity:data-loss
#/lesson
\`\`\`

Emit this tag naturally as part of your response whenever you:
- Discover why a tool call failed and apply a different approach
- Catch yourself about to repeat a known mistake
- Receive a user correction ("no", "wrong", "that's not right")
- Identify a root cause after debugging

Do NOT force lesson tags where none apply. Only tag genuine mistake→correction sequences.`;

function main() {
  try {
    readFileSync(0, 'utf8'); // consume stdin
  } catch {
    // If stdin is empty or malformed, still inject the protocol
  }

  // Inject on all session events — startup, resume, clear, compact all need the protocol
  // (clear and compact lose prior context, so re-injection is necessary)
  let output = LESSON_PROTOCOL;

  // Append reasoning/meta lessons flagged for session-start injection
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    const reasoningLessons = Object.values(manifest.lessons).filter(
      l => l.sessionStart === true && !l.disabled
    );

    if (reasoningLessons.length > 0) {
      output += '\n\n# [lessons-learned] Reasoning Reminders\n';
      for (const l of reasoningLessons) {
        output += `\n${l.message}\n`;
      }
    }
  } catch {
    // Manifest missing or unreadable — skip reasoning lessons silently
  }

  process.stdout.write(output);
}

main();
