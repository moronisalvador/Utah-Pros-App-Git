#!/usr/bin/env node
// ════════════════════════════════════════════════
// FILE: scripts/capture-eslint-ratchet-baseline.node-test.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Proves the baseline re-capture tool refuses to hand the repository more lint
//   debt than it already has, unless a human explicitly says so. The important
//   case is the quiet one: a file the baseline has never named is not "unknown",
//   it is pinned at zero, so letting it appear for free would freeze brand-new
//   debt without anybody noticing.
//
// DEPENDS ON:
//   Internal: scripts/capture-eslint-ratchet-baseline.mjs
//   Data:     deterministic fixtures only. No lint run, no network, no writes.
// ════════════════════════════════════════════════

import assert from 'node:assert/strict';
import test from 'node:test';
import { diffBaselines, sortFindings } from './capture-eslint-ratchet-baseline.mjs';

test('a newly recorded file counts as an expansion, not a free addition', () => {
  // The regression this guards: check-eslint-ratchet.mjs resolves a missing entry
  // to allowed = 0. Treating "file absent from the baseline" as neutral is what
  // would let an accidental --write freeze debt that did not exist yesterday.
  const result = diffBaselines(
    {},
    { 'src/New.jsx': { 'warning:no-use-before-define': 3, 'error:no-unused-vars': 1 } },
  );

  assert.equal(result.expansions, 1);
  assert.deepEqual(result.raises, []);
  assert.deepEqual(result.added, [
    'src/New.jsx: 0 → 4 finding(s) across 2 rule(s)',
  ]);
});

test('a rising count on a recorded file is an expansion', () => {
  const result = diffBaselines(
    { 'src/Page.jsx': { 'warning:no-use-before-define': 2 } },
    { 'src/Page.jsx': { 'warning:no-use-before-define': 5 } },
  );

  assert.equal(result.expansions, 1);
  assert.deepEqual(result.raises, ['src/Page.jsx warning:no-use-before-define: 2 → 5']);
  assert.deepEqual(result.added, []);
});

test('shrinking is never an expansion and needs no flag', () => {
  const result = diffBaselines(
    {
      'src/Page.jsx': { 'warning:no-use-before-define': 9, 'error:no-unused-vars': 2 },
      'src/Fixed.jsx': { 'error:no-empty': 1 },
    },
    { 'src/Page.jsx': { 'warning:no-use-before-define': 4 } },
  );

  assert.equal(result.expansions, 0);
  assert.deepEqual(result.raises, []);
  assert.deepEqual(result.added, []);
  // A rule that fell to zero inside a still-dirty file must still be reported,
  // otherwise the dry run under-reports the cleanup it is about to record.
  assert.deepEqual(result.shrinks, [
    'src/Page.jsx error:no-unused-vars: 2 → 0',
    'src/Page.jsx warning:no-use-before-define: 9 → 4',
  ]);
  assert.deepEqual(result.removed, ['src/Fixed.jsx']);
});

test('an unchanged capture is a no-op, so re-running never drifts the baseline', () => {
  const findings = { 'src/Page.jsx': { 'warning:no-use-before-define': 3 } };
  const result = diffBaselines(findings, findings);

  assert.equal(result.expansions, 0);
  assert.deepEqual(result.shrinks, []);
  assert.deepEqual(result.removed, []);
});

test('findings are sorted so a re-capture yields a reviewable diff', () => {
  const sorted = sortFindings({
    'src/B.jsx': { 'warning:no-use-before-define': 1, 'error:no-unused-vars': 2 },
    'src/A.jsx': { 'error:no-empty': 1 },
  });

  assert.deepEqual(Object.keys(sorted), ['src/A.jsx', 'src/B.jsx']);
  assert.deepEqual(Object.keys(sorted['src/B.jsx']), [
    'error:no-unused-vars',
    'warning:no-use-before-define',
  ]);
});
