#!/usr/bin/env node

/**
 * Incremental scan state: tracks byte offsets per JSONL file.
 *
 * On each scan, we resume from the last-read byte position,
 * so only new data is processed. State is persisted to data/scan-state.json.
 *
 * Exports:
 *   loadScanState() — read persisted state
 *   saveScanState(state) — write state to disk
 *   getResumeOffset(state, filePath) — byte offset to resume from
 *   updateOffset(state, filePath, newOffset) — record progress
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = process.env.LESSONS_DATA_DIR
  ? join(process.env.LESSONS_DATA_DIR, 'scan-state.json')
  : join(__dirname, '..', '..', 'data', 'scan-state.json');

/**
 * Load persisted scan state from disk.
 *
 * @returns {{ files: Record<string, { offset: number, lastScanAt: string, fileSize: number }>, lastFullScanAt: string|null }}
 */
export function loadScanState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { files: {}, lastFullScanAt: null };
  }
}

/**
 * Persist scan state to disk.
 *
 * @param {object} state
 */
export function saveScanState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Get the byte offset to resume scanning for a given file.
 *
 * If the file has shrunk (e.g., rotated or replaced), resets to 0.
 *
 * @param {object} state
 * @param {string} filePath — absolute path to JSONL file
 * @returns {number} — byte offset to start reading from
 */
export function getResumeOffset(state, filePath) {
  const entry = state.files?.[filePath];
  if (!entry) return 0;

  // If file shrank, it was replaced — rescan from beginning
  try {
    const currentSize = statSync(filePath).size;
    if (currentSize < entry.fileSize) return 0;
  } catch {
    return 0;
  }

  return entry.offset ?? 0;
}

/**
 * Get the byte offset for semantic scanning, tracked independently from the
 * regular (Tier 1/2) offset. Defaults to 0 so semantic can catch up to files
 * that were already indexed by earlier scans before --semantic was added.
 *
 * @param {object} state
 * @param {string} filePath — absolute path to JSONL file
 * @returns {number}
 */
export function getSemanticOffset(state, filePath) {
  const entry = state.files?.[filePath];
  if (!entry) return 0;

  try {
    const currentSize = statSync(filePath).size;
    if (currentSize < entry.fileSize) return 0;
  } catch {
    return 0;
  }

  return entry.semanticOffset ?? 0;
}

/**
 * Update the scan offset for a file after processing.
 *
 * @param {object} state — mutable state object
 * @param {string} filePath — absolute path
 * @param {number} newOffset — byte position after last processed line
 */
export function updateOffset(state, filePath, newOffset) {
  let fileSize;
  try {
    fileSize = statSync(filePath).size;
  } catch {
    fileSize = newOffset;
  }

  state.files[filePath] = {
    ...state.files[filePath],
    offset: newOffset,
    lastScanAt: new Date().toISOString(),
    fileSize,
  };
}

/**
 * Update the semantic scan offset independently from the regular offset.
 *
 * @param {object} state — mutable state object
 * @param {string} filePath — absolute path
 * @param {number} newOffset — byte position after last semantically-processed line
 */
export function updateSemanticOffset(state, filePath, newOffset) {
  state.files[filePath] = {
    ...state.files[filePath],
    semanticOffset: newOffset,
  };
}

/**
 * Reset semantic offsets for all tracked files to 0, enabling a full semantic rescan
 * without disturbing the regular (Tier 1/2) offsets.
 *
 * @param {object} state — mutable state object
 */
export function resetSemanticOffsets(state) {
  for (const filePath of Object.keys(state.files ?? {})) {
    state.files[filePath] = { ...state.files[filePath], semanticOffset: 0 };
  }
}
