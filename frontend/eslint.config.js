import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Generated / vendor directories that contain minified bundles.
  // Linting these is meaningless and drowns the real signal in noise.
  globalIgnores([
    'dist',
    'test-results',
    'playwright-report',
    'playwright-report-visual',
    'playwright-report-e2e',
    'blob-report',
    'node_modules',
  ]),
  {
    files: ['**/*.{js,jsx,mjs}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Unused-vars allowed if name starts with capital letter or
      // underscore (matches the convention in this codebase for
      // intentionally-unused destructured props / catch bindings).
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_?e?$' }],
      // Empty catch blocks are idiomatic here for "best-effort" operations
      // (localStorage, clipboard writes, in-flight network calls during
      // teardown). Each one is intentional.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // We deliberately match ANSI/OSC control characters in regex
      // (parser.js, NotebookCell.jsx). The linter flags this but it's
      // exactly what we mean.
      'no-control-regex': 'off',
    },
  },
])
