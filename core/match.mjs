/**
 * core/match.mjs — Agent-agnostic lesson matching.
 *
 * Pure function: no I/O, no process.exit, no platform assumptions.
 * Given a manifest's lessons object + tool context, returns ranked matches.
 *
 * Adapters (Claude Code, Codex, Gemini) call this then handle platform I/O.
 */

/**
 * @typedef {{ id?: string, slug: string, type: string, priority: number, message: string, summary: string, problem: string, solution: string }} Match
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
/**
 * Strip single- and double-quoted string contents from a shell command,
 * leaving only the executable tokens (command name, flags, unquoted args).
 * Used for `commandMatchTarget: "executable"` to prevent guards from firing
 * on quoted argument values that happen to contain a trigger keyword.
 *
 * @param {string} command
 * @returns {string}
 */
function stripQuotedStrings(command) {
  return command.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

function anyRegexMatches(regexSources, target) {
  for (const regexDef of regexSources) {
    try {
      const re = new RegExp(regexDef.source, regexDef.flags ?? '');
      if (re.test(target)) return true;
    } catch {
      // Invalid regex in manifest — skip
    }
  }
  return false;
}

/**
 * @param {object} lessons
 * @param {string} toolName
 * @param {string} command  - Bash command (command invocations)
 * @param {string} filePath - File path (Edit/Write/Read invocations)
 * @param {string|null} projectId
 * @param {string} content  - Edit `new_string` / Write `content` (the edit payload).
 *   For path-tool invocations, `commandPatterns` are tested against this and
 *   AND-combined with `pathPatterns`, so a content-specific lesson fires only
 *   when the edit actually contains the pattern — not on every matching file.
 */
export function matchLessons(lessons, toolName, command, filePath, projectId = null, content = '') {
  const matches = [];

  for (const [id, lesson] of Object.entries(lessons)) {
    if (lesson.disabled) continue;

    // Skip scoped lessons that don't match the current project
    if (lesson.scope && lesson.scope !== projectId) continue;

    const toolNames = lesson.toolNames ?? [];
    if (!toolNames.includes(toolName)) continue;

    const cmdSources = Array.isArray(lesson.commandRegexSources) ? lesson.commandRegexSources : [];
    const pathSources = Array.isArray(lesson.pathRegexSources) ? lesson.pathRegexSources : [];
    const hasCmd = cmdSources.length > 0;
    const hasPath = pathSources.length > 0;
    const executable = lesson.commandMatchTarget === 'executable';

    let matched;
    if (!hasCmd && !hasPath) {
      // Tool-name-only match (e.g. MCP tool lessons) — toolName alone suffices.
      matched = true;
    } else if (command) {
      // Command invocation (Bash): only commandPatterns apply; pathPatterns are
      // for file-path tools and cannot be evaluated here. A path-only lesson
      // therefore does not fire on a command invocation.
      const target = executable ? stripQuotedStrings(command) : command;
      matched = hasCmd && anyRegexMatches(cmdSources, target);
    } else if (filePath) {
      // Path invocation (Edit/Write/Read): pathPatterns gate the path AND
      // commandPatterns gate the edit content. Each is vacuously satisfied when
      // the lesson omits it.
      const pathOk = !hasPath || anyRegexMatches(pathSources, filePath);
      const contentTarget = executable ? stripQuotedStrings(content) : content;
      const contentOk = !hasCmd || (Boolean(content) && anyRegexMatches(cmdSources, contentTarget));
      matched = pathOk && contentOk;
    } else {
      // No command and no file path — a pattern-bearing lesson cannot match.
      matched = false;
    }

    // modelRegexSources is an AND gate: if non-empty, at least one must match
    // the command OR file path. This gates model-specific lessons to contexts
    // where the target model is actually referenced.
    if (matched && lesson.modelRegexSources?.length) {
      const modelTarget = command || content || filePath;
      let modelMatched = false;
      for (const regexDef of lesson.modelRegexSources) {
        try {
          const re = new RegExp(regexDef.source, regexDef.flags ?? '');
          if (re.test(modelTarget)) {
            modelMatched = true;
            break;
          }
        } catch {
          // Invalid regex in manifest — skip
        }
      }
      if (!modelMatched) matched = false;
    }

    if (matched) {
      matches.push({
        id,
        slug: lesson.slug ?? id,
        type: lesson.type ?? 'hint',
        priority: lesson.priority ?? 5,
        message: lesson.message ?? '',
        summary: lesson.summary ?? '',
        problem: lesson.problem ?? '',
        solution: lesson.solution ?? '',
      });
    }
  }

  matches.sort((a, b) => b.priority - a.priority);
  return matches;
}

/**
 * Find the first blocking lesson in a match list, if any.
 * Substitutes `{command}` in the message with the actual command (capped at 120 chars).
 *
 * @param {Match[]} matches
 * @param {string} command
 * @returns {{ reason: string } | null}
 */
export function findBlocker(matches, command) {
  const blocker = matches.find(m => m.type === 'guard');
  if (!blocker) return null;
  return { reason: blocker.message.replace('{command}', command.slice(0, 120)) };
}
