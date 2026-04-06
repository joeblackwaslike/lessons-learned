/**
 * core/match.mjs — Agent-agnostic lesson matching.
 *
 * Pure function: no I/O, no process.exit, no platform assumptions.
 * Given a manifest's lessons object + tool context, returns ranked matches.
 *
 * Adapters (Claude Code, Codex, Gemini) call this then handle platform I/O.
 */

/**
 * @typedef {{ id?: string, slug: string, priority: number, injection: string, summary: string, block: boolean, blockReason: string|null }} Match
 */

/**
 * Match lessons against a tool invocation.
 *
 * @param {object} lessons - The `manifest.lessons` object (keyed by lesson ID)
 * @param {string} toolName - Platform tool name (e.g. "Bash", "Read")
 * @param {string} command  - Shell command string (for Bash-type tools)
 * @param {string} filePath - File path (for Read/Edit/Write-type tools)
 * @returns {Match[]} Matches sorted by priority descending
 */
export function matchLessons(lessons, toolName, command, filePath) {
  const matches = [];

  for (const [id, lesson] of Object.entries(lessons)) {
    const toolNames = lesson.toolNames ?? [];
    if (!toolNames.includes(toolName)) continue;

    let matched = false;

    if (command && Array.isArray(lesson.commandRegexSources)) {
      for (const regexDef of lesson.commandRegexSources) {
        try {
          const re = new RegExp(regexDef.source, regexDef.flags ?? '');
          if (re.test(command)) {
            matched = true;
            break;
          }
        } catch {
          // Invalid regex in manifest — skip
        }
      }
    }

    if (filePath && Array.isArray(lesson.pathRegexSources)) {
      for (const regexDef of lesson.pathRegexSources) {
        try {
          const re = new RegExp(regexDef.source, regexDef.flags ?? '');
          if (re.test(filePath)) {
            matched = true;
            break;
          }
        } catch {
          // Invalid regex in manifest — skip
        }
      }
    }

    if (matched) {
      matches.push({
        id,
        slug: lesson.slug ?? id,
        priority: lesson.priority ?? 5,
        injection: lesson.injection ?? '',
        summary: lesson.summary ?? '',
        block: lesson.block ?? false,
        blockReason: lesson.blockReason ?? null,
      });
    }
  }

  matches.sort((a, b) => b.priority - a.priority);
  return matches;
}

/**
 * Find the first blocking lesson in a match list, if any.
 * Substitutes `{command}` in the blockReason with the actual command (capped at 120 chars).
 *
 * @param {Match[]} matches
 * @param {string} command
 * @returns {{ reason: string } | null}
 */
export function findBlocker(matches, command) {
  const blocker = matches.find(m => m.block && m.blockReason);
  if (!blocker) return null;
  return { reason: blocker.blockReason.replace('{command}', command.slice(0, 120)) };
}
