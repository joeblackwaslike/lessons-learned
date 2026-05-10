/**
 * assert-trajectory.mjs — Tier 2 Promptfoo JS assertion.
 *
 * Reads the tool-call trajectory from provider metadata artifacts and evaluates
 * declarative assertions defined in the scenario's scenario.json.
 *
 * Assertion types (defined in scenario.json under `trajectoryAssertions`):
 *   required  — a matching event must exist in the trajectory
 *   forbidden — no matching event may exist in the trajectory
 *
 * Matching fields (all optional, ANDed together):
 *   tool         — exact tool name (e.g. "Bash", "Edit", "Agent")
 *   commandMatch — regex tested against the Bash command string
 *   pathMatch    — regex tested against the file path argument
 *
 * Returns { pass: true, score: 1 } when all assertions pass or when none are
 * defined for the scenario. Returns { pass: false, score: 0 } on any failure.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = resolve(__dirname, '..', 'scenarios');

export default function assertTrajectory(output, context) {
  const scenarioId = context.vars?.scenarioId;
  const trajectory = context.providerResponse?.metadata?.artifacts?.trajectory ?? [];

  if (!scenarioId) {
    return { pass: true, score: 1, reason: 'No scenarioId — trajectory check skipped' };
  }

  const scenarioJsonPath = join(SCENARIOS_DIR, scenarioId, 'scenario.json');
  if (!existsSync(scenarioJsonPath)) {
    return { pass: true, score: 1, reason: 'No scenario.json — trajectory check skipped' };
  }

  let scenario;
  try {
    scenario = JSON.parse(readFileSync(scenarioJsonPath, 'utf8'));
  } catch {
    return {
      pass: true,
      score: 1,
      reason: 'Could not parse scenario.json — trajectory check skipped',
    };
  }

  const assertions = scenario.trajectoryAssertions ?? [];
  if (assertions.length === 0) {
    return { pass: true, score: 1, reason: 'No trajectory assertions defined for this scenario' };
  }

  const failures = [];
  const passes = [];

  for (const assertion of assertions) {
    const result = evaluate(assertion, trajectory);
    (result.pass ? passes : failures).push(result.reason);
  }

  if (failures.length === 0) {
    return {
      pass: true,
      score: 1,
      reason: `All ${assertions.length} trajectory assertion(s) passed:\n${passes.join('\n')}`,
    };
  }

  return {
    pass: false,
    score: 0,
    reason: `${failures.length}/${assertions.length} trajectory assertion(s) failed:\n${failures.join('\n')}`,
  };
}

function evaluate(assertion, trajectory) {
  const { type, tool, commandMatch, pathMatch, description } = assertion;
  const label =
    description ?? `${type}: ${[tool, commandMatch, pathMatch].filter(Boolean).join(' ')}`;

  const found = trajectory.some(e => matchesEvent(e, tool, commandMatch, pathMatch));

  switch (type) {
    case 'required':
      return {
        pass: found,
        reason: found
          ? `✓ ${label}`
          : `✗ ${label} — not found in trajectory (${trajectory.length} events recorded)`,
      };
    case 'forbidden':
      return {
        pass: !found,
        reason: !found ? `✓ ${label}` : `✗ ${label} — found in trajectory but should not be`,
      };
    default:
      return { pass: true, reason: `[unknown assertion type "${type}" — skipped]` };
  }
}

function matchesEvent(event, tool, commandMatch, pathMatch) {
  if (tool && event.tool !== tool) return false;
  if (commandMatch && !new RegExp(commandMatch, 'i').test(event.command ?? '')) return false;
  if (pathMatch && !new RegExp(pathMatch, 'i').test(event.path ?? '')) return false;
  return true;
}
