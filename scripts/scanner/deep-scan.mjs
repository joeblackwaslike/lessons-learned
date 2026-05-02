#!/usr/bin/env node

/**
 * Tier 4: LLM-powered deep session scanner.
 *
 * Reads entire session JSONL files and uses Claude Sonnet 4.6 (1M context)
 * to extract typed lesson candidates and project-scoped memory facts.
 *
 * Output streams:
 *   1. Lesson candidates (preventable_mistake, user_correction, tool_quirk,
 *      protocol_correction) → lessons.db as status='candidate', source='manual'
 *   2. Repo facts → ~/.claude/projects/<projectId>/memory/ as project memories
 *
 * Requires: ANTHROPIC_API_KEY in environment.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash, randomBytes } from 'node:crypto';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

// ─── Extraction prompt ────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are analyzing a Claude Code session transcript to extract actionable items.

Extract candidates in these 4 lesson types:
1. **preventable_mistake** — Agent did something wrong, failed, made a bad assumption, or had to retry.
2. **user_correction** — User explicitly corrected the agent: "no", "don't", "that's wrong", "use X instead", or similar direct feedback.
3. **tool_quirk** — Discovery about a CLI tool, API, or environment behavior that is non-obvious and would surprise a developer.
4. **protocol_correction** — User corrected agent BEHAVIOR (not code output): "stop over-explaining", "always inspect X first", "don't use Y approach".

Also extract:
5. **repo_fact** — A factual discovery about THIS project's structure, conventions, test commands, generated files, or deploy workflow. Not general programming knowledge.

For each candidate, silently apply these quality gates before emitting:
1. Would this change a future agent action in a DIFFERENT session?
2. Can you name the specific future trigger (tool, command, file path, situation)?
3. Can you scope it safely — global for general knowledge, project for this-codebase-only facts?
4. Can you state the problem/solution WITHOUT relying on this session's specific context?

If any answer is NO for lesson types 1–4, demote to repo_fact or discard entirely.

Output a JSON object with a "candidates" array. Each candidate uses one of these shapes:

For lesson types (preventable_mistake, user_correction, tool_quirk, protocol_correction):
{
  "type": "preventable_mistake" | "user_correction" | "tool_quirk" | "protocol_correction",
  "scope": "global" | "project",
  "recommended_lesson_type": "guard" | "hint" | "directive",
  "confidence": 0.0–1.0,
  "promotion_risk": "low" | "medium" | "high",
  "summary": "≤80 chars, imperative voice",
  "problem": "what went wrong or what was discovered — 1–3 sentences, no session-specific references",
  "solution": "the correction or best practice — 1–3 sentences",
  "future_trigger": "specific situation that would trigger this lesson in a future session",
  "tool_names": ["Bash"],
  "command_patterns": ["regex matching the triggering command, or empty array"]
}

For repo_fact:
{
  "type": "repo_fact",
  "scope": "project",
  "title": "short descriptive title (≤60 chars)",
  "description": "2–4 sentences describing the fact and why it matters for future work"
}

Typing rules:
- protocol_correction → recommended_lesson_type: "directive", promotion_risk: "high"
- user_correction → confidence ≥ 0.8 by default
- tool_quirk → scope "global" only if the quirk applies to the tool in general, not just this project
- repo_fact → always scope: "project"
- guard lessons: for things that should actively block a harmful action
- hint lessons: for things that should warn but not block

Emit at most 8 candidates total. Quality over quantity. If the session has no clear actionable patterns, emit an empty candidates array.

Output only the raw JSON object, no markdown fences.`;

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Deep-scan a single JSONL session file using an LLM.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} filePath — absolute path to session JSONL
 * @param {{ verbose?: boolean, dryRun?: boolean }} [opts]
 * @param {string|null} [projectId]
 * @returns {Promise<{ candidatesInserted: number, memoryWritten: number, turnsProcessed: number }>}
 */
