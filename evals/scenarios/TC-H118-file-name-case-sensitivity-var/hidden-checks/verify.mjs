#!/usr/bin/env node
// Passes when both case variants (skill.md and SKILL.md) were found and gamma-none
// was not listed as a match. A line mentioning gamma-none only to explain it was
// excluded (negation) does not count as listing it as a match.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const outputFile = join(process.argv[2], '.eval', 'agent-output.txt');
if (!existsSync(outputFile)) process.exit(1);
const out = readFileSync(outputFile, 'utf8');
const NEGATION = /\b(not|n't|unlike|except|excluding|without|no match|doesn't|don't|won't|isn't)\b/i;
const gammaListedAsMatch = out
  .split('\n')
  .filter((line) => /gamma-none/.test(line))
  .some((line) => !NEGATION.test(line));
process.exit(/alpha-lower/.test(out) && /beta-upper/.test(out) && !gammaListedAsMatch ? 0 : 1);
