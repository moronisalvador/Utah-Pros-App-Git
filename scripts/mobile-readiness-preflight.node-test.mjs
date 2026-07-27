/**
 * FILE: mobile-readiness-preflight.node-test.mjs
 *
 * WHAT THIS DOES (plain language):
 *   Proves the preflight requires the complete foundation and blocks unsafe Git states.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  scripts/mobile-readiness-preflight.mjs
 *
 * NOTES / GOTCHAS:
 *   - The test does not inspect credentials or call external systems.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyBranch,
  classifyRepositoryTopology,
  MOBILE_FOUNDATION_REF,
  REQUIRED_PATHS,
} from './mobile-readiness-preflight.mjs';

test('requires the program, canonical sources, generated adapters, and audit evidence', () => {
  assert.ok(REQUIRED_PATHS.includes('docs/mobile-production-readiness-roadmap.md'));
  assert.ok(
    REQUIRED_PATHS.includes('tooling/skills/mobile-readiness-wave/SKILL.md'),
  );
  assert.ok(
    REQUIRED_PATHS.includes('tooling/agents/mobile-readiness-security-reviewer.md'),
  );
  assert.ok(REQUIRED_PATHS.includes('.claude/skills/mobile-readiness-wave/SKILL.md'));
  assert.ok(
    REQUIRED_PATHS.includes('.claude/agents/mobile-readiness-security-reviewer.md'),
  );
  assert.ok(REQUIRED_PATHS.includes('.agents/skills/mobile-readiness-wave/SKILL.md'));
  assert.ok(REQUIRED_PATHS.includes('.codex/agents/mobile-readiness-security-reviewer.toml'));
  assert.ok(REQUIRED_PATHS.includes('docs/audit/mobile-pwa/13-findings-ledger.md'));
});

test('blocks main and detached HEAD while warning on direct dev work', () => {
  assert.equal(classifyBranch('main').level, 'error');
  assert.equal(classifyBranch('HEAD').level, 'error');
  assert.equal(classifyBranch('').level, 'error');
  assert.equal(classifyBranch('dev').level, 'warning');
  assert.equal(classifyBranch('codex/mobile-pwa-wave-r0').level, 'error');
  assert.equal(
    classifyBranch('codex/mobile-readiness-current-origin-review').level,
    'pass',
  );
});

test('requires current origin and the foundation as real ancestors', () => {
  const committedMerge = classifyRepositoryTopology({
    headSha: 'a'.repeat(40),
    originDevSha: 'b'.repeat(40),
    foundationSha: 'c'.repeat(40),
    originDevInHead: true,
    foundationInHead: true,
  });
  assert.equal(committedMerge.level, 'pass');
  assert.match(committedMerge.message, /both histories preserved by ancestry/);
});

test('accepts either parent direction during a resolved no-commit merge', () => {
  const currentOriginHead = classifyRepositoryTopology({
    headSha: 'a'.repeat(40),
    originDevSha: 'a'.repeat(40),
    foundationSha: 'c'.repeat(40),
    mergeHeadSha: 'd'.repeat(40),
    originDevInHead: true,
    foundationInMergeHead: true,
  });
  assert.equal(currentOriginHead.level, 'pass');

  const foundationHead = classifyRepositoryTopology({
    headSha: 'c'.repeat(40),
    originDevSha: 'a'.repeat(40),
    foundationSha: 'c'.repeat(40),
    mergeHeadSha: 'd'.repeat(40),
    originDevInMergeHead: true,
    foundationInHead: true,
  });
  assert.equal(foundationHead.level, 'pass');
});

test('rejects stale, rewritten, unresolved, or unverifiable topology', () => {
  const stale = classifyRepositoryTopology({
    headSha: 'a'.repeat(40),
    originDevSha: 'b'.repeat(40),
    foundationSha: 'c'.repeat(40),
    foundationInHead: true,
  });
  assert.equal(stale.level, 'error');
  assert.match(stale.message, /origin\/dev is not preserved/);

  const rewritten = classifyRepositoryTopology({
    headSha: 'a'.repeat(40),
    originDevSha: 'b'.repeat(40),
    foundationSha: 'c'.repeat(40),
  });
  assert.equal(rewritten.level, 'error');
  assert.match(rewritten.message, /foundation is not preserved/);

  const unresolved = classifyRepositoryTopology({
    headSha: 'a'.repeat(40),
    originDevSha: 'b'.repeat(40),
    foundationSha: 'c'.repeat(40),
    originDevInHead: true,
    foundationInHead: true,
    hasUnmergedEntries: true,
  });
  assert.equal(unresolved.level, 'error');
  assert.match(unresolved.message, /unresolved merge entries/);

  const missingFoundation = classifyRepositoryTopology({
    headSha: 'a'.repeat(40),
    originDevSha: 'b'.repeat(40),
    foundationSha: null,
    originDevInHead: true,
    ancestryCheckFailed: true,
  });
  assert.equal(missingFoundation.level, 'error');
  assert.match(missingFoundation.message, new RegExp(MOBILE_FOUNDATION_REF));
});
