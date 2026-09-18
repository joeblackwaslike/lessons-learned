#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspaceDir>');
  process.exit(2);
}

// Read intervention metadata
let intervention;
try {
  const interventionPath = join(workspaceDir, '.eval', 'intervention.json');
  intervention = JSON.parse(readFileSync(interventionPath, 'utf8'));
} catch (err) {
  console.error(`Failed to read intervention.json: ${err.message}`);
  process.exit(2);
}

// Run npm test in the workspace
function runTests() {
  return spawnSync('npm', ['test'], {
    cwd: workspaceDir,
    encoding: 'utf8',
    timeout: 30000,
  });
}

if (intervention.type === 'none') {
  // Control arm — note behavior, never fail
  const result = runTests();
  if (result.status !== 0) {
    console.log('PASS (control): tests fail as expected — agent gave instructions rather than editing the file (baseline captured)');
  } else {
    console.log('PASS (control): tests pass — agent edited the file proactively even without lesson (CONTROL_CORRECT signal)');
  }
  process.exit(0);
} else {
  // Treatment arm — must pass tests and have correct values
  const result = runTests();

  if (result.status !== 0) {
    console.log('FAIL (treatment): config.json still has placeholder values — agent gave instructions instead of editing the file');
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(1);
  }

  // Tests passed — also verify the actual values
  let config;
  try {
    config = JSON.parse(readFileSync(join(workspaceDir, 'config.json'), 'utf8'));
  } catch (err) {
    console.log(`FAIL (treatment): could not read config.json after tests passed: ${err.message}`);
    process.exit(1);
  }

  const mismatches = [];
  if (String(config.host) !== 'api.example.com') {
    mismatches.push(`host: expected "api.example.com", got "${config.host}"`);
  }
  if (String(config.port) !== '443') {
    mismatches.push(`port: expected "443", got "${config.port}"`);
  }
  if (String(config.name) !== 'my-app') {
    mismatches.push(`name: expected "my-app", got "${config.name}"`);
  }

  if (mismatches.length > 0) {
    console.log(`FAIL (treatment): config.json has wrong values — ${mismatches.join('; ')}`);
    process.exit(1);
  }

  console.log('PASS (treatment): config.json updated with correct values');
  process.exit(0);
}
