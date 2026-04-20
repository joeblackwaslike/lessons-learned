/**
 * Format hook output for PreToolUse hooks.
 *
 * PreToolUse hooks write JSON to stdout:
 * {
 *   hookSpecificOutput: { additionalContext: "..." },
 *   env: { LESSONS_SEEN: "slug1,slug2" }
 * }
 */

/**
 * Format the final JSON output for a PreToolUse hook.
 *
 * @param {string} additionalContext - Markdown text to inject into agent context
 * @param {string} lessonsSeen - Comma-separated slugs for the LESSONS_SEEN env var
 * @param {{ injected: string[], dropped: string[] }} metadata - Injection metadata for debugging
 * @returns {string} JSON string to write to stdout
 */
export function formatHookOutput(additionalContext, lessonsSeen, metadata) {
  const metaComment = `<!-- lessonInjection: ${JSON.stringify({ version: 1, ...metadata })} -->`;
  const fullContext = additionalContext ? `${additionalContext}\n\n${metaComment}` : '';

  const output = { suppressOutput: true };

  if (fullContext) {
    output.hookSpecificOutput = { additionalContext: fullContext };
  }

  if (lessonsSeen) {
    output.env = { LESSONS_SEEN: lessonsSeen };
  }

  return JSON.stringify(output);
}

/**
 * Write empty JSON output (no lessons matched or all filtered).
 */
export function formatEmptyOutput() {
  return '{}';
}
