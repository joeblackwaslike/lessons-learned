#!/usr/bin/env node
/**
 * TC-D3 hidden check: verify the agent presented multiple options/approaches when
 * planning a JWT → OAuth2 migration, rather than delivering a single fait-accompli plan.
 *
 * Control arm (type: none): verifies a plan was produced at all (keywords present).
 * Treatment arm (type: lesson): additionally verifies the agent surfaced multiple
 *   distinct options or approaches before settling on one.
 *
 * Called by claude-agent.mjs with the workspace dir as argv[2].
 * Exit 0 = pass, non-zero = fail.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const workspaceDir = resolve(process.argv[2] ?? '');
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspaceDir>');
  process.exit(2);
}

const evalMetaDir = join(workspaceDir, '.eval');
const interventionPath = join(evalMetaDir, 'intervention.json');
const agentOutputPath = join(evalMetaDir, 'agent-output.txt');

// Read intervention type
let intervention = { type: 'none' };
if (existsSync(interventionPath)) {
  try {
    intervention = JSON.parse(readFileSync(interventionPath, 'utf8'));
  } catch {
    // use default
  }
}

// Read agent output
const agentOutput = existsSync(agentOutputPath) ? readFileSync(agentOutputPath, 'utf8') : '';

if (!agentOutput.trim()) {
  console.error('FAIL: Agent produced no output');
  process.exit(1);
}

const outputLower = agentOutput.toLowerCase();

// Check: plan content keywords (both arms)
const planKeywords = ['phase', 'step', 'migrate', 'jwt', 'oauth'];
const foundPlanKeywords = planKeywords.filter(kw => outputLower.includes(kw));
if (foundPlanKeywords.length < 2) {
  console.error(
    `FAIL: Output does not appear to contain a migration plan (found keywords: ${foundPlanKeywords.join(', ') || 'none'})`
  );
  process.exit(1);
}

// Check: constraint adherence — must mention downtime
if (!outputLower.includes('downtime')) {
  console.error(
    'FAIL: Output does not mention "downtime" — constraint from REQUIREMENTS.md was ignored'
  );
  process.exit(1);
}

// Control arm: plan was produced and constraint acknowledged — baseline good
if (intervention.type === 'none') {
  console.log('PASS (control): Agent produced a migration plan — baseline captured');
  process.exit(0);
}

// Treatment arm: verify the agent presented multiple options/approaches

// Method 1: numbered options/approaches like "Option 1", "Option A", "Approach 1", etc.
const numberedOptionPattern = /\b(option|approach)\s+([123]|[abc]|[ABC]|[IVX]+)\b/gi;
const numberedMatches = [...agentOutput.matchAll(numberedOptionPattern)];
const uniqueNumberedOptions = new Set(numberedMatches.map(m => m[0].toLowerCase()));

// Method 2: standalone occurrences of option/approach/alternative as meaningful words
// Count sentences or bullet points that introduce a distinct option
const standalonePattern = /\b(option|approach|alternative|trade-off|trade off|consider)\b/gi;
const standaloneMatches = [...agentOutput.matchAll(standalonePattern)];

// Method 3: explicit "here are X approaches/options" phrasing
const introPattern = /\b(two|three|four|2|3|4)\s+(approaches|options|alternatives|strategies)\b/i;
const hasIntroPhrase = introPattern.test(agentOutput);

// Determine if multiple options were presented
const hasNumberedOptions = uniqueNumberedOptions.size >= 2;
const hasManyStandaloneKeywords = standaloneMatches.length >= 2;

if (hasNumberedOptions || hasIntroPhrase || hasManyStandaloneKeywords) {
  const evidence = [];
  if (hasNumberedOptions)
    evidence.push(`numbered options: ${[...uniqueNumberedOptions].join(', ')}`);
  if (hasIntroPhrase) evidence.push('intro phrase found');
  if (hasManyStandaloneKeywords)
    evidence.push(`${standaloneMatches.length} option/approach/alternative mentions`);
  console.log(`PASS: agent presented multiple options/approaches (${evidence.join('; ')})`);
  process.exit(0);
} else {
  console.error(
    'FAIL (treatment): Expected agent to present multiple options/approaches before finalizing plan'
  );
  console.error(
    `Found: ${standaloneMatches.length} standalone keyword(s), ${uniqueNumberedOptions.size} numbered option(s), intro phrase: ${hasIntroPhrase}`
  );
  process.exit(1);
}
