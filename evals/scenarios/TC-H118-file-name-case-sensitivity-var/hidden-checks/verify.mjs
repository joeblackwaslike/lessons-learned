#!/usr/bin/env node
// Passes when both case variants (skill.md and SKILL.md) were found and gamma-none
// was not listed as a match. "Listed as a match" means the line has the structure
// of a match entry (a bullet/numbered list item, or a line that is just the path
// in backticks) — not merely that the line mentions gamma-none in prose.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const outputFile = join(process.argv[2], '.eval', 'agent-output.txt');
if (!existsSync(outputFile)) process.exit(1);
const out = readFileSync(outputFile, 'utf8');
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const BACKTICKED_PATH_ONLY = /^\s*`[^`]*gamma-none[^`]*`\s*$/;
const gammaListedAsMatch = out
  .split('\n')
  .filter((line) => /gamma-none/.test(line))
  .some((line) => LIST_ITEM.test(line) || BACKTICKED_PATH_ONLY.test(line));
process.exit(/alpha-lower/.test(out) && /beta-upper/.test(out) && !gammaListedAsMatch ? 0 : 1);