export async function deepScanFile(db, filePath, opts = {}, projectId = null) {
  const { verbose = false, dryRun = false } = opts;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set — deep scan requires it');

  const turns = await parseJSONL(filePath);
  if (turns.length < 5) {
    if (verbose)
      process.stderr.write(
        `  [deep] ${basename(filePath)}: too short (${turns.length} turns), skipping\n`
      );
    return { candidatesInserted: 0, memoryWritten: 0, turnsProcessed: turns.length };
  }

  const transcript = buildTranscript(turns);
  if (!transcript.trim()) return { candidatesInserted: 0, memoryWritten: 0, turnsProcessed: 0 };

  if (verbose) {
    process.stderr.write(
      `  [deep] ${basename(filePath)}: ${turns.length} turns, ${Math.round(transcript.length / 1000)}k chars\n`
    );
  }

  const client = new Anthropic({ apiKey });
  let rawOutput = '';

  const message = await client.messages.create(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Session transcript:\n\n${transcript}` }],
    },
    { headers: { 'anthropic-beta': 'context-1m-2025-08-07' } }
  );

  rawOutput = message.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  let parsed;
  try {
    const jsonStr = rawOutput
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`LLM output was not valid JSON: ${rawOutput.slice(0, 300)}`);
  }

  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  let candidatesInserted = 0;
  let memoryWritten = 0;

  const { insertCandidate, updateRecord, generateUlid } = await import('../db.mjs');

  for (const c of candidates) {
    if (!c.type) continue;

    if (dryRun) {
      process.stderr.write(
        `  [deep] dry-run: ${c.type} — ${c.summary ?? c.title ?? '(no title)'}\n`
      );
      continue;
    }

    if (c.type === 'repo_fact') {
      if (projectId && c.title && c.description) {
        const wrote = writeProjectMemory(projectId, c.title, c.description);
        if (wrote) memoryWritten++;
      }
    } else {
      const record = buildDbRecord(c, projectId, generateUlid);
      const result = insertCandidate(db, record);
      if (result.ok) {
        candidatesInserted++;
        // Set scope via updateRecord (insertCandidate omits this column)
        if (c.scope === 'project' && projectId) {
          updateRecord(db, result.id, { scope: projectId });
        }
      }
    }
  }

  if (verbose) {
    process.stderr.write(
      `  [deep] ${basename(filePath)}: ${candidatesInserted} candidates, ${memoryWritten} memories\n`
    );
  }

  return { candidatesInserted, memoryWritten, turnsProcessed: turns.length };
}

// ─── JSONL parsing ────────────────────────────────────────────────────

async function parseJSONL(filePath) {
  const turns = [];
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.type === 'assistant') {
      const content = obj.message?.content;
      if (!Array.isArray(content)) continue;

      const text = content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim()
        .slice(0, 3000);

      const tools = content
        .filter(b => b.type === 'tool_use')
        .map(b => ({
          name: b.name,
          input: b.input ?? {},
        }));

      if (text || tools.length > 0) {
        turns.push({ role: 'assistant', text, tools });
      }
    } else if (obj.type === 'user') {
      const content = obj.message?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (block.type === 'text' && block.text?.trim()) {
          turns.push({ role: 'user', text: block.text.trim().slice(0, 1000) });
        } else if (block.type === 'tool_result') {
          let text = '';
          if (typeof block.content === 'string') {
            text = block.content;
          } else if (Array.isArray(block.content)) {
            text = block.content
              .filter(s => s.type === 'text')
              .map(s => s.text)
              .join('\n');
          }
          if (text.trim()) {
            turns.push({ role: 'tool_result', text: text.slice(0, 800) });
          }
        }
      }
    }
  }

  return turns;
}

// ─── Transcript builder ───────────────────────────────────────────────

function buildTranscript(turns) {
  const parts = [];
  for (const turn of turns) {
    if (turn.role === 'user') {
      parts.push(`[user] ${turn.text}`);
    } else if (turn.role === 'assistant') {
      for (const t of turn.tools ?? []) {
        const input =
          t.input?.command ??
          t.input?.file_path ??
          t.input?.prompt ??
          JSON.stringify(t.input).slice(0, 150);
        parts.push(`[tool:${t.name}] ${input}`);
      }
      if (turn.text) parts.push(`[assistant] ${turn.text}`);
    } else if (turn.role === 'tool_result') {
      parts.push(`[tool_result] ${turn.text}`);
    }
  }
  return parts.join('\n\n');
}

// ─── DB record builder ────────────────────────────────────────────────

function buildDbRecord(c, projectId, generateUlid) {
  const summary =
    (c.summary ?? '').slice(0, 80) || c.problem?.slice(0, 60) || 'LLM-extracted lesson';
  const problem = c.problem ?? '';
  const solution = c.solution ?? '';
  const trigger = c.future_trigger ?? '';

  const slug = generateSlug(summary);
  const contentHash =
    'sha256:' + createHash('sha256').update(`${problem}|${solution}|${trigger}`).digest('hex');

  const type = mapLessonType(c.recommended_lesson_type);
  const tags = [
    'scan:llm-deep',
    `candidate_type:${c.type}`,
    ...(c.promotion_risk === 'high' ? ['promotion_risk:high'] : []),
  ];

  return {
    id: generateUlid(),
    slug,
    status: 'candidate',
    type,
    summary,
    problem,
    solution,
    toolNames: Array.isArray(c.tool_names) ? c.tool_names : [],
    commandPatterns: Array.isArray(c.command_patterns) ? c.command_patterns : [],
    pathPatterns: [],
    priority: priorityFromType(c.type, c.confidence ?? 0.5),
    confidence: clamp(c.confidence ?? 0.5, 0, 1),
    tags,
    source: 'manual',
    sourceSessionIds: [],
    occurrenceCount: 1,
    sessionCount: 1,
    projectCount: 1,
    contentHash,
  };
}

function mapLessonType(rec) {
  if (rec === 'guard') return 'guard';
  if (rec === 'directive') return 'directive';
  if (rec === 'protocol') return 'protocol';
  return 'hint';
}

function priorityFromType(candidateType, confidence) {
  const base =
    candidateType === 'user_correction'
      ? 7
      : candidateType === 'preventable_mistake'
        ? 6
        : candidateType === 'tool_quirk'
          ? 5
          : candidateType === 'protocol_correction'
            ? 6
            : 4;
  return Math.min(10, Math.round(base + (confidence - 0.5) * 2));
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function generateSlug(summary) {
  const base = summary
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/-$/, '');
  return `${base}-${randomBytes(2).toString('hex').slice(0, 4)}`;
}

// ─── Project memory writer ────────────────────────────────────────────

/**
 * Write a repo_fact to the project's Claude memory directory.
 *
 * @param {string} projectId
 * @param {string} title
 * @param {string} description
 * @returns {boolean} — true if written, false if already existed
 */
function writeProjectMemory(projectId, title, description) {
  const memoryDir = join(homedir(), '.claude', 'projects', projectId, 'memory');
  const indexPath = join(memoryDir, 'MEMORY.md');

  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 45);
  const filename = `project_${slug}.md`;
  const filePath = join(memoryDir, filename);

  // Skip if already exists — rough dedup without reading content
  if (existsSync(filePath)) return false;

  const firstSentence = description.split(/\.\s/)[0].slice(0, 120);

  writeFileSync(
    filePath,
    `---\nname: ${title}\ndescription: ${firstSentence}\ntype: project\n---\n\n${description}\n`,
    'utf8'
  );

  // Update MEMORY.md index
  const entry = `- [${title}](${filename}) — ${firstSentence}`;
  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, entry + '\n', 'utf8');
  } else {
    const existing = readFileSync(indexPath, 'utf8');
    if (!existing.includes(filename)) {
      writeFileSync(indexPath, existing.trimEnd() + '\n' + entry + '\n', 'utf8');
    }
  }

  return true;
}
