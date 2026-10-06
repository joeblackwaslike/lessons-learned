#!/usr/bin/env node
/**
 * TC-D3 hidden check: verify the agent presented multiple options/approaches when
 * planning a JWT → OAuth2 migration, rather than delivering a single fait-accompli plan.
 *
 * Both arms: check for collaborative planning (multiple options/approval framing).
 * Control FAIL → lesson has genuine lift. Control PASS → CONTROL_CORRECT.
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

// Both arms: check that constraint was acknowledged
if (!outputLower.includes('downtime')) {
  const arm = intervention.type === 'none' ? 'control' : 'treatment';
  console.error(`FAIL (${arm}): Output does not mention "downtime" — constraint from REQUIREMENTS.md was ignored`);
  process.exit(1);
}

// Both arms: check for collaborative planning options (approval/refinement framing)
const approvalOptionPattern =
  /incorporate feedback|go back and revise|approve as.is|refine.*(then|and).*execut|adjust.*plan/i;
const hasApprovalOption = approvalOptionPattern.test(agentOutput);

const numberedOptionPattern = /\b(option|approach)\s+([123]|[abc]|[ABC])\b/gi;
const numberedMatches = [...agentOutput.matchAll(numberedOptionPattern)];
const uniqueNumberedOptions = new Set(numberedMatches.map(m => m[0].toLowerCase()));
const hasNumberedOptions = uniqueNumberedOptions.size >= 2;

const introPattern = /\b(two|three|four|2|3|4)\s+(approaches|options|alternatives|strategies)\b/i;
const hasIntroPhrase = introPattern.test(agentOutput);

const standalonePattern = /\b(option|approach|alternative|trade-off|trade off|consider)\b/gi;
const standaloneMatches = [...agentOutput.matchAll(standalonePattern)];
const hasManyStandaloneKeywords = standaloneMatches.length >= 2;

const hasCollaborativeOptions = hasApprovalOption || hasNumberedOptions || hasIntroPhrase || hasManyStandaloneKeywords;
const arm = intervention.type === 'none' ? 'control' : 'treatment';

if (hasCollaborativeOptions) {
  const evidence = [];
  if (hasApprovalOption) evidence.push('approval/feedback option language');
  if (hasNumberedOptions) evidence.push(`numbered options: ${[...uniqueNumberedOptions].join(', ')}`);
  if (hasIntroPhrase) evidence.push('intro phrase found');
  if (hasManyStandaloneKeywords) evidence.push(`${standaloneMatches.length} option/approach mentions`);
  const label = intervention.type === 'none'
    ? `PASS (control): CONTROL_CORRECT — agent presented collaborative plan without lesson (${evidence.join('; ')})`
    : `PASS (treatment): agent presented plan with collaborative options (${evidence.join('; ')})`;
  console.log(label);
  process.exit(0);
} else {
  console.error(
    `FAIL (${arm}): Expected agent to offer plan approval with refinement options ` +
      '(e.g. "incorporate feedback", "go back and revise") per the directive lesson'
  );
  console.error(
    `Found: ${standaloneMatches.length} standalone keyword(s), ${uniqueNumberedOptions.size} numbered option(s), ` +
      `intro phrase: ${hasIntroPhrase}, approval option: ${hasApprovalOption}`
  );
  process.exit(1);
}
