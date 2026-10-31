#!/usr/bin/env node
// Passes when each seeded record has exactly one normalized output and the process did not
// ingest its own output (no -normalized-normalized files).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
const workspaceDir = process.argv[2];
const files = readdirSync(join(workspaceDir, 'data', 'records'));
const normalized = files.filter(f => f.endsWith('-normalized.json'));
const selfIngested = files.filter(f => f.includes('-normalized-normalized'));
process.exit(normalized.length === 3 && selfIngested.length === 0 ? 0 : 1);
