/**
 * FILE: render-mobile-readiness-codex-adapters.node-test.mjs
 *
 * WHAT THIS DOES (plain language):
 *   Proves the mobile Codex adapters are present, reproducible, and tied to canonical UPR files.
 *   It also checks that safety and model settings survive the conversion.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  scripts/render-mobile-readiness-codex-adapters.mjs and generated adapters
 *
 * NOTES / GOTCHAS:
 *   - The test is intentionally repository-scoped because the manifest is checked-in project law.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkAdapters,
  expectedAdapters,
} from './render-mobile-readiness-codex-adapters.mjs';

test('renders four custom agents and one complete skill adapter', () => {
  const expected = expectedAdapters();
  const agentPaths = [...expected.keys()].filter((repoPath) => repoPath.endsWith('.toml'));
  const skillPaths = [...expected.keys()].filter((repoPath) =>
    repoPath.startsWith('.agents/skills/mobile-readiness-wave/'),
  );

  assert.equal(agentPaths.length, 4);
  assert.deepEqual(skillPaths.sort(), [
    '.agents/skills/mobile-readiness-wave/SKILL.md',
    '.agents/skills/mobile-readiness-wave/agents/openai.yaml',
  ]);
});

test('preserves bounded models, sandboxes, provenance, and safety instructions', () => {
  const expected = expectedAdapters();
  const mapper = expected.get('.codex/agents/mobile-readiness-mapper.toml');
  const security = expected.get('.codex/agents/mobile-readiness-security-reviewer.toml');
  const tester = expected.get('.codex/agents/mobile-readiness-contract-tester.toml');
  const release = expected.get('.codex/agents/mobile-readiness-release-auditor.toml');

  assert.match(mapper, /model = "gpt-5\.6-terra"/);
  assert.match(mapper, /sandbox_mode = "read-only"/);
  assert.match(security, /model = "gpt-5\.6-sol"/);
  assert.match(security, /sandbox_mode = "read-only"/);
  assert.match(tester, /sandbox_mode = "workspace-write"/);
  assert.match(release, /five-minute/);
  assert.match(release, /Never edit, deploy, apply/);
  assert.ok([...expected.values()].every((content) => content.includes('GENERATED')));
});

test('checked-in adapters exactly match canonical sources', () => {
  assert.deepEqual(checkAdapters(), []);
});
