#!/usr/bin/env node
// Auto-generated verify: checks that agent produced non-empty output.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const workspaceDir = process.argv[2];
const outputFile = join(workspaceDir, '.eval', 'agent-output.txt');
if (!existsSync(outputFile)) process.exit(1);
const output = readFileSync(outputFile, 'utf8').trim();
process.exit(output.length > 10 ? 0 : 1);
