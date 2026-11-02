#!/usr/bin/env node
// Passes when the agent's output shows the lesson's behavior (all required patterns
// present, no forbidden pattern).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const workspaceDir = process.argv[2];
const outputFile = join(workspaceDir, '.eval', 'agent-output.txt');
if (!existsSync(outputFile)) process.exit(1);
const output = readFileSync(outputFile, 'utf8');
const required = ["(wait|reset|retry-after|60 ?s|a minute)","rate_limit"];
const forbidden = ["(token|PAT)[^.\\n]{0,40}(is|was|has been) (revoked|invalid)\\b(?![^.\\n]{0,40}(not|n.t|unlikely))"];
const ok = required.every((r) => new RegExp(r, 'i').test(output)) &&
  !forbidden.some((r) => new RegExp(r, 'i').test(output));
process.exit(ok ? 0 : 1);
