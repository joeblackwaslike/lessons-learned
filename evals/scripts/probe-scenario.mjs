#!/usr/bin/env node
/**
 * probe-scenario.mjs — Lightweight single-call probe for scenario prompt design.
 *
 * Makes an isolated `claude -p` call (see evals/lib/claude-spawn.mjs) with a
 * scenario's PROMPT.md content — no workspace setup, no lesson injection.
 * Useful for rapidly iterating on scenario prompts before committing to a full
 * (expensive) eval run.
 *
 * Usage:
 *   node evals/scripts/probe-scenario.mjs <scenario-dir> [--model <model-id>]
 *
 * Auth via OAuth (default ~/.claude/ config dir) — no env vars required.
 */

import { callClaude } from '../lib/claude-spawn.mjs';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const RUBRIC_PREVIEW_CHARS = 500;

// Default system prompt for probing — forces a direct implementation response
// so the model doesn't stop at "let me check the project structure".
const DEFAULT_SYSTEM =
  'You are a senior software engineer. When given a programming task, provide a complete ' +
  'implementation directly in your response. Do not ask clarifying questions, refer to ' +
  'project exploration, or mention using tools — write the code now.';

function parseArgs(argv) {
  const args = argv.slice(2);
  let scenarioDir = null;
  let model = DEFAULT_MODEL;
  let system = DEFAULT_SYSTEM;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) {
      model = args[++i];
    } else if (args[i] === '--system' && args[i + 1]) {
      system = args[++i];
    } else if (args[i] === '--no-system') {
      system = null;
    } else if (!args[i].startsWith('--')) {
      scenarioDir = args[i];
    }
  }

  return { scenarioDir, model, system };
}

async function readFileOptional(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function main() {
  const { scenarioDir, model, system } = parseArgs(process.argv);

  if (!scenarioDir) {
    console.error('Error: scenario directory argument is required.');
    console.error('Usage: node probe-scenario.mjs <scenario-dir> [--model <model-id>]');
    process.exit(1);
  }

  const absScenarioDir = resolve(process.cwd(), scenarioDir);

  // Read PROMPT.md — required
  const promptPath = join(absScenarioDir, 'PROMPT.md');
  let promptContent;
  try {
    promptContent = await readFile(promptPath, 'utf8');
  } catch {
    console.error(`Error: could not read PROMPT.md from ${absScenarioDir}`);
    console.error('Check that the scenario directory exists and contains PROMPT.md.');
    process.exit(1);
  }

  // Read optional rubric
  const rubricPath = join(absScenarioDir, 'hidden-checks', 'rubric.md');
  const rubricContent = await readFileOptional(rubricPath);

  // Make the call
  let responseText;
  try {
    responseText = await callClaude({
      systemPrompt: system ?? undefined,
      userContent: promptContent.trim(),
      model,
    });
  } catch (err) {
    console.error(`Error: claude -p call failed — ${err.message}`);
    process.exit(1);
  }

  process.stdout.write(responseText);
  process.stdout.write('\n');

  // Optional rubric reminder
  if (rubricContent) {
    const preview = rubricContent.slice(0, RUBRIC_PREVIEW_CHARS);
    const truncated = rubricContent.length > RUBRIC_PREVIEW_CHARS ? '…' : '';
    console.log('\n--- Rubric reminder ---');
    console.log(preview + truncated);
  }
}

main();
