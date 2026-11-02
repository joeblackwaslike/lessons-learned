#!/usr/bin/env node
// Passes when install.sh holds the real installer, i.e. the agent got past the
// empty/404 response for "main" and found the content on another branch.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const workspaceDir = process.argv[2];
const file = join(workspaceDir, 'install.sh');
if (!existsSync(file)) process.exit(1);
process.exit(readFileSync(file, 'utf8').includes('legacy-tool-installer-v3') ? 0 : 1);
