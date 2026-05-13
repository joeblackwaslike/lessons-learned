// hooks/lib/output.mjs
// Shared output helpers for Claude Code hook handlers

/**
 * Write hook output to stdout as JSON.
 * @param {object} opts
 * @param {string} [opts.stderr]   - Text shown in the UI collapsible block
 * @param {number} [opts.exitCode] - 0 = allow tool call, 2 = block tool call
 */
export function writeOutput({ stderr = '', exitCode = 0 } = {}) {
  process.stdout.write(JSON.stringify({ stderr, exitCode }));
}
