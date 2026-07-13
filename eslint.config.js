import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // CLAUDE.md Rule 2 — mechanically enforced (zero existing violations, so error-level is safe).
      // Feedback is the upr:toast CustomEvent via src/lib/toast.js; destructive actions use two-click confirm.
      'no-alert': 'error',
      'no-restricted-globals': ['error',
        { name: 'confirm', message: 'No confirm() — use inline two-click confirm (CLAUDE.md Rule 2).' },
        { name: 'prompt', message: 'No prompt() — use an inline input (CLAUDE.md Rule 2).' },
      ],
      // Drift rules at WARN (large existing baseline; ratchet to error after the W3 toast codemod).
      // The 3-agent gauntlet (upr-pattern-checker / page-behavior-checker) treats new warnings as blockers
      // on changed files; the CI changed-files step surfaces them. Enforcement is per-touched-file, so the
      // untouched baseline never blocks an unrelated PR.
      'no-restricted-syntax': ['warn',
        {
          selector: "CallExpression[callee.property.name='dispatchEvent'] NewExpression[callee.name='CustomEvent'] Literal[value='upr:toast']",
          message: "Raw upr:toast dispatch — use toast()/ok()/err() from src/lib/toast.js.",
        },
      ],
    },
  },
  {
    // Components/pages must use `const { db } = useAuth()` — never the bootstrap singleton (Rule 3).
    // WARN so the existing baseline never blocks; touched files clean it. src/lib + functions are exempt.
    files: ['src/pages/**/*.{js,jsx}', 'src/components/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': ['warn', {
        paths: [{
          name: '@/lib/supabase',
          importNames: ['db'],
          message: 'Use const { db } = useAuth() — the @/lib/supabase db is an unauthenticated bootstrap singleton.',
        }],
      }],
    },
  },
])
