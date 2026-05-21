#!/usr/bin/env node

/**
 * SubagentStart hook: Injects the #lesson self-reporting protocol and
 * non-negotiable directives into spawned subagents.
 *
 * stdin: JSON with { session_id, agent_id, prompt, ... }
 * stdout: raw text injected as additional context for the subagent
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupByTag } from './lib/session-start.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH =
  process.env.LESSONS_MANIFEST_PATH ?? join(__dirname, '..', 'data', 'lesson-manifest.json');

const LESSON_PROTOCOL_COMPACT = `# [lessons-learned] Lesson Reporting

When you encounter or recover from a problem, emit:
\`\`\`
#lesson
tool: <tool_name>
trigger: <what_triggered_it>
problem: <what_went_wrong>
solution: <the_correction>
tags: <category:value, ...>
#/lesson
\`\`\`
Only tag genuine problem→solution sequences.`;

function main() {
  try {
    readFileSync(0, 'utf8');
  } catch {
    // consume stdin
  }

  let output = LESSON_PROTOCOL_COMPACT;

  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    const directives = Object.values(manifest.lessons)
      .filter(l => l.type === 'directive' && !l.disabled)
      .sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5));

    if (directives.length > 0) {
      output += '\n\n## Non-Negotiable Directives\n\n';
      output += '<IMPORTANT>\n';
      output += 'These are non-negotiable rules derived from real failures with measurable cost. ';
      output += 'Applying them is not optional — each one prevented a real incident.\n';
      output += '</IMPORTANT>\n';
      const groups = groupByTag(directives);
      const useHeaders = groups.length > 1;
      for (const [tag, group] of groups) {
        if (useHeaders) output += `\n### ${tag}\n`;
        for (const l of group) output += `\n${l.message}\n`;
      }
    }
  } catch {
    // Manifest missing or unreadable — skip directives silently
  }

  process.stdout.write(output);
}

main();
