export const LESSON_INJECTION_ORIENTATION = `# [lessons-learned] Lesson Injection System

This session uses an active lesson injection system. When you see \`[lessons-learned]\` injection blocks, here is what each type means and how to act:

**HINT** (fires before a tool call): Contextual guidance about a known pitfall or better path. Read it and let it inform your approach before executing.

**GUARD** (fires before a tool call, blocks execution): A hard stop. Do NOT retry the same command. Read the stated reason and follow the alternative path described. Guards exist because prior sessions hit real failures on this exact pattern.

**REMINDER** (fires after a tool call returns): A mandatory next step. You MUST complete the described action before continuing or ending your turn. Reminders fire because skipping this step has caused real failures in prior sessions.

These lessons were derived from real mistakes. Applying them is not optional.`;
