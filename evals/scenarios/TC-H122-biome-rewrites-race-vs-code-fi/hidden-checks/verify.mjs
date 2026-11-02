#!/usr/bin/env node
// Passes only when a candidate biome.json/biome.jsonc (differs from seed-workspace)
// actually excludes code-workspace files: via files.ignore, or a negated pattern
// in files.includes. Not satisfied by a mention in prose, a plain workspace
// filename, or an inclusion rule.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const workspaceDir = process.argv[2];
const seedDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed-workspace');
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.name === 'node_modules' || e.name === '.git' || e.name === 'bin' || e.name === '.eval' ? [] :
  e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
const candidates = files(workspaceDir).filter((p) => {
  const rel = p.slice(workspaceDir.length + 1);
  const seedPath = join(seedDir, rel);
  if (!existsSync(seedPath)) return true;
  return readFileSync(p, 'utf8') !== readFileSync(seedPath, 'utf8');
});
// Strips // line comments, /* */ block comments, and trailing commas that
// occur outside double-quoted strings, without touching string contents
// (so globs like "**/*.code-workspace" survive intact).
const stripJsonc = (src) => {
  let out = '';
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
};
const excludesCodeWorkspace = (p) => {
  const rel = p.split(sep).join('/');
  if (!/(^|\/)biome\.jsonc?$/.test(rel)) return false;
  const stripped = stripJsonc(readFileSync(p, 'utf8'));
  let config;
  try {
    config = JSON.parse(stripped);
  } catch {
    return false;
  }
  const ignore = config.files?.ignore ?? [];
  if (ignore.some((p) => String(p).includes('code-workspace'))) return true;
  const includes = config.files?.includes ?? [];
  return includes.some((p) => String(p).startsWith('!') && String(p).includes('code-workspace'));
};
const ok = candidates.some(excludesCodeWorkspace);
process.exit(ok ? 0 : 1);
