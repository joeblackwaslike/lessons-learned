export const LESSON_INJECTION_ORIENTATION = `# [lessons-learned] Lesson Injection System

This session uses an active lesson injection system. When you see \`[lessons-learned]\` injection blocks, here is what each type means and how to act:

**HINT** (fires before a tool call): Contextual guidance about a known pitfall or better path. Read it and let it inform your approach before executing.

**GUARD** (fires before a tool call, blocks execution): A hard stop. Do NOT retry the same command. Read the stated reason and follow the alternative path described. Guards exist because prior sessions hit real failures on this exact pattern.

**REMINDER** (fires after a tool call returns): A mandatory next step. You MUST complete the described action before continuing or ending your turn. Reminders fire because skipping this step has caused real failures in prior sessions.

These lessons were derived from real mistakes. Applying them is not optional.`;

export const LESSON_PROTOCOL = `# [lessons-learned] Lesson Reporting Protocol

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
