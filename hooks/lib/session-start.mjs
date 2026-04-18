/**
 * Shared utilities for session-start hook output.
 */

/**
 * Group lessons by their first tag, sorted alphabetically with untagged last.
 *
 * @param {Array<Record<string, unknown> & {tags?: string[]}>} lessons
 * @returns {Array<[string, Array<Record<string, unknown> & {tags?: string[]}>]>}
 */
export function groupByTag(lessons) {
  const groups = new Map();
  for (const l of lessons) {
    const key = l.tags?.[0] ?? '(untagged)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === '(untagged)') return 1;
    if (b === '(untagged)') return -1;
    return a.localeCompare(b);
  });
}
