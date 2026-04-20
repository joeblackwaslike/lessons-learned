#!/usr/bin/env node

/**
 * embedder.mjs — Ollama embedding wrapper for nomic-embed-text (768 dims).
 *
 * Returns L2-normalized vectors so that L2 distance ≈ cosine distance in the
 * sqlite-vec virtual table.
 *
 * Configuration env vars:
 *   OLLAMA_URL            — base URL (default: http://localhost:11434)
 *   LESSONS_EMBED_MODEL   — model name (default: nomic-embed-text)
 */

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const MODEL = process.env.LESSONS_EMBED_MODEL ?? 'nomic-embed-text';

/** Dimensionality of the nomic-embed-text model. */
export const DIMS = 768;

/**
 * Embed text via Ollama and return an L2-normalized float array.
 *
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama embed failed (${res.status}): ${body}`);
  }

  const body = /** @type {any} */ (await res.json());
  const embedding = body.embedding;
  if (!Array.isArray(embedding) || embedding.length !== DIMS) {
    throw new Error(`Unexpected embedding shape: got ${embedding?.length} dims, expected ${DIMS}`);
  }

  return normalizeVec(embedding);
}

/**
 * Check that the Ollama embedding endpoint is reachable.
 * Returns true on success, throws with a human-readable message on failure.
 *
 * @returns {Promise<true>}
 */
export async function checkOllamaHealth() {
  const res = await fetch(`${OLLAMA_URL}/api/tags`).catch(err => {
    throw new Error(`Cannot reach Ollama at ${OLLAMA_URL}: ${err.message}`);
  });
  if (!res.ok) {
    throw new Error(`Ollama health check failed: HTTP ${res.status}`);
  }
  return true;
}

/**
 * @param {number[]} vec
 * @returns {number[]}
 */
function normalizeVec(vec) {
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return mag === 0 ? vec : vec.map(v => v / mag);
}
