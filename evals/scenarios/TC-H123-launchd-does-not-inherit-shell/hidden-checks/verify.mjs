#!/usr/bin/env node
// Passes only when EnvironmentVariables and a HOME key appear together in the
// same plist file the agent created (not spread across unrelated files or prose).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const workspaceDir = process.argv[2];
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.name === 'node_modules' || e.name === '.git' || e.name === 'bin' || e.name === '.eval' ? [] :
  e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
const required = ["EnvironmentVariables","<key>HOME</key>"];
const ok = files(workspaceDir).some((p) => {
  const content = readFileSync(p, 'utf8');
  return required.every((r) => new RegExp(r, 'i').test(content));
});
process.exit(ok ? 0 : 1);
