#!/usr/bin/env node
// record-turn.mjs — recording-only tooling for building demo-live.tape.
//
// Not a documented CLI surface, never reference this from README/docs as
// something a user runs. It exists solely to drive one turn of a real
// `claude -p` session and print ONLY the final assistant text (the
// `result`-type stream-json event's `.result` field), suppressing all
// tool_use/tool_result/thinking content — so a vhs recording of this
// script's stdout never shows the plugin's internal `scripts/lessons.mjs`
// invocations, while the underlying tool calls are still genuinely real.
//
// Usage:
//   node website/static/record-turn.mjs [--session-file <path>] "<message>"
//
// If --session-file is given and the file already contains a session id,
// that turn resumes the prior session via `claude -p --resume`. The new
// session id is written back to the same file after the turn completes, so
// chaining turns is just repeated invocations with the same --session-file.
//
// Requires LESSONS_DATA_DIR / LESSONS_SCAN_PATH to already be set by the
// caller (never touches data/lessons.db).

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

function parseArgs(argv) {
  let sessionFile = null;
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--session-file') {
      sessionFile = argv[i + 1];
      i += 1;
    } else {
      rest.push(argv[i]);
    }
  }
  if (rest.length !== 1) {
    console.error('Usage: record-turn.mjs [--session-file <path>] "<message>"');
    process.exit(1);
  }
  return { sessionFile, message: rest[0] };
}

async function runTurn(message, resumeId) {
  const args = [
    '-p',
    message,
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--dangerously-skip-permissions',
  ];
  if (resumeId) {
    args.push('--resume', resumeId);
  }

  const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'inherit'] });

  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk.toString('utf8');
  });

  const exitCode = await new Promise(resolve => {
    child.on('close', resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`claude -p exited with code ${exitCode}`);
  }

  const resultLine = buffer
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .find(event => event.type === 'result');

  if (!resultLine) {
    throw new Error('No result event found in stream-json output');
  }

  return { text: resultLine.result, sessionId: resultLine.session_id };
}

const { sessionFile, message } = parseArgs(process.argv.slice(2));

const resumeId =
  sessionFile && existsSync(sessionFile) ? readFileSync(sessionFile, 'utf8').trim() : undefined;

const { text, sessionId } = await runTurn(message, resumeId);

if (sessionFile) {
  writeFileSync(sessionFile, sessionId);
}

process.stdout.write(`${text}\n`);
