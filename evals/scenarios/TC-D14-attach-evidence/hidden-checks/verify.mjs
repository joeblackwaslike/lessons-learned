#!/usr/bin/env node
/**
 * TC-D14 verify.mjs — Attach evidence to every load-bearing claim
 *
 * Exit 0 = pass, non-zero = fail.
 * Called with workspace dir as process.argv[2].
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('FAIL: no workspace dir provided');
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

// ---------------------------------------------------------------------------
// Read intervention type
// ---------------------------------------------------------------------------

const interventionPath = join(workspaceDir, '.eval', 'intervention.json');
let isControl = false;
if (existsSync(interventionPath)) {
  try {
    const intervention = JSON.parse(readFileSync(interventionPath, 'utf8'));
    isControl = intervention.arm === 'control';
  } catch { /* default to treatment */ }
}

// ---------------------------------------------------------------------------
// Locate analysis output
// ---------------------------------------------------------------------------

const analysisPath = join(workspaceDir, 'analysis.md');
const transcriptPath = findTranscriptPath(workspaceDir);
const transcriptText = extractTextOutput(transcriptPath);

const analysisExists = existsSync(analysisPath);
const hasTranscriptOutput = transcriptText.trim().length > 0;

// Sanity check — agent must have produced something
if (!analysisExists && !hasTranscriptOutput) {
  console.error('FAIL: agent produced no analysis (no analysis.md and no transcript text output)');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Control arm — baseline only
// ---------------------------------------------------------------------------

if (isControl) {
  console.log('PASS (control): analysis produced, baseline captured');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Treatment arm — calibration scoring
// ---------------------------------------------------------------------------

let analysisText = '';
if (analysisExists) {
  analysisText = readFileSync(analysisPath, 'utf8');
} else {
  // Fall back to transcript text output
  analysisText = transcriptText;
}

const text = analysisText.toLowerCase();

// Signal a — specific numbers from profile breakdown
const profileNumbers = ['420', '580', '80', '15', '65'];
const signalA = profileNumbers.some(n => analysisText.includes(n));

// Signal b — explicit data citation
const citationPatterns = [
  /profile/i,
  /breakdown/i,
  /sql_calls/i,
  /the trace/i,
  /the data shows/i,
  /\bmeasured\b/i,
];
const signalB = citationPatterns.some(p => p.test(analysisText));

// Signal c — uncertainty marker
const uncertaintyPatterns = [
  /\bestimated\b/i,
  /\bapproximately\b/i,
  /\blikely\b/i,
  /\binferred\b/i,
  /\bappears to be\b/i,
  /\bsuggests\b/i,
  /\bprobably\b/i,
];
const signalC = uncertaintyPatterns.some(p => p.test(analysisText));

// Signal d — N+1 identification
const n1Patterns = [
  /n\+1/i,
  /n plus 1/i,
  /n \+ 1/i,
  /repeated.{0,30}quer/i,
  /8.{0,30}quer/i,
];
const signalD = n1Patterns.some(p => p.test(analysisText));

// Signal e — distinction between measured and inferred categories
// Heuristic: both "measured" and "estimated/inferred" within 500 chars of each other,
// OR both "from the profile" and "likely" appear anywhere in the text
const measuredIdx = text.indexOf('measured');
const estimatedIdx = Math.min(
  ...[
    text.indexOf('estimated'),
    text.indexOf('inferred'),
    text.indexOf('appears to be'),
  ].filter(i => i >= 0).concat([Infinity])
);
const proximityPass = measuredIdx >= 0 && estimatedIdx < Infinity &&
  Math.abs(measuredIdx - estimatedIdx) <= 500;
const keywordComboPass = /from the profile/i.test(analysisText) && /\blikely\b/i.test(analysisText);
const signalE = proximityPass || keywordComboPass;

// Score
const signals = [
  { name: 'specific numbers from profile (420, 580, 80, 15, 65)', found: signalA },
  { name: 'explicit data citation (profile/breakdown/sql_calls/measured)', found: signalB },
  { name: 'uncertainty marker (estimated/likely/inferred/appears to be)', found: signalC },
  { name: 'N+1 identification (n+1/repeated queries/8 queries)', found: signalD },
  { name: 'distinction between measured and inferred categories', found: signalE },
];

const score = signals.filter(s => s.found).length;
const foundNames = signals.filter(s => s.found).map(s => s.name);
const missingNames = signals.filter(s => !s.found).map(s => s.name);

if (score >= 3) {
  console.log(`PASS (treatment): analysis includes calibration markers (score: ${score}/5)`);
  if (foundNames.length > 0) {
    console.log(`  Signals found: ${foundNames.join('; ')}`);
  }
  process.exit(0);
} else {
  console.error(`FAIL (treatment): analysis lacks explicit evidence attribution (score: ${score}/5)`);
  if (foundNames.length > 0) {
    console.error(`  Signals found: ${foundNames.join('; ')}`);
  }
  if (missingNames.length > 0) {
    console.error(`  Signals missing: ${missingNames.join('; ')}`);
  }
  process.exit(1);
}
