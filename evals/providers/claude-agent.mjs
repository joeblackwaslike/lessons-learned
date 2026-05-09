/**
 * Promptfoo custom provider: runs Claude Code CLI non-interactively in a
 * materialized scenario workspace. Returns structured output for grading.
 *
 * Promptfoo file:// providers must export a class; the runner calls new Provider(options).
 *
 * callApi contract:
 *   prompt  — task text (contents of scenario PROMPT.md)
 *   context — { vars: { scenarioId, intervention, dialogFile? } }
 *   options — { config: { model, timeout } }
 *
 * Returns: { output: string, metadata: EvalArmMetadata }
 */

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVALS_ROOT = resolve(__dirname, '..');
const CACHE_DIR = join(EVALS_ROOT, 'results', 'cache');

const MATERIALIZE_SCRIPT = join(EVALS_ROOT, 'scripts', 'materialize-workspace.mjs');
const COLLECT_SCRIPT = join(EVALS_ROOT, 'scripts', 'collect-artifacts.mjs');

export default class ClaudeAgentProvider {
  constructor(options = {}) {
    this.model = options.model ?? 'claude-sonnet-4-6';
    this.timeout = options.timeout ?? 300_000;
  }

  id() {
    return 'claude-agent';
  }

  /**
   * @param {string} prompt
   * @param {{ vars: Record<string, unknown> }} context
   * @param {{ config?: { model?: string; timeout?: number } }} options
   * @returns {Promise<{ output: string; metadata?: Record<string, unknown> }>}
   */
  async callApi(prompt, context, options) {
    const { vars = {} } = context;
    if (typeof vars.scenarioId !== 'string' || !vars.scenarioId) {
      throw new Error('Provider requires vars.scenarioId (non-empty string)');
    }
    const scenarioId = vars.scenarioId;
    const { intervention = { type: 'none', ids: [] } } = vars;
    const model = options?.config?.model ?? this.model;
    const timeout = options?.config?.timeout ?? this.timeout;
    const startMs = Date.now();

    const scenarioDir = join(EVALS_ROOT, 'scenarios', scenarioId);
    if (!existsSync(scenarioDir)) {
      throw new Error(`Scenario directory not found: ${scenarioDir}`);
    }

    // Check arm cache before spinning up a workspace
    const cacheKey = computeCacheKey(scenarioDir, intervention, model);
    const cacheFile = join(CACHE_DIR, `${cacheKey}.json`);
    if (existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
        return { ...cached, metadata: { ...cached.metadata, cacheHit: true } };
      } catch {
        // corrupt cache — fall through to fresh run
      }
    }

