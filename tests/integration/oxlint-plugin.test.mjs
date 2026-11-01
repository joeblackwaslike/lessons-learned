import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const OXLINT = join(ROOT, 'node_modules/.bin/oxlint');
const CONFIG = join(ROOT, '.oxlintrc.json');

/**
 * Lints one file with the repo's Oxlint config and returns the rule codes it reported.
 *
 * @param {string} name - File name; the extension decides how Oxlint parses it
 * @param {string} source
 * @returns {{ status: number, codes: string[] }}
 */
function lint(name, source) {
  const dir = mkdtempSync(join(tmpdir(), 'oxlint-plugin-'));
  const file = join(dir, name);
  writeFileSync(file, source);
  const result = spawnSync(OXLINT, ['-c', CONFIG, '-f', 'json', file], { encoding: 'utf8' });
  const codes = JSON.parse(result.stdout).diagnostics.map(d => d.code);
  return { status: result.status, codes };
}

const VIOLATION_CASES = [
  {
    description: 'reports a legacy octal literal in a .js file Oxlint parses as a script',
    file: 'octal.js',
    source: 'const n = 071;\nconsole.log(n);\n',
    code: 'eslint-js(no-octal)',
  },
  {
    description: 'reports duplicate parameters in a .js file Oxlint parses as a script',
    file: 'dupe.js',
    source: 'function f(a, a) { return a; }\nf(1, 2);\n',
    code: 'eslint-js(no-dupe-args)',
  },
  {
    description: 'reports a control character written as a string escape in new RegExp()',
    file: 'regex.mjs',
    source: "export const r = new RegExp('a\\tb');\n",
    code: 'eslint-js(no-control-regex)',
  },
  {
    description: 'reports an escaped slash that follows an escaped backslash',
    file: 'escape.mjs',
    source: "export const s = '\\\\\\/';\n",
    code: 'eslint-js(no-useless-escape)',
  },
  {
    description: 'reports a redeclared var',
    file: 'redeclare.mjs',
    source: 'var a = 1;\nvar a = 2;\nexport { a };\n',
    code: 'eslint-js(no-redeclare)',
  },
  {
    description: 'reports a /* global */ comment',
    file: 'global.mjs',
    source: '/* global setTimeout */\nexport const t = setTimeout;\n',
    code: 'eslint-js(no-global-comment)',
  },
];

describe('oxlint-plugin.mjs rules', () => {
  for (const { description, file, source, code } of VIOLATION_CASES) {
    it(description, () => {
      const { codes } = lint(file, source);
      assert.ok(codes.includes(code), codes.join(', '));
    });
  }

  it('reports the octal literal as a lint failure', () => {
    const { status } = lint('octal-status.js', 'const n = 071;\nconsole.log(n);\n');
    assert.equal(status, 1);
  });

  it('passes clean code', () => {
    const { status, codes } = lint(
      'clean.mjs',
      "export const r = /a\\/b/;\nexport const s = 'a\\\\b';\n"
    );
    assert.deepEqual(codes, []);
    assert.equal(status, 0);
  });
});
