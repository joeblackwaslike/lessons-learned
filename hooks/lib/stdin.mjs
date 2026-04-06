/**
 * Parse hook stdin JSON for PreToolUse hooks.
 *
 * Claude Code pipes JSON to hook stdin:
 * {
 *   tool_name: "Bash",
 *   tool_input: { command: "pytest -v tests/" },
 *   session_id: "abc-123",
 *   cwd: "/path/to/project",
 *   agent_id: "main"
 * }
 */

import { readFileSync } from 'node:fs';
import { normalizeToolName } from './normalize-tool.mjs';

// Tools we care about (canonical CC names) — reject everything else at parse time
const SUPPORTED_TOOLS = new Set(['Bash', 'Read', 'Edit', 'Write', 'Glob']);

/**
 * Pure parse function — accepts a raw JSON string, returns a parsed hook input or null.
 * Normalizes tool names via LESSONS_AGENT_PLATFORM env var.
 *
 * @param {string} raw
 * @returns {{ toolName: string, toolInput: object, sessionId: string, agentId: string, cwd: string } | null}
 */
export function parsePayload(raw) {
  if (!raw || !raw.trim()) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const platform = process.env.LESSONS_AGENT_PLATFORM ?? 'cc';
  const rawToolName = parsed.tool_name;
  if (!rawToolName) return null;

  const toolName = normalizeToolName(rawToolName, platform);
  if (!SUPPORTED_TOOLS.has(toolName)) return null;

  return {
    toolName,
    toolInput: parsed.tool_input ?? {},
    sessionId: parsed.session_id ?? '',
    agentId: parsed.agent_id ?? 'main',
    cwd: parsed.cwd ?? '',
  };
}

/**
 * Read stdin (fd 0) and parse. Thin I/O wrapper around parsePayload.
 * @returns {{ toolName: string, toolInput: object, sessionId: string, agentId: string, cwd: string } | null}
 */
export function parseHookInput() {
  let raw;
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    return null;
  }
  return parsePayload(raw);
}
