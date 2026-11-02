export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return nextResolve(specifier, context);
  }
  const candidates = [specifier];
  if (specifier.endsWith('.js')) candidates.push(`${specifier.slice(0, -3)}.ts`);
  if (!/\.[a-z]+$/i.test(specifier)) candidates.push(`${specifier}.ts`);
  for (const candidate of candidates) {
    try {
      return await nextResolve(candidate, context);
    } catch (err) {
      if (candidate === candidates[candidates.length - 1]) throw err;
    }
  }
}
