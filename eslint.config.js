import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

function staticJsxAttributeValue(attribute) {
  if (!attribute?.value) return null
  if (attribute.value.type === 'Literal') return attribute.value.value
  if (attribute.value.type === 'JSXExpressionContainer'
      && attribute.value.expression?.type === 'Literal') {
    return attribute.value.expression.value
  }
  return null
}

export const uprUiPlugin = {
  rules: {
    'no-native-select': {
      meta: {
        type: 'suggestion',
        schema: [],
        messages: {
          replace: 'Use the UPR dropdown for this surface: SearchSelect in Collections, LookupSelect outside Collections, or the documented domain control.',
        },
      },
      create(context) {
        return {
          JSXOpeningElement(node) {
            if (node.name.type === 'JSXIdentifier' && node.name.name === 'select') {
              context.report({ node, messageId: 'replace' })
            }
          },
        }
      },
    },
    'no-native-date-input': {
      meta: {
        type: 'suggestion',
        schema: [],
        messages: {
          replace: 'Use DatePicker (or CrmDatePicker on CRM surfaces) instead of the browser-native date control.',
        },
      },
      create(context) {
        return {
          JSXOpeningElement(node) {
            if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'input') return
            const typeAttribute = node.attributes.find((attribute) =>
              attribute.type === 'JSXAttribute'
              && attribute.name.type === 'JSXIdentifier'
              && attribute.name.name === 'type')
            if (staticJsxAttributeValue(typeAttribute) === 'date') {
              context.report({ node, messageId: 'replace' })
            }
          },
        }
      },
    },
  },
}

export default defineConfig([
  // .claude/workflows are Claude Code workflow DSL scripts (top-level return/await,
  // injected globals like agent()/phase()) — not parseable as standard modules.
  globalIgnores(['dist', '.claude/workflows']),
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
      // Runtime TDZ guard. WARN preserves the existing baseline while CI's changed-files
      // `--max-warnings 0` ratchet blocks new or touched variable-before-definition defects.
      'no-use-before-define': ['warn', {
        variables: true,
        functions: false,
        classes: false,
      }],
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
    // Native browser selects and date inputs also bypass UPR's visual system. WARN keeps legacy
    // debt behind the changed-files baseline while blocking new instances. src/lib + functions are exempt.
    files: ['src/pages/**/*.{js,jsx}', 'src/components/**/*.{js,jsx}'],
    plugins: {
      upr: uprUiPlugin,
    },
    rules: {
      'no-restricted-imports': ['warn', {
        paths: [{
          name: '@/lib/supabase',
          importNames: ['db'],
          message: 'Use const { db } = useAuth() — the @/lib/supabase db is an unauthenticated bootstrap singleton.',
        }],
      }],
      'upr/no-native-select': 'warn',
      'upr/no-native-date-input': 'warn',
    },
  },
])
