#!/usr/bin/env node

/**
 * PreCompact hook: Generates a session handoff via `claude -p`, then blocks compaction.
 *
 * Exit code 2 blocks compaction. The hook outputs a fenced handoff prompt so the user
 * can paste it into a new session to continue work with full context.
 *
 * stdin: JSON with { hook_event_name, session_id, transcript_path }
 * stdout: raw text injected before compaction is blocked
 */

import { readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';

const CLAUDE_BIN = '/Users/joeblack/.nvm/versions/node/v24.10.0/bin/claude';

function parseTranscript(path) {
  let msgChars = 0;
  let attachChars = 0;
  const entries = [];

  let raw;
  try {
    raw = readFileSync(path, 'utf8').trim();
  } catch {
    return { entries, msgChars, attachChars };
  }

  for (const line of raw.split('\n')) {
    try {
      const d = JSON.parse(line);
      if (d.type === 'user') {
        const c = d.message?.content;
        const text = typeof c === 'string' ? c
          : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join('\n') : '';
        // Strip injected system context — only keep the actual user message
        const clean = text.split('<system-reminder>')[0].split('<ide_opened_file>')[0].trim();
        if (clean.length > 30) entries.push({ role: 'user', text: clean });
        msgChars += text.length;
      } else if (d.type === 'assistant') {
        const c = d.message?.content;
        if (Array.isArray(c)) {
          const text = c.filter(x => x.type === 'text').map(x => x.text).join('\n').trim();
          if (text.length > 100) entries.push({ role: 'assistant', text });
          msgChars += text.length;
        }
      } else if (d.type === 'attachment') {
        attachChars += JSON.stringify(d.attachment ?? {}).length;
      }
    } catch {}
  }

  return { entries, msgChars, attachChars };
}

async function generateHandoff(entries) {
  const convText = entries.map(e =>
    `${e.role === 'user' ? 'User' : 'Claude'}: ${e.text}`
  ).join('\n\n---\n\n');

  const prompt = `You are creating a session handoff document. The session is about to be interrupted.

Produce a structured handoff that preserves ALL important context so work can continue seamlessly in a new session. Include:
- Original task and overall goal
- Key decisions made and WHY (rationale matters, not just what was decided)
- Current state: what's done, what's in progress, what's blocked
- Specific commands, file paths, issue IDs (never generalize these — list them exactly)
- Any mistakes encountered and their solutions
- Next concrete steps with specific issue IDs or commands

Be thorough. This handoff must preserve more context than an automated summary.

CONVERSATION:
${convText}`;

  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, ['-p', '--no-session-persistence'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stdin.write(prompt);
    child.stdin.end();

    // claude -p hangs after printing output due to post-response cleanup.
    // Kill after close event fires (which arrives before the hang begins).
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(out.trim() || null);
    }, 45000);

    child.on('close', () => {
      clearTimeout(timer);
      resolve(out.trim() || null);
    });

    child.on('error', () => resolve(null));
  });
}

function buildFallbackHandoff(entries) {
  let out = 'Session handoff (fallback — claude -p unavailable)\n\n';

  try {
    const active = execFileSync('bd', ['list', '--status=in_progress'], { encoding: 'utf8' }).trim();
    if (active) out += `## Active Issues\n${active}\n\n`;
  } catch {}

  try {
    const ready = execFileSync('bd', ['ready'], { encoding: 'utf8' }).trim();
    if (ready) out += `## Ready Work\n${ready}\n\n`;
  } catch {}

  try {
    const commits = execFileSync('git', ['log', '--oneline', '-10'], { encoding: 'utf8' }).trim();
    if (commits) out += `## Recent Commits\n${commits}\n\n`;
  } catch {}

  if (entries.length > 0) {
    out += '## Conversation\n\n';
    for (const e of entries) {
      out += `**${e.role === 'user' ? 'User' : 'Claude'}**: ${e.text}\n\n`;
    }
  }

  return out;
}

async function main() {
  let transcriptPath = null;

  try {
    const stdin = readFileSync(0, 'utf8');
    const data = JSON.parse(stdin);
    transcriptPath = data.transcript_path ?? null;
  } catch {}

  const { entries, msgChars, attachChars } = transcriptPath
    ? parseTranscript(transcriptPath)
    : { entries: [], msgChars: 0, attachChars: 0 };

  const totalChars = msgChars + attachChars;
  const approxTokens = Math.round(totalChars / 4);
  // PreCompact fires at exactly 80% — infer window from that
  const windowTokens = Math.round(approxTokens / 0.8);
  const approxK = Math.round(approxTokens / 1000);
  const windowK = Math.round(windowTokens / 1000);

  let summary = null;
  if (entries.length > 0) {
    summary = await generateHandoff(entries);
  }

  if (!summary) {
    summary = buildFallbackHandoff(entries);
  }

  process.stdout.write(`# [lessons-learned] Pre-Compact Handoff

Context: ~${approxK}k / ~${windowK}k tokens (~80%). Compaction would degrade inference quality — blocking to preserve session context.

Copy this prompt to continue in a new session:

\`\`\`
${summary}
\`\`\`
`);

  process.exit(2);
}

main();
