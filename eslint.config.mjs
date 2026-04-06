import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    files: ['**/*.mjs', '**/*.js'],
    ignores: ['node_modules/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_?',
          ignoreRestSiblings: true,
        },
      ],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-throw-literal': 'error',
      'no-return-assign': 'error',
      'no-sequences': 'error',
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      'object-shorthand': 'error',
      'no-else-return': ['error', { allowElseIf: true }],
    },
  },
  {
    // Relax rules for test files
    files: ['tests/**/*.mjs'],
    rules: {
      'no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_?',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
];
