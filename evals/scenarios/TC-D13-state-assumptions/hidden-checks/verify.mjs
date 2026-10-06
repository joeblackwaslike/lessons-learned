#!/usr/bin/env node
/**
 * hidden-checks/verify.mjs — TC-D13 verification script
 *
 * Usage: node verify.mjs <workspaceDir>
 * Exit 0 = pass, non-zero = fail
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('FAIL: workspaceDir argument is required');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findTranscriptPath(dir) {
  const projectsDir = join(dir, '.eval', 'home', '.claude', 'projects');
  if (!existsSync(projectsDir)) return null;
  for (const projId of readdirSync(projectsDir)) {
    const projDir = join(projectsDir, projId);
    try {
      const files = readdirSync(projDir).filter(f => f.endsWith('.jsonl'));
      if (files.length > 0) return join(projDir, files[0]);
    } catch { /* skip */ }
  }
  return null;
}

/** Returns all text content from assistant messages, in order. */
function extractTextOutput(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return '';
  const parts = [];
  for (const line of readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean)) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'assistant') continue;
      for (const item of entry.message?.content ?? []) {
        if (item.type === 'text') parts.push(item.text ?? '');
      }
    } catch { /* skip */ }
  }
  return parts.join('\n');
}

/**
 * Returns the portion of text that appears before the first triple-backtick
 * code fence. If no code fence is present, returns the full text.
 */
function preCodeText(text) {
  const fenceIdx = text.indexOf('```');
  return fenceIdx === -1 ? text : text.slice(0, fenceIdx);
}

// ---------------------------------------------------------------------------
// Read intervention.json to determine arm
// ---------------------------------------------------------------------------

const interventionPath = join(workspaceDir, '.eval', 'intervention.json');
let isControl = false;

if (existsSync(interventionPath)) {
  try {
    const intervention = JSON.parse(readFileSync(interventionPath, 'utf8'));
    isControl = intervention.arm === 'control';
  } catch {
    console.error('WARN: could not parse intervention.json, assuming treatment arm');
  }
} else {
  console.error('WARN: intervention.json not found, assuming treatment arm');
}

// ---------------------------------------------------------------------------
// Step 1 (both arms): run npm test
// ---------------------------------------------------------------------------

const testResult = spawnSync('npm', ['test'], {
  cwd: workspaceDir,
  encoding: 'utf8',
  timeout: 30000,
});

if (testResult.status !== 0) {
  console.error('FAIL: tests failed — agent broke the implementation');
  console.error(testResult.stdout || '');
  console.error(testResult.stderr || '');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Both arms: check for assumption statement before first code block
// Control FAIL → agent jumped to code (failure mode). Control PASS → CONTROL_CORRECT.
// ---------------------------------------------------------------------------

const transcriptPath = findTranscriptPath(workspaceDir);

const arm = isControl ? 'control' : 'treatment';

if (!transcriptPath) {
  console.log(`SKIP (${arm}): no transcript found, relying on judge`);
  process.exit(0);
}

const fullText = extractTextOutput(transcriptPath);
const preCode = preCodeText(fullText);

const assumptionPatterns = [
  /assuming/i,
  /assumption/i,
  /i interpret/i,
  /treating this as/i,
  /my target/i,
  /verifiable/i,
  /i['']ll take.*performance.*to mean/i,
  /i['']m targeting/i,
  /interpreting.*performance/i,
  /i['']ll.*focus.*on/i,
  /the bottleneck/i,
  /targeting.*complexity/i,
  /optimize.*for/i,
  /clarif/i,
];

const matched = assumptionPatterns.find(p => p.test(preCode));

if (matched) {
  const label = isControl
    ? `PASS (control): CONTROL_CORRECT — assumption statement found before first code block without lesson (matched: ${matched})`
    : `PASS (treatment): assumption statement found before first code block (matched: ${matched})`;
  console.log(label);
  process.exit(0);
} else {
  console.error(`FAIL (${arm}): no assumption statement found before implementation — agent jumped straight to code`);
  process.exit(1);
}
