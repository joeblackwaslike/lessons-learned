#!/usr/bin/env node
// Passes only when a candidate file (differs from seed-workspace) is real hook-runner
// wiring: .husky/pre-commit, lefthook.yml(.yaml), .pre-commit-config.yaml, or a
// package.json adding a husky/lefthook/simple-git-hooks config or a "prepare" script.
// Not satisfied by prose mentioning hook names (including negation sentences).
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
const isRealHookWiring = (p) => {
  const rel = p.split(sep).join('/');
  if (rel.endsWith('.husky/pre-commit')) return true;
  if (/(^|\/)lefthook\.ya?ml$/.test(rel)) return true;
  if (/(^|\/)\.pre-commit-config\.ya?ml$/.test(rel)) return true;
  if (/(^|\/)package\.json$/.test(rel)) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf8'));
      if (pkg.husky || pkg.lefthook || pkg['simple-git-hooks']) return true;
      if (pkg.scripts && typeof pkg.scripts.prepare === 'string') return true;
    } catch {
      return false;
    }
  }
  return false;
};
const ok = candidates.some(isRealHookWiring);
process.exit(ok ? 0 : 1);
