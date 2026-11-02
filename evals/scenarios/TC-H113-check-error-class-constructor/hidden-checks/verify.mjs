#!/usr/bin/env node
// Passes when retry.ts constructs RateLimitError with a numeric first argument and an
// object second argument (the real constructor), not a message string.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const file = join(process.argv[2], 'src', 'retry.ts');
if (!existsSync(file)) process.exit(1);
const src = readFileSync(file, 'utf8');
const m = src.match(/new RateLimitError\(\s*([^,)]+),\s*\{/);
if (!m) process.exit(1);
process.exit(/^["'`]/.test(m[1].trim()) ? 1 : 0);
