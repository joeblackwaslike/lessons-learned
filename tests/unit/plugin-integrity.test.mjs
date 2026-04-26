import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const COMMANDS_DIR = join(ROOT, 'commands');

// Matches executable invocations using hardcoded absolute paths (node, bash, etc.)
// Excludes inline code comments that show path examples (e.g. // /Users/joe/...)
const HARDCODED_PATH_RE = /(?:^|\s)(?:node|bash|sh|npx)\s+\/(?:Users|home)\/[^/\s]+\//gm;

describe('plugin integrity', () => {
  it('command files contain no hardcoded absolute paths', async () => {
    const files = (await readdir(COMMANDS_DIR)).filter(f => f.endsWith('.md'));
    assert.ok(files.length > 0, 'No command files found');

    const violations = [];
    for (const file of files) {
      const content = await readFile(join(COMMANDS_DIR, file), 'utf8');
      const matches = content.match(HARDCODED_PATH_RE);
      if (matches) {
        violations.push(`${file}: ${[...new Set(matches)].join(', ')}`);
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Command files must use \${CLAUDE_PLUGIN_ROOT} instead of hardcoded paths:\n  ${violations.join('\n  ')}`
    );
  });

  it('command files reference scripts via CLAUDE_PLUGIN_ROOT', async () => {
    const files = (await readdir(COMMANDS_DIR)).filter(f => f.endsWith('.md'));
    const withScripts = [];

    for (const file of files) {
      const content = await readFile(join(COMMANDS_DIR, file), 'utf8');
      if (content.includes('scripts/lessons.mjs')) {
        withScripts.push(file);
        // Every reference to lessons.mjs must be via CLAUDE_PLUGIN_ROOT
        const lines = content.split('\n').filter(l => l.includes('scripts/lessons.mjs'));
        for (const line of lines) {
          assert.match(
            line,
            /\$\{?CLAUDE_PLUGIN_ROOT\}?/,
            `${file}: scripts/lessons.mjs referenced without CLAUDE_PLUGIN_ROOT:\n  ${line.trim()}`
          );
        }
      }
    }

    assert.ok(
      withScripts.length > 0,
      'No command files reference scripts/lessons.mjs — test may be misconfigured'
    );
  });
});
