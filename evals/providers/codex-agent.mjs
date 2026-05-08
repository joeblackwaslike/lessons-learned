/**
 * Promptfoo custom provider: OpenAI Codex SDK agent.
 * Mirrors claude-agent.mjs interface; runs codex CLI non-interactively.
 *
 * Phase 1: skeleton — fills in during Phase 3 when cross-agent eval is needed.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVALS_ROOT = resolve(__dirname, '..');
const MATERIALIZE_SCRIPT = join(EVALS_ROOT, 'scripts', 'materialize-workspace.mjs');

export default class CodexAgentProvider {
  constructor(options = {}) {
    this.model = options.model ?? 'codex-mini-latest';
    this.timeout = options.timeout ?? 300_000;
  }

  id() {
    return 'codex-agent';
  }

  async callApi(prompt, context, _options) {
    const { vars = {} } = context;
    const { scenarioId, intervention = { type: 'none', ids: [] } } = vars;

    if (!scenarioId) {
      throw new Error('Provider requires vars.scenarioId');
    }

    const scenarioDir = join(EVALS_ROOT, 'scenarios', scenarioId);
    if (!existsSync(scenarioDir)) {
      throw new Error(`Scenario directory not found: ${scenarioDir}`);
    }

    const workspaceDir = mkdtempSync(join(tmpdir(), `eval-codex-${scenarioId}-`));
    try {
      // Materialize workspace (same as claude-agent)
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

      // TODO Phase 3: locate codex binary and run non-interactively
      // const codexBin = findCodexBin();
      // const result = spawnSync(codexBin, ['--quiet', '-p', prompt], { cwd: workspaceDir, ... });
      throw new Error('codex-agent provider not yet implemented — add in Phase 3');
    } finally {
      try {
        rmSync(workspaceDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}
