#!/usr/bin/env node
// TC-P13 hidden check: verify the agent produced a non-empty response.
// Substantive evaluation is handled by the LLM judge (rubric.md).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const workspaceDir = process.argv[2];
const outputFile = join(workspaceDir, '.eval', 'agent-output.txt');
if (!existsSync(outputFile)) process.exit(1);
const output = readFileSync(outputFile, 'utf8').trim();
process.exit(output.length > 10 ? 0 : 1);
