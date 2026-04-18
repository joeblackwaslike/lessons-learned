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
import { groupByTag } from './lib/session-start.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH =
  process.env.LESSONS_MANIFEST_PATH ?? join(__dirname, '..', 'data', 'lesson-manifest.json');

const LESSON_PROTOCOL = `# [lessons-learned] Lesson Reporting Protocol

When you encounter or recover from a mistake during this session, emit a structured
lesson tag in your response. This enables automatic capture for future prevention.

Format:
\`\`\`
#lesson
tool: <tool_name>
trigger: <what_command_or_action_triggered_the_issue>
problem: <what_went_wrong_and_why>
solution: <the_correction_that_resolved_it>
tags: <comma_separated_category:value_tags>
#/lesson
\`\`\`

Example:
\`\`\`
#lesson
tool: Bash
trigger: git stash
problem: git stash only stashes tracked modified files — untracked files are silently left behind, risking data loss
solution: Use \`git stash -u\` (or \`--include-untracked\`) to include untracked files
tags: tool:git, severity:data-loss
#/lesson
\`\`\`

Optional: add \`scope: project\` to restrict a lesson to the current project only (omit for global lessons that apply everywhere).

\`\`\`
#lesson
tool: Bash
trigger: just test
problem: project-specific just recipe leaks env vars
solution: Use \`just --set KEY val\` instead of export
tags: tool:just
scope: project
#/lesson
\`\`\`

Emit this tag naturally as part of your response whenever you:
- Discover why a tool call failed and apply a different approach
- Catch yourself about to repeat a known problem
- Receive a user correction ("no", "wrong", "that's not right")
- Identify a root cause after debugging

Do NOT force lesson tags where none apply. Only tag genuine problem→solution sequences.`;


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
      l => (l.type === 'protocol' || l.type === 'directive') && !l.disabled
    );

    const directives = reasoningLessons
      .filter(l => l.type === 'directive')
      .sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5));
    const protocols = reasoningLessons
      .filter(l => l.type === 'protocol')
      .sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5));

    if (directives.length > 0) {
      output += '\n\n## Non-Negotiable Directives\n\n';
      output += '<IMPORTANT>\n';
      output += 'These are non-negotiable rules derived from real failures with measurable cost. ';
      output += 'Applying them is not optional — each one prevented a real incident. ';
      output += 'Skipping a rule to save time has caused real incidents.\n';
      output += '</IMPORTANT>\n';
      const dGroups = groupByTag(directives);
      const useHeaders = dGroups.length > 1;
      for (const [tag, group] of dGroups) {
        if (useHeaders) output += `\n### ${tag}\n`;
        for (const l of group) output += `\n${l.message}\n`;
      }
    }

    if (protocols.length > 0) {
      output += '\n\n---\n\n## Active Protocols\n\n';
      output += 'The following protocols capture hard-won coordination patterns. ';
      output += 'Apply before starting work in the relevant context — they save time, tokens, and turmoil.\n';
      const pGroups = groupByTag(protocols);
      const useHeaders = pGroups.length > 1;
      for (const [tag, group] of pGroups) {
        if (useHeaders) output += `\n### ${tag}\n`;
        for (const l of group) output += `\n${l.message}\n`;
      }
    }
  } catch {
    // Manifest missing or unreadable — skip reasoning lessons silently
  }

  process.stdout.write(output);
}

main();
