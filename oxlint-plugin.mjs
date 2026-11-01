// Local Oxlint JS plugin. Holds the ESLint core rules that Oxlint lacks or under-reports, loaded
// from ESLint's own implementations so they behave exactly as they did under `eslint`.
//   no-octal, no-dupe-args: no native Oxlint rule ("superseded by strict mode"), but Oxlint
//     parses a .js file with no import/export as a sloppy script, where both can fire.
//   no-control-regex: native misses control characters written as string escapes,
//     e.g. new RegExp('a\tb').
//   no-useless-escape: native misses an escaped `/` after an escaped backslash ('\\\/').
//   no-redeclare: native and ESLint's agree on code; ESLint's is used so builtinGlobals
//     behaves exactly as before.
// Plus no-global-comment, which stands in for the one no-redeclare case a plugin can't see:
// ESLint flagged `/* global setTimeout */` (redeclaring a built-in). Oxlint ignores
// `/* global */` comments entirely, so any such comment is dead text here.
import { builtinRules } from 'eslint/use-at-your-own-risk';

const ESLINT_RULES = [
  'no-control-regex',
  'no-dupe-args',
  'no-octal',
  'no-redeclare',
  'no-useless-escape',
];

const noGlobalComment = {
  meta: { type: 'problem' },
  create: context => ({
    Program() {
      for (const comment of context.sourceCode.getAllComments()) {
        if (comment.type === 'Block' && /^\s*globals?\s/.test(comment.value)) {
          context.report({
            loc: comment.loc,
            message:
              'Oxlint ignores /* global */ comments. Add the name to `globals` in .oxlintrc.json.',
          });
        }
      }
    },
  }),
};

export default {
  meta: { name: 'eslint-js' },
  rules: {
    ...Object.fromEntries(ESLINT_RULES.map(name => [name, builtinRules.get(name)])),
    'no-global-comment': noGlobalComment,
  },
};
