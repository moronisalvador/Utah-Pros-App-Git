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
  REQUIRED_PATHS,
} from './mobile-readiness-preflight.mjs';

test('requires the program, canonical sources, generated adapters, and audit evidence', () => {
  assert.ok(REQUIRED_PATHS.includes('docs/mobile-production-readiness-roadmap.md'));
  assert.ok(REQUIRED_PATHS.includes('.claude/skills/mobile-readiness-wave/SKILL.md'));
  assert.ok(REQUIRED_PATHS.includes('.agents/skills/mobile-readiness-wave/SKILL.md'));
  assert.ok(REQUIRED_PATHS.includes('.codex/agents/mobile-readiness-security-reviewer.toml'));
  assert.ok(REQUIRED_PATHS.includes('docs/audit/mobile-pwa/13-findings-ledger.md'));
});

test('blocks main and detached HEAD while warning on direct dev work', () => {
  assert.equal(classifyBranch('main').level, 'error');
  assert.equal(classifyBranch('HEAD').level, 'error');
  assert.equal(classifyBranch('').level, 'error');
  assert.equal(classifyBranch('dev').level, 'warning');
  assert.equal(classifyBranch('codex/mobile-pwa-wave-r0').level, 'pass');
});
