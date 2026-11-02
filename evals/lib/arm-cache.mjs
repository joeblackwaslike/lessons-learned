/**
 * Arm result cache shared by the agent providers.
 *
 * A cache entry is keyed by scenario content, model, intervention, lesson content,
 * the resolved `requires` set, the agent CLI version, and (for statistical trials) a
 * trial id, so repeated trials never collapse into one cached result.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EVALS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Cache directory: `EVAL_CACHE_DIR`, else `evals/results/cache`. */
export function cacheDir() {
  return process.env.EVAL_CACHE_DIR ?? join(EVALS_ROOT, 'results', 'cache');
}

/**
 * sha256 over scenario content, model, intervention, optional lesson hash and requires
 * signature, then `:cli=<cliVersion>` always and `:trial=<trialId>` when set. Overlay
 * interventions hash the overlay dir's content (not its path, which is a temp dir).
 */
export function computeCacheKey(
  scenarioDir,
  intervention,
  model,
  lessonContentHash = null,
  requiresSignature = '',
  trial = { trialId: null, cliVersion: '' }
) {
  const sortedIntervention = {
    type: intervention.type ?? 'none',
    ids: [...(intervention.ids ?? [])].sort((a, b) => a.localeCompare(b)),
  };
  const hash = createHash('sha256')
    .update(hashDir(scenarioDir))
    .update(':')
    .update(model)
    .update(':')
    .update(JSON.stringify(sortedIntervention));
  if (intervention.type === 'overlay') hash.update(':overlay=').update(hashDir(intervention.dir));
  if (lessonContentHash) hash.update(':').update(lessonContentHash);
  if (requiresSignature) hash.update(':').update(requiresSignature);
  hash.update(':cli=').update(trial.cliVersion ?? '');
  if (trial.trialId) hash.update(':trial=').update(String(trial.trialId));
  return hash.digest('hex');
}

/** Return the cached arm result marked `cacheHit: true`, or null on a miss. */
export function tryArmCache(cacheFile, isControl, controlTranscriptFile) {
  if (!existsSync(cacheFile)) return null;
  let cached;
  try {
    cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch {
    return null;
  }
  if (isControl && cached.output && !existsSync(controlTranscriptFile)) {
    writeControlTranscript(controlTranscriptFile, cached.output);
  }
  return { ...cached, metadata: { ...cached.metadata, cacheHit: true } };
}

/** Best-effort write of a control arm's transcript for the Tier 3 judge. */
export function writeControlTranscript(controlTranscriptFile, output) {
  try {
    mkdirSync(dirname(controlTranscriptFile), { recursive: true });
    writeFileSync(controlTranscriptFile, JSON.stringify({ output }, null, 2));
  } catch {
    /* best-effort */
  }
}

/** Hash of every file's path, mode, and content under `dir`, skipping `node_modules/` and `.git/`. */
export function hashDir(dir) {
  const hash = createHash('sha256');
  for (const relPath of collectFiles(dir).sort()) {
    hash.update(relPath);
    hash.update(statSync(join(dir, relPath)).mode.toString(8));
    hash.update(readFileSync(join(dir, relPath)));
  }
  return hash.digest('hex');
}

function collectFiles(dir, base = '') {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectFiles(join(dir, entry.name), rel));
    } else if (entry.isFile() && !rel.startsWith('node_modules/') && !rel.startsWith('.git/')) {
      results.push(rel);
    }
  }
  return results;
}

const versions = new Map();

/** `<bin> --version`, read once per binary path. Throws when the CLI cannot report one. */
export function cliVersion(bin) {
  if (versions.has(bin)) return versions.get(bin);
  const result = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 30_000 });
  const version = (result.stdout ?? '').trim();
  if (result.status !== 0 || !version) {
    throw new Error(`cannot read ${bin} --version: ${(result.stderr ?? '').slice(0, 200)}`);
  }
  versions.set(bin, version);
  return version;
}
