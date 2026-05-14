#!/usr/bin/env node
// Verify: checks that notification_service.py's broadcast method snapshots
// the subscribers collection with list() before iterating.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}

const svcPy = join(workspaceDir, 'notification_service.py');
if (!existsSync(svcPy)) {
  console.error('FAIL: notification_service.py does not exist');
  process.exit(1);
}

const src = readFileSync(svcPy, 'utf8');

if (!src.includes('broadcast')) {
  console.error('FAIL: notification_service.py has no broadcast method');
  process.exit(1);
}

// Must snapshot subscribers with list() — either list(self.subscribers) or
// assigning to a local snapshot variable via list(
if (!src.includes('list(self.subscribers') && !src.includes('list(self.subscribers)')) {
  // Looser check: any list() call in the file that appears in a broadcast context
  const broadcastBlock = src.slice(src.indexOf('broadcast'));
  if (!broadcastBlock.includes('list(')) {
    console.error(
      'FAIL: broadcast method iterates self.subscribers without a list() snapshot — concurrent modification risk'
    );
    process.exit(1);
  }
}

console.log('PASS: broadcast method uses list() snapshot before iterating subscribers');
process.exit(0);
