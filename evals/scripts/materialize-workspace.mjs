#!/usr/bin/env node
/**
 * materialize-workspace.mjs
 *
 * Copies a scenario's seed-workspace into a temp directory and injects the
 * lesson variant specified by the intervention config.
 *
 * Usage:
 *   node scripts/materialize-workspace.mjs \
 *     --scenario <path/to/TC-XX-name> \
 *     --workspace <path/to/temp-dir> \
 *     --intervention '{"type":"lesson","ids":["slug-abc123"]}'
 *
 * Side effects:
 *   - Copies seed-workspace/** into <workspace>/
 *   - Writes .eval/lesson-manifest.json with the intervention's lessons only
 *     (empty manifest for type=none; full filtered manifest for type=lesson|lesson-group)
 *
 * Exits 0 on success, non-zero on error.
 */

import { cpSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVALS_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(EVALS_ROOT, '..');
const MANIFEST_SOURCE = join(REPO_ROOT, 'data', 'lesson-manifest.json');

// --- Arg parsing ----------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));

const scenarioDir = resolve(args['--scenario'] ?? '');
const workspaceDir = resolve(args['--workspace'] ?? '');
const intervention = parseIntervention(args['--intervention'] ?? '{"type":"none","ids":[]}');

if (!scenarioDir || !workspaceDir) {
  console.error(
    'Usage: materialize-workspace.mjs --scenario <dir> --workspace <dir> [--intervention <json>]'
  );
  process.exit(1);
}

// --- Seed workspace copy --------------------------------------------------------

const seedDir = join(scenarioDir, 'seed-workspace');
if (existsSync(seedDir)) {
  cpSync(seedDir, workspaceDir, { recursive: true });
}

// --- Seed setup script ----------------------------------------------------------
// If the scenario has a seed-setup.mjs, run it after copying the seed.
// This handles complex initialization like creating git repos, branches, etc.
// argv[2] = workspaceDir

const seedSetupScript = join(scenarioDir, 'seed-setup.mjs');
if (existsSync(seedSetupScript)) {
  const result = spawnSync(process.execPath, ['--no-warnings', seedSetupScript, workspaceDir], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.status !== 0) {
    console.error(`seed-setup.mjs failed:\n${result.stderr}`);
    process.exit(1);
  }
}

// --- Lesson manifest injection --------------------------------------------------

const evalMetaDir = join(workspaceDir, '.eval');
mkdirSync(evalMetaDir, { recursive: true });

const manifest = buildInterventionManifest(intervention);
writeFileSync(join(evalMetaDir, 'lesson-manifest.json'), JSON.stringify(manifest, null, 2));

// Write intervention metadata for artifact collector.
// Do not include scenarioId — agents that read .eval/ could use it to locate and explore
// the eval repo on the host filesystem.
writeFileSync(
  join(evalMetaDir, 'intervention.json'),
  JSON.stringify({ type: intervention.type, ids: intervention.ids ?? [] }, null, 2)
);

// --- Hook shim installation -----------------------------------------------------
// Install eval-hook-shim.mjs as a PreToolUse hook in the workspace .claude/settings.json.
// The shim logs tool call events to .eval/hook-events.ndjson for trajectory analysis.
//
// Also install the lesson inject hook at project level so hint/guard lessons fire
// even when the eval agent runs with a fake HOME (no global ~/.claude/settings.json).

const shimPath = resolve(__dirname, 'eval-hook-shim.mjs');
const postShimPath = resolve(__dirname, 'eval-post-hook-shim.mjs');
const lessonInjectPath = resolve(EVALS_ROOT, '..', 'hooks', 'pretooluse-lesson-inject.mjs');
const claudeDir = join(workspaceDir, '.claude');
const settingsPath = join(claudeDir, 'settings.json');
mkdirSync(claudeDir, { recursive: true });

let workspaceSettings = {};
if (existsSync(settingsPath)) {
  try {
    workspaceSettings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    // use empty default
  }
}
const uvCacheForMcp = join(EVALS_ROOT, '.uv-cache');
const serenaServerConfig = {
  type: 'stdio',
  command: 'uvx',
  args: [
    '--from',
    'git+https://github.com/oraios/serena',
    'serena',
    'start-mcp-server',
    // Headless eval: never open Serena's web dashboard / GUI log window / browser tab.
    // Each treatment arm spawns a fresh Serena; without these, every arm pops a dashboard.
    '--enable-web-dashboard',
    'False',
    '--enable-gui-log-window',
    'False',
    '--open-web-dashboard',
    'False',
  ],
  env: { UV_CACHE_DIR: uvCacheForMcp },
};

// Write explicit MCP config file — passed via --mcp-config flag for non-control arms.
// Project-level mcpServers in settings.json are NOT loaded in --print mode (CC limitation).
writeFileSync(
  join(evalMetaDir, 'mcp-config.json'),
  JSON.stringify({ mcpServers: { serena: serenaServerConfig } }, null, 2)
);

// Keep in settings.json as belt-and-suspenders in case future CC versions load it.
workspaceSettings.mcpServers ??= {};
workspaceSettings.mcpServers['serena'] = serenaServerConfig;

workspaceSettings.hooks ??= {};
workspaceSettings.hooks.PreToolUse ??= [];
workspaceSettings.hooks.PreToolUse.push({
  matcher: '*',
  hooks: [{ type: 'command', command: `node "${shimPath}"`, timeout: 5 }],
});
if (existsSync(lessonInjectPath)) {
  workspaceSettings.hooks.PreToolUse.push({
    matcher: 'Read|Edit|Write|Bash|Glob',
    hooks: [{ type: 'command', command: `node "${lessonInjectPath}"`, timeout: 10 }],
  });
}
workspaceSettings.hooks.PostToolUse ??= [];
workspaceSettings.hooks.PostToolUse.push({
  matcher: 'Bash',
  hooks: [{ type: 'command', command: `node "${postShimPath}"`, timeout: 5 }],
});
if (intervention.type === 'claudemd') {
  // claudemd intervention: Serena directive is injected into CLAUDE.md below.
  // serena-hooks SessionStart/SessionEnd are intentionally omitted — they don't fire in --print mode.
}

writeFileSync(settingsPath, JSON.stringify(workspaceSettings, null, 2));

// --- Workspace scope directive --------------------------------------------------
// Inject a CLAUDE.md that constrains the agent to the workspace directory.
// Also injects protocol/directive lessons directly — more reliable than SessionStart hooks
// in --print mode, since CLAUDE.md is always loaded by Claude Code.
const claudeMdSections = [
  '# Workspace',
  '',
  'This is a self-contained project. Work only within the current directory.',
  'Do not explore paths outside this workspace or read system configuration files.',
];

const protocolLessons = Object.values(manifest.lessons ?? {}).filter(
  l => (l.type === 'protocol' || l.type === 'directive') && !l.disabled
);

if (protocolLessons.length > 0) {
  claudeMdSections.push(
    '',
    '# Active Protocols',
    '',
    'The following protocols apply to this session. Follow them strictly before taking any actions.',
    ...protocolLessons.flatMap(l => ['', l.message ?? `## ${l.summary}`])
  );
}

// For claudemd intervention: inject Serena usage directive directly into CLAUDE.md.
// SessionStart hooks do not fire in --print mode, so this is the only reliable injection point.
if (intervention.type === 'claudemd') {
  claudeMdSections.push(
    '',
    '# Serena Code Intelligence Protocol',
    '',
    'This workspace uses **Serena** for code navigation and editing.',
    'You MUST use Serena tools instead of native tools for all code work:',
    '',
    '1. Call `activate_project` first to initialize Serena for this workspace.',
    '2. Use `get_symbols_overview` or `find_symbol` to explore code structure (not native Read).',
    '3. Use `search_for_pattern` to search for patterns (not Bash grep).',
    '4. Use `find_file` to locate files (not Bash find).',
    '5. Use `replace_symbol_body` or `replace_content` to edit code (not native Edit/Write).',
    '',
    'Do not use native Read, Edit, Write, or Bash cat/grep/find on code files.'
  );
}

writeFileSync(join(workspaceDir, 'CLAUDE.md'), claudeMdSections.join('\n') + '\n');

// --- Helpers --------------------------------------------------------------------

function buildInterventionManifest(intervention) {
  if (intervention.type === 'none' || intervention.type === 'claudemd') {
    // Control arm or claudemd arm: empty lesson manifest — no lessons injected
    return { lessons: [], version: 1, generatedAt: new Date().toISOString() };
  }

  if (!existsSync(MANIFEST_SOURCE)) {
    console.warn(`lesson-manifest.json not found at ${MANIFEST_SOURCE} — using empty manifest`);
    return { lessons: [], version: 1, generatedAt: new Date().toISOString() };
  }

  let fullManifest;
  try {
    fullManifest = JSON.parse(readFileSync(MANIFEST_SOURCE, 'utf8'));
  } catch (err) {
    console.error(`Failed to parse lesson-manifest.json: ${err.message}`);
    process.exit(1);
  }

  // lessons is a record keyed by ULID
  const lessonsRecord = fullManifest.lessons ?? {};
  const ids = new Set(intervention.ids ?? []);

  if (ids.size === 0) {
    console.warn('intervention.ids is empty — no lessons will be injected');
    return { lessons: {}, version: 1, generatedAt: new Date().toISOString() };
  }

  // Filter to only the lessons specified in the intervention (match by slug or id)
  const filteredRecord = Object.fromEntries(
    Object.entries(lessonsRecord).filter(([id, lesson]) => ids.has(id) || ids.has(lesson.slug))
  );

  if (Object.keys(filteredRecord).length === 0) {
    console.warn(`No lessons matched intervention ids: ${[...ids].join(', ')}`);
  }

  return {
    lessons: filteredRecord,
    version: fullManifest.version ?? 1,
    generatedAt: new Date().toISOString(),
    evalIntervention: intervention,
  };
}

function parseIntervention(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    console.error(`Invalid --intervention JSON: ${raw}`);
    process.exit(1);
  }
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      result[argv[i]] = argv[i + 1];
      i++;
    }
  }
  return result;
}
