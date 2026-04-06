/**
 * Normalize agent-specific tool names to canonical Claude Code tool names.
 *
 * Different coding agents use different names for equivalent tools:
 *   CC (Claude Code): Bash, Read, Edit, Write, Glob
 *   Codex:            shell, read_file, apply_patch, write_file, find_files
 *   Gemini CLI:       run_shell_command, read_file, replace_in_file, write_file, find_files
 *
 * The injection pipeline operates on CC canonical names throughout. Tool name
 * normalization happens once at the stdin parse boundary.
 */

/** @type {Record<string, string>} */
const CODEX_MAP = {
  shell: 'Bash',
  read_file: 'Read',
  apply_patch: 'Edit',
  write_file: 'Write',
  find_files: 'Glob',
};

/** @type {Record<string, string>} */
const GEMINI_MAP = {
  run_shell_command: 'Bash',
  read_file: 'Read',
  replace_in_file: 'Edit',
  write_file: 'Write',
  find_files: 'Glob',
};

/** @type {Record<string, Record<string, string>>} */
const PLATFORM_MAPS = {
  codex: CODEX_MAP,
  gemini: GEMINI_MAP,
};

/**
 * Map a raw tool name to its canonical CC equivalent.
 * Returns the input unchanged for CC (pass-through) or unknown tool names.
 *
 * @param {string} rawName
 * @param {string} platform - 'cc' | 'codex' | 'gemini'
 * @returns {string}
 */
export function normalizeToolName(rawName, platform) {
  const map = PLATFORM_MAPS[platform];
  if (!map) return rawName;
  return map[rawName] ?? rawName;
}
