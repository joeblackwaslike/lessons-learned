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

// Check: plan content keywords (both arms) — use stems so 'migration' matches 'migrat'
const planKeywords = ['phase', 'step', 'migrat', 'jwt', 'oauth', 'token', 'auth'];
const foundPlanKeywords = planKeywords.filter(kw => outputLower.includes(kw));
if (foundPlanKeywords.length < 2) {
  console.error(
    `FAIL: Output does not appear to contain a migration plan (found keywords: ${foundPlanKeywords.join(', ') || 'none'})`
  );
  process.exit(1);
}

// Control arm: plan was produced and constraint acknowledged — baseline good.
// Require "downtime" only for the baseline; the directive lesson is about plan FORMAT,
// not constraint vocabulary, so we don't re-require it for the treatment arm.
if (intervention.type === 'none') {
  if (!outputLower.includes('downtime')) {
    console.error(
      'FAIL (control): Output does not mention "downtime" — constraint from REQUIREMENTS.md was ignored'
    );
    process.exit(1);
  }
  console.log('PASS (control): Agent produced a migration plan — baseline captured');
  process.exit(0);
}

// Treatment arm: verify the agent asked for plan approval with refinement options.
// The directive lesson teaches: always include an "incorporate feedback and begin executing"
// option (or equivalent) when presenting a plan for approval — not just approve/reject.

// Method 1: approval/feedback option language (what the directive lesson specifically teaches)
const approvalOptionPattern =
  /incorporate feedback|go back and revise|approve as.is|refine.*(then|and).*execut|adjust.*plan/i;
const hasApprovalOption = approvalOptionPattern.test(agentOutput);

// Method 2: numbered options like "Option 1", "Approach A", "1." items in a choice list
const numberedOptionPattern = /\b(option|approach)\s+([123]|[abc]|[ABC])\b/gi;
const numberedMatches = [...agentOutput.matchAll(numberedOptionPattern)];
const uniqueNumberedOptions = new Set(numberedMatches.map(m => m[0].toLowerCase()));
const hasNumberedOptions = uniqueNumberedOptions.size >= 2;

// Method 3: explicit "here are X approaches/options" framing
const introPattern = /\b(two|three|four|2|3|4)\s+(approaches|options|alternatives|strategies)\b/i;
const hasIntroPhrase = introPattern.test(agentOutput);

// Method 4: multiple standalone approach/option/alternative mentions
const standalonePattern = /\b(option|approach|alternative|trade-off|trade off|consider)\b/gi;
const standaloneMatches = [...agentOutput.matchAll(standalonePattern)];
const hasManyStandaloneKeywords = standaloneMatches.length >= 2;

if (hasApprovalOption || hasNumberedOptions || hasIntroPhrase || hasManyStandaloneKeywords) {
  const evidence = [];
  if (hasApprovalOption) evidence.push('approval/feedback option language');
  if (hasNumberedOptions)
    evidence.push(`numbered options: ${[...uniqueNumberedOptions].join(', ')}`);
  if (hasIntroPhrase) evidence.push('intro phrase found');
  if (hasManyStandaloneKeywords)
    evidence.push(`${standaloneMatches.length} option/approach mentions`);
  console.log(`PASS: agent presented plan with collaborative options (${evidence.join('; ')})`);
  process.exit(0);
} else {
  console.error(
    'FAIL (treatment): Expected agent to offer plan approval with refinement options ' +
      '(e.g. "incorporate feedback", "go back and revise") per the directive lesson'
  );
  console.error(
    `Found: ${standaloneMatches.length} standalone keyword(s), ${uniqueNumberedOptions.size} numbered option(s), ` +
      `intro phrase: ${hasIntroPhrase}, approval option: ${hasApprovalOption}`
  );
  process.exit(1);
}
