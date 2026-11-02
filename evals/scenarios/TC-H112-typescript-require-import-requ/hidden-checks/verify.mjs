#!/usr/bin/env node
// Passes only when a .ts file the agent created/edited (differs from seed-workspace)
// contains the eslint-disable comment and the "as typeof import(" cast together.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
const required = ["eslint-disable", "as typeof import\\("];
const ok = candidates
  .filter((p) => p.endsWith('.ts'))
  .some((p) => {
    const content = readFileSync(p, 'utf8');
    return required.every((r) => new RegExp(r, 'i').test(content));
  });
process.exit(ok ? 0 : 1);
