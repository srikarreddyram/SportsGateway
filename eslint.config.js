import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['node_modules/**', 'web/**', 'results/**', 'grafana/**', 'k6/**', 'coverage/**', 'chromium_cli/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['error', 'warn'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // CLI-style code where stdout *is* the interface, not application logging that
    // should go through pino — the shared no-console rule doesn't apply here.
    files: ['scripts/**/*.mjs', 'mock-upstream/**/*.js'],
    rules: { 'no-console': 'off' },
  },
  prettier,
];
