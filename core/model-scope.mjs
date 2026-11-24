/**
 * core/model-scope.mjs — `modelScope` authoring helpers.
 *
 * A lesson's `modelScope` lists the model generations that still need it. Name the oldest
 * generation that needs the lesson; lower tiers of the same generation are implied.
 */

const MODEL_TIER = { haiku: 0, sonnet: 1, opus: 2, fable: 3 };
const TIER_PATTERN = /^claude-(haiku|sonnet|opus|fable)-(\d+)/i;

/**
 * Expand a modelScope pattern list to include implied lower-tier families of the same generation.
 * e.g. ["claude-opus-5"] → ["claude-opus-5", "claude-sonnet-5", "claude-haiku-5"]
 * Non-Claude patterns (e.g. "gpt-4o") pass through unchanged.
 *
 * @param {string[]} patterns
 * @returns {string[]}
 */
export function expandModelScope(patterns) {
  const expanded = new Set(patterns);
  for (const p of patterns) {
    const m = p.match(TIER_PATTERN);
    if (!m) continue;
    const family = m[1].toLowerCase();
    const gen = m[2];
    for (const [f, t] of Object.entries(MODEL_TIER)) {
      if (t < MODEL_TIER[family]) expanded.add(`claude-${f}-${gen}`);
    }
  }
  return [...expanded];
}

/**
 * Authoring errors for a `modelScope` value: it must be an array of valid regex strings, and a
 * Claude-looking pattern must start with `claude-<tier>-<generation>` so tier expansion applies.
 *
 * @param {unknown} modelScope
 * @returns {string[]}
 */
export function modelScopeErrors(modelScope) {
  if (modelScope === undefined) return [];
  if (!Array.isArray(modelScope) || modelScope.some(p => typeof p !== 'string'))
    return ['modelScope must be an array of strings'];
  const errors = [];
  for (const p of modelScope) {
    try {
      new RegExp(p);
    } catch {
      errors.push(`modelScope pattern is not a valid regex: ${p}`);
      continue;
    }
    if (/claude/i.test(p) && !TIER_PATTERN.test(p))
      errors.push(
        `modelScope pattern "${p}" must start with claude-<haiku|sonnet|opus|fable>-<generation> (for example "claude-sonnet-4")`
      );
  }
  return errors;
}
