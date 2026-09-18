// Bug: throws TypeError on empty string instead of returning null
export function parseDate(input: string): Date | null {
  return new Date(input.trim());
}
