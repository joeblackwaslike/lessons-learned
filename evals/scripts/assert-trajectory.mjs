/**
 * assert-trajectory.mjs — Tier 2 Promptfoo JS assertion.
 *
 * Reads the tool-call trajectory from provider metadata artifacts and evaluates
 * declarative assertions defined in the scenario's scenario.json (read from
 * `vars.scenarioDir` when set, else `evals/scenarios/<scenarioId>`).
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
  const scenarioDir = context.vars?.scenarioDir;
  const artifacts = context.providerResponse?.metadata?.artifacts;

  if (!scenarioId && !scenarioDir) {
    return { pass: true, score: 1, reason: 'No scenarioId — trajectory check skipped' };
  }

  const scenarioJsonPath = join(scenarioDir || join(SCENARIOS_DIR, scenarioId), 'scenario.json');
  if (!existsSync(scenarioJsonPath)) {
    return { pass: false, score: 0, reason: `scenario.json not found at ${scenarioJsonPath}` };
  }

  let scenario;
  try {
    scenario = JSON.parse(readFileSync(scenarioJsonPath, 'utf8'));
  } catch (err) {
    return {
      pass: false,
      score: 0,
      reason: `Could not parse scenario.json at ${scenarioJsonPath}: ${err.message}`,
    };
  }

  const assertions = scenario.trajectoryAssertions ?? [];
  if (assertions.length === 0) {
    return { pass: true, score: 1, reason: 'No trajectory assertions defined for this scenario' };
  }

  if (!Array.isArray(artifacts?.trajectory)) {
    return {
      pass: false,
      score: 0,
      reason: 'Trajectory assertions are defined but no trajectory artifact was collected — telemetry is missing',
    };
  }
  if (artifacts.parseErrors) {
    return {
      pass: false,
      score: 0,
      reason: `Trajectory assertions are defined but ${artifacts.parseErrors} telemetry record(s) failed to parse — evidence is incomplete`,
    };
  }
  const trajectory = artifacts.trajectory;

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

  let found;
  try {
    const commandRegex = commandMatch ? compileRegex('commandMatch', commandMatch) : null;
    const pathRegex = pathMatch ? compileRegex('pathMatch', pathMatch) : null;
    found = trajectory.some(e => matchesEvent(e, tool, commandRegex, pathRegex));
  } catch (err) {
    return { pass: false, reason: `✗ ${label} — ${err.message}` };
  }

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
      return { pass: false, reason: `Unknown assertion type "${type}" — fix scenario.json` };
  }
}

function matchesEvent(event, tool, commandRegex, pathRegex) {
  if (tool && event.tool !== tool) return false;
  if (commandRegex && !commandRegex.test(event.command ?? '')) return false;
  if (pathRegex && !pathRegex.test(event.path ?? '')) return false;
  return true;
}

function compileRegex(field, pattern) {
  try {
    return new RegExp(pattern, 'i');
  } catch (err) {
    throw new Error(`Invalid ${field} regex "${pattern}" — fix scenario.json (${err.message})`);
  }
}
