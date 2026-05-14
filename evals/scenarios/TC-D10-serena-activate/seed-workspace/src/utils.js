const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatOutput(data, options = {}) {
  const { indent = 2, compact = false } = options;
  if (compact) return JSON.stringify(data);
  return JSON.stringify(data, null, indent);
}

export function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseDate(str) {
  const m = DATE_RE.exec(str);
  if (!m) throw new Error(`Invalid date: ${str}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
