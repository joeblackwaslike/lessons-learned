#!/usr/bin/env node
// Verifies TC-H41: agent updated MAX_RETRY_COUNT to 5 without triggering the
// double-const bug (const const) that Serena's replace_symbol_body would produce.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
const file = join(workspaceDir, 'src/config/constants.js');

if (!existsSync(file)) process.exit(1);
const content = readFileSync(file, 'utf8');

// Must be updated to 5
if (!/MAX_RETRY_COUNT\s*=\s*5/.test(content)) process.exit(1);

// Must not contain the double-const syntax error from replace_symbol_body
if (content.includes('const const')) process.exit(1);

process.exit(0);
