import pluginJs from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import pluginEslintComments from 'eslint-plugin-eslint-comments';
import pluginImport from 'eslint-plugin-import';
import pluginJest from 'eslint-plugin-jest';
import pluginPrettier from 'eslint-plugin-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** @type {import('eslint').Linter.FlatConfig[]} */
const config = [
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'eslint.config.ts'],
  },

  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,

  {
    files: ['**/*.{js,ts}'],
    plugins: {
      import: pluginImport,
      prettier: pluginPrettier,
      'eslint-comments': pluginEslintComments,
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.json',
        },
        node: {
          extensions: ['.js', '.ts'],
        },
      },
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts'],
      },
    },
    languageOptions: {
      globals: globals.node,
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      quotes: ['error', 'single', { allowTemplateLiterals: true, avoidEscape: true }],
      'no-console': 'error',

      'prettier/prettier': 'error',

      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'error',
      'import/first': 'error',
      'import/newline-after-import': 'error',

      'eslint-comments/disable-enable-pair': 'error',
      'eslint-comments/no-duplicate-disable': 'error',
      'eslint-comments/no-unused-disable': 'error',
      'eslint-comments/no-unused-enable': 'error',
    },
  },

  {
    files: ['**/*.test.ts'],
    plugins: { jest: pluginJest },
    languageOptions: { globals: { ...globals.jest } },
    rules: {
      ...pluginJest.configs.recommended.rules,
      'jest/prefer-to-have-length': 'error',
      'jest/prefer-to-be': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];

export default config;
