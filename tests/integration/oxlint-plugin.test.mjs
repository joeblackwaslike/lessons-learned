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

describe('oxlint-plugin.mjs rules', () => {
  it('reports a legacy octal literal in a .js file Oxlint parses as a script', () => {
    const { status, codes } = lint('octal.js', 'const n = 071;\nconsole.log(n);\n');
    assert.equal(status, 1);
    assert.ok(codes.includes('eslint-js(no-octal)'), codes.join(', '));
  });

  it('reports duplicate parameters in a .js file Oxlint parses as a script', () => {
    const { codes } = lint('dupe.js', 'function f(a, a) { return a; }\nf(1, 2);\n');
    assert.ok(codes.includes('eslint-js(no-dupe-args)'), codes.join(', '));
  });

  it('reports a control character written as a string escape in new RegExp()', () => {
    const { codes } = lint('regex.mjs', "export const r = new RegExp('a\\tb');\n");
    assert.ok(codes.includes('eslint-js(no-control-regex)'), codes.join(', '));
  });

  it('reports an escaped slash that follows an escaped backslash', () => {
    const { codes } = lint('escape.mjs', "export const s = '\\\\\\/';\n");
    assert.ok(codes.includes('eslint-js(no-useless-escape)'), codes.join(', '));
  });

  it('reports a redeclared var', () => {
    const { codes } = lint('redeclare.mjs', 'var a = 1;\nvar a = 2;\nexport { a };\n');
    assert.ok(codes.includes('eslint-js(no-redeclare)'), codes.join(', '));
  });

  it('reports a /* global */ comment', () => {
    const { codes } = lint('global.mjs', '/* global setTimeout */\nexport const t = setTimeout;\n');
    assert.ok(codes.includes('eslint-js(no-global-comment)'), codes.join(', '));
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
