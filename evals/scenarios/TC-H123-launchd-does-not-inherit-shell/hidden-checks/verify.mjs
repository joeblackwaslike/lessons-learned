#!/usr/bin/env node
// Passes only when a candidate *.plist file (differs from seed-workspace) has a
// HOME key nested inside its EnvironmentVariables dict — not spread across
// unrelated files/prose, and not a HOME key outside that dict.
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
const hasHomeInEnvironmentVariables = (p) => {
  const rel = p.split(sep).join('/');
  if (!rel.endsWith('.plist')) return false;
  const content = readFileSync(p, 'utf8');
  const match = /<key>\s*EnvironmentVariables\s*<\/key>\s*<dict>([\s\S]*?)<\/dict>/i.exec(content);
  if (!match) return false;
  return /<key>\s*HOME\s*<\/key>/i.test(match[1]);
};
const ok = candidates.some(hasHomeInEnvironmentVariables);
process.exit(ok ? 0 : 1);
