#!/usr/bin/env node

/**
 * SessionStart hook: Injects the #lesson self-reporting protocol into every session.
 *
 * On startup/resume: inject the protocol instruction.
 * On clear/compact: re-inject (context was lost).
 *
 * stdin: JSON with { hook_event_name, session_id }
 * stdout: raw text (Claude Code SessionStart convention — NOT JSON)
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupByTag } from './lib/session-start.mjs';
import { LESSON_INJECTION_ORIENTATION, LESSON_PROTOCOL } from './lib/orientation.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH =
  process.env.LESSONS_MANIFEST_PATH ?? join(__dirname, '..', 'data', 'lesson-manifest.json');

function main() {
  let sessionType = '';
  let projectId = null;
  try {
    const stdin = readFileSync(0, 'utf8');
    const data = JSON.parse(stdin);
    sessionType = data.session_type ?? '';
    const cwd = data.cwd ?? '';
    if (cwd) projectId = cwd.replace(/\//g, '-').replace(/^-/, '');
  } catch {
    // If stdin is empty or malformed, treat as startup
  }

  const isCompact = sessionType === 'compact';

  let output = LESSON_PROTOCOL + '\n\n' + LESSON_INJECTION_ORIENTATION;
  if (isCompact) {
    try {
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
      // Use the same budget as session start — compact loses the prior injection, so we need the full corpus back
      const compactMaxBytes = manifest.config?.sessionStartBudgetBytes ?? 20000;
      const allLessons = Object.values(manifest.lessons).filter(
        l =>
          (l.type === 'directive' || l.type === 'protocol') &&
          !l.disabled &&
          (l.scope == null || l.scope === projectId)
      );
      const sorted = allLessons.slice().sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5));
      let bytesUsed = 0;
      const selected = [];
      for (const lesson of sorted) {
        const lessonBytes =
          (lesson.summary || '').length +
          (lesson.problem || '').length +
          (lesson.solution || '').length;
        if (bytesUsed + lessonBytes > compactMaxBytes) continue;
        selected.push(lesson);
        bytesUsed += lessonBytes;
      }
      const compactDirectives = selected
        .filter(l => l.type === 'directive')
        .sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5));
      const compactProtocols = selected
        .filter(l => l.type === 'protocol')
        .sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5));
      const skippedCount = sorted.length - selected.length;
      if (skippedCount > 0)
        process.stderr.write(
          `lessons-learned: ${selected.length}/${sorted.length} lessons injected on compact, ${skippedCount} skipped (budget)\n`
        );
      if (compactDirectives.length > 0) {
        output += '\n\n## Non-Negotiable Directives\n\n<IMPORTANT>\n';
        output +=
          'These are non-negotiable rules derived from real failures. Applying them is not optional.\n';
        output += '</IMPORTANT>\n';
        const dGroups = groupByTag(compactDirectives);
        const useHeaders = dGroups.length > 1;
        for (const [tag, group] of dGroups) {
          if (useHeaders) output += `\n### ${tag}\n`;
          for (const l of group) output += `\n${l.message}\n`;
        }
      }
      if (compactProtocols.length > 0) {
        output += '\n\n---\n\n## Active Protocols\n\n';
        output +=
          'The following protocols capture hard-won coordination patterns. Apply before starting work in the relevant context.\n';
        const pGroups = groupByTag(compactProtocols);
        const useHeaders = pGroups.length > 1;
        for (const [tag, group] of pGroups) {
          if (useHeaders) output += `\n### ${tag}\n`;
          for (const l of group) output += `\n${l.message}\n`;
        }
      }
    } catch {
      // Manifest missing or unreadable — skip lessons silently
    }
    process.stdout.write(output);
    return;
  }

  // Append reasoning/meta lessons flagged for session-start injection
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    const reasoningLessons = Object.values(manifest.lessons).filter(
      l =>
        (l.type === 'protocol' || l.type === 'directive') &&
        !l.disabled &&
        (l.scope == null || l.scope === projectId)
    );

    const cfg = manifest.config ?? {};
    const ssMaxLessons = cfg.maxSessionStartLessons ?? 20;
    const ssMaxBytes = cfg.sessionStartBudgetBytes ?? 8192;

    // Sort all by priority desc, then greedily select within count + byte budgets
    const allSorted = reasoningLessons
      .slice()
      .sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5));
    let ssBytesUsed = 0;
    const ssSelected = [];
    for (const lesson of allSorted) {
      if (ssSelected.length >= ssMaxLessons) break;
      const lessonBytes =
        (lesson.summary || '').length +
        (lesson.problem || '').length +
        (lesson.solution || '').length;
      if (ssBytesUsed + lessonBytes > ssMaxBytes) continue;
      ssSelected.push(lesson);
      ssBytesUsed += lessonBytes;
    }
    const ssSkippedCount = allSorted.length - ssSelected.length;
    if (ssSkippedCount > 0)
      process.stderr.write(
        `lessons-learned: ${ssSelected.length}/${allSorted.length} lessons injected, ${ssSkippedCount} skipped (budget)\n`
      );

    const directives = ssSelected
      .filter(l => l.type === 'directive')
      .sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5));
    const protocols = ssSelected
      .filter(l => l.type === 'protocol')
      .sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5));

    if (directives.length > 0) {
      output += '\n\n## Non-Negotiable Directives\n\n';
      output += '<IMPORTANT>\n';
      output += 'These are non-negotiable rules derived from real failures with measurable cost. ';
      output += 'Applying them is not optional — each one prevented a real incident. ';
      output += 'Skipping a rule to save time has caused real incidents.\n';
      output += '</IMPORTANT>\n';
      const dGroups = groupByTag(directives);
      const useHeaders = dGroups.length > 1;
      for (const [tag, group] of dGroups) {
        if (useHeaders) output += `\n### ${tag}\n`;
        for (const l of group) output += `\n${l.message}\n`;
      }
    }

    if (protocols.length > 0) {
      output += '\n\n---\n\n## Active Protocols\n\n';
      output += 'The following protocols capture hard-won coordination patterns. ';
      output +=
        'Apply before starting work in the relevant context — they save time, tokens, and turmoil.\n';
      const pGroups = groupByTag(protocols);
      const useHeaders = pGroups.length > 1;
      for (const [tag, group] of pGroups) {
        if (useHeaders) output += `\n### ${tag}\n`;
        for (const l of group) output += `\n${l.message}\n`;
      }
    }
  } catch {
    // Manifest missing or unreadable — skip reasoning lessons silently
  }

  process.stdout.write(output);
}

main();
