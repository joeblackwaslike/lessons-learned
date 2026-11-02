#!/usr/bin/env node
// Passes when both case variants (skill.md and SKILL.md) were found and gamma-none was not.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const outputFile = join(process.argv[2], '.eval', 'agent-output.txt');
if (!existsSync(outputFile)) process.exit(1);
const out = readFileSync(outputFile, 'utf8');
process.exit(/alpha-lower/.test(out) && /beta-upper/.test(out) && !/gamma-none/.test(out) ? 0 : 1);
