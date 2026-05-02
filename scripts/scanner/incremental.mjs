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
 *   getResumeOffset(state, filePath) — byte offset to resume from (Tier 1/2)
 *   updateOffset(state, filePath, newOffset) — record Tier 1/2 progress
 *   getStructuralOffset(state, filePath) — byte offset for structural (Tier 3) scan
 *   updateStructuralOffset(state, filePath, newOffset) — record structural progress
 *   resetStructuralOffsets(state) — force full structural rescan on next run
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
 * Get the byte offset to resume scanning for a given file (Tier 1/2).
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
 * Get the byte offset for structural (Tier 3) scanning, tracked independently
 * from the regular Tier 1/2 offset. Defaults to 0 so structural can catch up
 * to files indexed by earlier scans before --structural was added.
 *
 * Reads both `structuralOffset` (new) and `semanticOffset` (legacy key) for
 * backwards compatibility with existing scan-state.json files.
 *
 * @param {object} state
 * @param {string} filePath — absolute path to JSONL file
 * @returns {number}
 */
export function getStructuralOffset(state, filePath) {
  const entry = state.files?.[filePath];
  if (!entry) return 0;

  try {
    const currentSize = statSync(filePath).size;
    if (currentSize < entry.fileSize) return 0;
  } catch {
    return 0;
  }

  return entry.structuralOffset ?? entry.semanticOffset ?? 0;
}

/**
 * Update the scan offset for a file after processing (Tier 1/2).
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
 * Update the structural scan offset independently from the regular offset.
 *
 * @param {object} state — mutable state object
 * @param {string} filePath — absolute path
 * @param {number} newOffset — byte position after last structurally-processed line
 */
export function updateStructuralOffset(state, filePath, newOffset) {
  state.files[filePath] = {
    ...state.files[filePath],
    structuralOffset: newOffset,
  };
}

/**
 * Reset structural offsets for all tracked files to 0, enabling a full structural
 * rescan without disturbing the regular (Tier 1/2) offsets.
 *
 * @param {object} state — mutable state object
 */
export function resetStructuralOffsets(state) {
  for (const filePath of Object.keys(state.files ?? {})) {
    state.files[filePath] = { ...state.files[filePath], structuralOffset: 0 };
  }
}

/**
 * Get the file size recorded at the last deep (LLM) scan for a file.
 * Returns 0 if the file has never been deep-scanned.
 *
 * The deep scanner reads whole files, so we track by file size (not byte offset).
 * If the current size differs from deepScanSize, the session has grown and needs re-scan.
 *
 * @param {object} state
 * @param {string} filePath
 * @returns {number}
 */
export function getDeepScanSize(state, filePath) {
  return state.files?.[filePath]?.deepScanSize ?? 0;
}

/**
 * Record the file size after a successful deep scan.
 *
 * @param {object} state — mutable state object
 * @param {string} filePath — absolute path
 * @param {number} fileSize — current size in bytes
 */
export function updateDeepScanSize(state, filePath, fileSize) {
  state.files[filePath] = {
    ...state.files[filePath],
    deepScanSize: fileSize,
    deepScanAt: new Date().toISOString(),
  };
}
