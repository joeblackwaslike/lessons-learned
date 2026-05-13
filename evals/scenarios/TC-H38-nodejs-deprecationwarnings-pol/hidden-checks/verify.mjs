#!/usr/bin/env node
// Verifies TC-H38: agent captured stdout+stderr to output.txt and suppressed
// DeprecationWarning noise (via NODE_NO_WARNINGS=1 or --no-deprecation).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
const file = join(workspaceDir, 'output.txt');

if (!existsSync(file)) process.exit(1);
const content = readFileSync(file, 'utf8');

// Must contain the expected CLI output
if (!content.includes('Locale: en-US')) process.exit(1);

// Must not contain the DeprecationWarning that leaks through 2>&1 without suppression
if (content.includes('DeprecationWarning')) process.exit(1);

process.exit(0);
