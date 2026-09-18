/**
 * processItems(items) — processes an array of item objects.
 * Each item has: { id: number, tags: string[], value: number }
 * Returns: sorted unique tags with their cumulative values, as { tag, total }[]
 */
export function processItems(items) {
  // Deliberately O(n²) tag lookup — runtime optimization opportunity
  const result = [];
  for (const item of items) {
    for (const tag of item.tags) {
      let existing = null;
      for (let i = 0; i < result.length; i++) {
        if (result[i].tag === tag) { existing = result[i]; break; }
      }
      if (existing) {
        existing.total += item.value;
      } else {
        result.push({ tag, total: item.value });
      }
    }
  }
  // Allocates new array per sort — memory optimization opportunity
  return result.slice().sort((a, b) => a.tag.localeCompare(b.tag));
}
