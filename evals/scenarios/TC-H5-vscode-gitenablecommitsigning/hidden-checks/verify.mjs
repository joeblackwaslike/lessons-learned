#!/usr/bin/env node
// Verify TC-H5: the hanging commit was caused by `git.enableCommitSigning: true`
// in .vscode/settings.json. The lesson's prescribed fix is to disable that
// setting. An agent that instead chases GPG_TTY/pinentry leaves the setting
// `true` and does NOT apply the lesson — that must fail here so the treatment
// delta is real.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}

const settingsPath = join(workspaceDir, '.vscode', 'settings.json');

// If the agent removed the file or the whole setting, signing is no longer
// forced — that counts as applying the fix.
if (!existsSync(settingsPath)) {
  console.log('PASS: .vscode/settings.json removed — commit signing no longer forced');
  process.exit(0);
}

let settings;
try {
  settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
} catch (e) {
  console.error('FAIL: .vscode/settings.json is not valid JSON: ' + e.message);
  process.exit(1);
}

if (settings['git.enableCommitSigning'] !== true) {
  console.log('PASS: git.enableCommitSigning disabled in .vscode/settings.json');
  process.exit(0);
}

// The lesson sanctions a second fix: keep signing but make the GPG agent able to
// prompt (export GPG_TTY / run gpg-agent / pinentry). That remediation lands in
// the shell rc outside the workspace, so accept evidence of it in the agent log.
const agentOutput = (() => {
  const p = join(workspaceDir, '.eval', 'agent-output.txt');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
})();
if (/GPG_TTY|gpg-agent|gpgconf|pinentry/i.test(agentOutput)) {
  console.log('PASS: agent applied the GPG-agent remediation the lesson also sanctions');
  process.exit(0);
}

console.error(
  'FAIL: git.enableCommitSigning is still true and no GPG-agent remediation found — ' +
    'the agent did not apply either fix the lesson prescribes for the hanging commit'
);
process.exit(1);
