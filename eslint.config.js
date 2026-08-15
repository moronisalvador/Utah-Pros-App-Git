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
  // Impeccable is a versioned upstream bundle; lint its source upstream instead of
  // applying UPR application rules to the harness-specific vendored copies.
  globalIgnores([
    'dist',
    '.claude/workflows',
    '.claude/skills/impeccable',
    '.agents/skills/impeccable',
  ]),
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
    // Node-executed tooling: one-off scripts and the upr-mcp server/tests run under Node,
    // not the browser, so `require`/`__dirname`/`Buffer`/`process` are genuinely defined.
    // The base block above declares only `globals.browser`, which reported those as
    // `no-undef` — findings that are a config gap, not defects. Declaring the real
    // environment is strictly better than baselining them: a frozen `no-undef` entry
    // would also mask a genuine undefined-variable typo in these same files.
    files: ['scripts/**/*.js', 'upr-mcp/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
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
      // OFF until SearchSelect earns it (2026-08-15 a11y review): a native
      // <select> gets roving arrow-key navigation, type-ahead, and listbox
      // semantics from the OS for free; SearchSelect currently has none of
      // those, so banning the native control today would push authors toward
      // a keyboard-WORSE component. Re-enable to 'warn' only after
      // SearchSelect gains arrow-key roving + aria-activedescendant, real
      // listbox/option roles, an aria-live filter-results region, and
      // focus-return-to-trigger on close. The rule implementation stays, and
      // its node-tests keep it working for that day.
      'upr/no-native-select': 'off',
      'upr/no-native-date-input': 'warn',
    },
  },
])