    const workspaceDir = mkdtempSync(join(tmpdir(), `eval-${scenarioId}-`));
    try {
      // Materialize workspace: copy seed → temp dir, inject lesson variant
      const materializeResult = spawnSync(
        process.execPath,
        [
          '--no-warnings',
          MATERIALIZE_SCRIPT,
          '--scenario',
          scenarioDir,
          '--workspace',
          workspaceDir,
          '--intervention',
          JSON.stringify(intervention),
        ],
        { encoding: 'utf8', timeout: 30_000 }
      );

      if (materializeResult.status !== 0) {
        throw new Error(`materialize-workspace failed:\n${materializeResult.stderr}`);
      }

      // Find the claude binary
      const claudeBin = findClaudeBin();

      // Run Claude Code non-interactively in the materialized workspace
      const env = buildEnv(workspaceDir, intervention, scenarioId);
      const claudeResult = spawnSync(
        claudeBin,
        ['--print', '--dangerously-skip-permissions', '-p', prompt],
        {
          cwd: workspaceDir,
          env,
          encoding: 'utf8',
          timeout,
          maxBuffer: 10 * 1024 * 1024,
        }
      );

      const output = claudeResult.stdout ?? '';
      const stderr = claudeResult.stderr ?? '';

      // Write agent output for verify scripts and artifact collector
      const evalMetaDir = join(workspaceDir, '.eval');
      mkdirSync(evalMetaDir, { recursive: true });
      writeFileSync(join(evalMetaDir, 'agent-output.txt'), output);

      // Run hidden-checks/verify.mjs if present
      const verifyScriptPath = join(scenarioDir, 'hidden-checks', 'verify.mjs');
      let hiddenCheck = { pass: true, details: 'no verify script', skipped: true };
      if (existsSync(verifyScriptPath)) {
        const verifyResult = spawnSync(
          process.execPath,
          ['--no-warnings', verifyScriptPath, workspaceDir],
          { encoding: 'utf8', timeout: 30_000 }
        );
        hiddenCheck = {
          pass: verifyResult.status === 0,
          details: (verifyResult.stdout + verifyResult.stderr).trim(),
          exitCode: verifyResult.status,
          skipped: false,
        };
      }

      // Collect artifacts: hook events, workspace diff, tool trajectory
      const artifactsResult = spawnSync(
        process.execPath,
        ['--no-warnings', COLLECT_SCRIPT, '--workspace', workspaceDir, '--scenario', scenarioDir],
        { encoding: 'utf8', timeout: 10_000 }
      );

      let artifacts = {};
      if (artifactsResult.status === 0 && artifactsResult.stdout) {
        try {
          artifacts = JSON.parse(artifactsResult.stdout);
        } catch {
          // non-fatal — graders work with what they get
        }
      }

      const result = {
        output,
        metadata: {
          scenarioId,
          intervention,
          model,
          durationMs: Date.now() - startMs,
          exitCode: claudeResult.status,
          stderr: stderr.slice(0, 2000),
          hiddenCheck,
          artifacts,
          cacheHit: false,
          cacheKey,
        },
      };

      // Write to cache for future runs (only cache successful agent completions)
      if (claudeResult.status === 0) {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(cacheFile, JSON.stringify(result, null, 2));
      }

      return result;
    } finally {
      try {
        rmSync(workspaceDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}

function findClaudeBin() {
  const candidates = [
    process.env.CLAUDE_BIN,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    join(process.env.HOME ?? '', '.claude', 'bin', 'claude'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  try {
    const which = spawnSync('which', ['claude'], { encoding: 'utf8' });
    if (which.status === 0) return which.stdout.trim();
  } catch {
    // ignore
  }

  throw new Error('claude binary not found. Set CLAUDE_BIN env var or ensure claude is on PATH.');
}

function buildEnv(workspaceDir, intervention, scenarioId) {
  const env = { ...process.env };

  // Point lesson injection to the eval-scoped manifest (written by materialize-workspace.mjs)
  const manifestPath = join(workspaceDir, '.eval', 'lesson-manifest.json');
  if (existsSync(manifestPath)) {
    env.LESSONS_MANIFEST_PATH = manifestPath;
  }

  env.LESSONS_DISABLE_SCAN = '1';
  env.EVAL_SCENARIO_ID = scenarioId;
  env.EVAL_INTERVENTION_TYPE = intervention.type ?? 'none';
  env.EVAL_INTERVENTION_IDS = JSON.stringify(intervention.ids ?? []);

  return env;
}

/**
 * Compute a stable cache key for an arm run.
 * Key = sha256(scenarioContentHash : model : interventionJson)
 * Intervention ids are sorted so order doesn't affect the key.
 */
function computeCacheKey(scenarioDir, intervention, model) {
  const scenarioHash = hashDir(scenarioDir);
  const sortedIntervention = {
    type: intervention.type ?? 'none',
    ids: [...(intervention.ids ?? [])].sort((a, b) => a.localeCompare(b)),
  };
  return createHash('sha256')
    .update(scenarioHash)
    .update(':')
    .update(model)
    .update(':')
    .update(JSON.stringify(sortedIntervention))
    .digest('hex');
}

/** sha256 of all file contents under dir, sorted by relative path for stability */
function hashDir(dir) {
  const hash = createHash('sha256');
  for (const relPath of collectFiles(dir).sort()) {
    hash.update(relPath);
    hash.update(readFileSync(join(dir, relPath)));
  }
  return hash.digest('hex');
}

function collectFiles(dir, base = '') {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(abs, rel));
    } else if (entry.isFile()) {
      // Skip node_modules and .git for hashing
      if (!rel.startsWith('node_modules/') && !rel.startsWith('.git/')) {
        results.push(rel);
      }
    }
  }
  return results;
}
