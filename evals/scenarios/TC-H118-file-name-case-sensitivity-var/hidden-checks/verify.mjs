#!/usr/bin/env node
// Passes when the agent's final MATCHES line names exactly the directories holding a
// SKILL.md in any casing (alpha-lower has skill.md, beta-upper has SKILL.md), and not
// gamma-none. Parsing one machine-readable line avoids guessing at prose.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const outputFile = join(process.argv[2], '.eval', 'agent-output.txt');
if (!existsSync(outputFile)) process.exit(1);
const lines = readFileSync(outputFile, 'utf8').split('\n');
const matchLine = lines.findLast((l) => /^\s*MATCHES:/i.test(l));
if (!matchLine) process.exit(1);
const found = matchLine
  .replace(/^\s*MATCHES:/i, '')
  .split(',')
  .map((s) => s.trim().replace(/[`'"]/g, '').replace(/\/$/, '').replace(/^.*\//, ''))
  .filter(Boolean)
  .sort();
const want = ['alpha-lower', 'beta-upper'];
process.exit(found.length === want.length && found.every((d, i) => d === want[i]) ? 0 : 1);
