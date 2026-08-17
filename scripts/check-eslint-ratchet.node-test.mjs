#!/usr/bin/env node
// ════════════════════════════════════════════════
// FILE: scripts/check-eslint-ratchet.node-test.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Proves the ESLint release ratchet blocks growth and allows debt to shrink.
//
// DEPENDS ON:
//   Internal: scripts/check-eslint-ratchet.mjs
//   Data:     deterministic fixtures only. No network or repository writes.
// ════════════════════════════════════════════════

import assert from 'node:assert/strict';
import test from 'node:test';
import { Linter } from 'eslint';
import { compareSummaries, summarizeResults } from './check-eslint-ratchet.mjs';
import { uprUiPlugin } from '../eslint.config.js';

function lintUi(source) {
  const linter = new Linter();
  return linter.verify(source, {
    plugins: { upr: uprUiPlugin },
    languageOptions: {
      ecmaVersion: 'latest',
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    rules: {
      'upr/no-native-select': 'warn',
      'upr/no-native-date-input': 'warn',
    },
  });
}

test('summarizes findings by file, severity, and rule', () => {
  const result = summarizeResults([
    {
      filePath: '/repo/src/Page.jsx',
      messages: [
        { severity: 2, ruleId: 'no-unused-vars' },
        { severity: 1, ruleId: 'no-unused-vars' },
        { severity: 2, ruleId: null },
      ],
    },
  ], '/repo');

  assert.deepEqual(result, {
    'src/Page.jsx': {
      'error:no-unused-vars': 1,
      'warning:no-unused-vars': 1,
      'error:parser': 1,
    },
  });
});

test('blocks a new rule or a count above baseline', () => {
  const result = compareSummaries(
    {
      'src/Page.jsx': {
        'warning:no-use-before-define': 2,
        'error:no-unused-vars': 1,
      },
    },
    {
      'src/Page.jsx': {
        'warning:no-use-before-define': 1,
      },
    },
  );

  assert.deepEqual(result.failures, [
    'src/Page.jsx error:no-unused-vars: found 1, baseline 0',
    'src/Page.jsx warning:no-use-before-define: found 2, baseline 1',
  ]);
});

test('allows findings to shrink and reports the baseline opportunity', () => {
  const result = compareSummaries(
    { 'src/Page.jsx': { 'warning:no-use-before-define': 1 } },
    { 'src/Page.jsx': { 'warning:no-use-before-define': 2 } },
  );

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.opportunities, [
    'src/Page.jsx warning:no-use-before-define: found 1, baseline 2',
  ]);
});

test('stays silent about baseline files that were not linted in this run', () => {
  // The ratchet lints only changed files, so most baseline entries are absent
  // from `actual`. Reporting those as shrunk claimed a cleanup that never
  // happened and buried the real output — 146 of 147 lines on a 3-file diff.
  const result = compareSummaries(
    { 'src/Touched.jsx': {} },
    {
      'src/Touched.jsx': {},
      'src/Untouched.jsx': { 'warning:no-use-before-define': 73 },
    },
  );

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.opportunities, []);
});

test('flags browser-native selects but leaves UPR components alone', () => {
  const messages = lintUi(`
    const Native = () => <select><option>One</option></select>;
    const Upr = () => <SearchSelect options={[]} />;
  `);

  assert.deepEqual(messages.map((message) => message.ruleId), ['upr/no-native-select']);
});

test('flags static browser-native date inputs in literal and expression forms', () => {
  const messages = lintUi(`
    const Literal = () => <input type="date" />;
    const Expression = () => <input type={'date'} />;
    const Text = () => <input type="text" />;
    const Upr = () => <DatePicker />;
  `);

  assert.deepEqual(messages.map((message) => message.ruleId), [
    'upr/no-native-date-input',
    'upr/no-native-date-input',
  ]);
});
