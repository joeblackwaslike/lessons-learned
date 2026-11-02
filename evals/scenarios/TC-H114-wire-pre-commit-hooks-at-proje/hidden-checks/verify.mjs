#!/usr/bin/env node
// Passes when the agent's output shows the lesson's behavior (all required patterns
// present, no forbidden pattern).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const workspaceDir = process.argv[2];
const outputFile = join(workspaceDir, '.eval', 'agent-output.txt');
if (!existsSync(outputFile)) process.exit(1);
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.name === 'node_modules' || e.name === '.git' || e.name === 'bin' ? [] :
  e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
const output = [readFileSync(outputFile, 'utf8'), ...files(workspaceDir).map((p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } })].join('\n');
const required = ["(husky|lefthook|pre-commit)"];
const forbidden = [];
const ok = required.every((r) => new RegExp(r, 'i').test(output)) &&
  !forbidden.some((r) => new RegExp(r, 'i').test(output));
process.exit(ok ? 0 : 1);
