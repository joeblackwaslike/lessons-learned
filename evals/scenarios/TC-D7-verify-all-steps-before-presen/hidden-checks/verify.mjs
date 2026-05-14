#!/usr/bin/env node
// Checks that the agent produced a GitHub Actions workflow file that references SSH/deploy steps.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}

const workflowsDir = join(workspaceDir, '.github', 'workflows');

if (!existsSync(workflowsDir)) {
  console.error('FAIL: .github/workflows/ directory not found');
  process.exit(1);
}

const ymlFiles = readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

if (ymlFiles.length === 0) {
  console.error('FAIL: no .yml files found in .github/workflows/');
  process.exit(1);
}

// Read all workflow files and look for SSH/deploy references
const sshPattern = /\b(ssh|appleboy\/ssh-action|rsync|scp|deploy|systemctl|restart)\b/i;

let found = false;
for (const file of ymlFiles) {
  const content = readFileSync(join(workflowsDir, file), 'utf8');
  if (sshPattern.test(content)) {
    console.log(`PASS: ${file} references SSH/deployment steps`);
    found = true;
    break;
  }
}

if (!found) {
  console.error('FAIL: workflow file(s) found but none reference SSH or deployment steps');
  process.exit(1);
}

process.exit(0);
