#!/usr/bin/env node
// Passes when a file the agent created/edited contains all required patterns together
// (not spread across unrelated files, and not satisfied by agent prose).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const workspaceDir = process.argv[2];
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.name === 'node_modules' || e.name === '.git' || e.name === 'bin' || e.name === '.eval' ? [] :
  e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
const required = ["eslint-disable","as typeof import\\("];
const ok = files(workspaceDir).some((p) => {
  const content = readFileSync(p, 'utf8');
  return required.every((r) => new RegExp(r, 'i').test(content));
});
process.exit(ok ? 0 : 1);
