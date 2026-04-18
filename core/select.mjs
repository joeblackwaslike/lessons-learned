/**
 * core/select.mjs — Agent-agnostic lesson selection with budget enforcement.
 *
 * Pure function: no I/O, no platform assumptions.
 * Takes ranked matches + a seen set + options, returns what to inject.
 *
 * The `claimFn` parameter is injected by the adapter — it provides whatever
 * atomicity guarantee the platform supports (O_EXCL files for Claude Code,
 * a no-op for single-agent platforms, Redis for distributed agents).
 */

/**
 * @typedef {{ slug: string, text: string }} Injected
 * @typedef {{ injected: Injected[], dropped: string[], seen: Set<string> }} SelectResult
 */

/**
 * Select lessons to inject, enforcing dedup, priority cap, and byte budget.
 *
 * @param {import('./match.mjs').Match[]} matches - Ranked matches (priority desc)
 * @param {Set<string>} seenSet - Slugs already seen this session
 * @param {object} opts
 * @param {number} [opts.maxLessons] - Max lessons per injection (default 3)
 * @param {number} [opts.budgetBytes] - Max total bytes to inject (default 4096)
 * @param {(slug: string) => boolean} opts.claimFn - Returns true if this invocation wins the claim
 * @returns {SelectResult}
 */
export function selectCandidates(
  matches,
  seenSet,
  { maxLessons = 3, budgetBytes = 4096, claimFn }
) {
  const seen = new Set(seenSet);
  const unseen = matches.filter(m => !seen.has(m.slug));

  const candidates = unseen.slice(0, maxLessons);

  const injected = [];
  const dropped = [];
  let remainingBudget = budgetBytes;

  for (const lesson of candidates) {
    if (!claimFn(lesson.slug)) {
      dropped.push(lesson.slug);
      continue;
    }

    const text = lesson.message;
    const textBytes = Buffer.byteLength(text, 'utf8');

    if (injected.length === 0) {
      // First lesson always included regardless of budget
      injected.push({ slug: lesson.slug, text });
      remainingBudget -= textBytes;
      seen.add(lesson.slug);
    } else if (textBytes <= remainingBudget) {
      injected.push({ slug: lesson.slug, text });
      remainingBudget -= textBytes;
      seen.add(lesson.slug);
    } else {
      const citationParts = [`**Lesson**: ${lesson.summary}`];
      if (lesson.problem) citationParts.push(`**Problem**: ${lesson.problem.split('\n')[0].slice(0, 200)}`);
      if (lesson.solution) citationParts.push(`**Solution**: ${lesson.solution.split('\n')[0].slice(0, 200)}`);
      const summaryText = citationParts.join('\n');
      const summaryBytes = Buffer.byteLength(summaryText, 'utf8');
      if (lesson.summary && summaryBytes <= remainingBudget) {
        injected.push({ slug: lesson.slug, text: summaryText });
        remainingBudget -= summaryBytes;
        seen.add(lesson.slug);
      } else {
        dropped.push(lesson.slug);
      }
    }
  }

  return { injected, dropped, seen };
}
