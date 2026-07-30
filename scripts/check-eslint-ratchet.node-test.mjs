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
import { compareSummaries, summarizeResults } from './check-eslint-ratchet.mjs';

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
