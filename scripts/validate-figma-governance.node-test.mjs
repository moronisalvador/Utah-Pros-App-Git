/**
 * ════════════════════════════════════════════════
 * FILE: validate-figma-governance.node-test.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Figma validator rejects connection, wildcard access, silent writes, public sharing,
 *   customer data, and repository Auth state.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  scripts/validate-figma-governance.mjs
 *   Data:      reads  → synthetic policy fixtures
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Fixtures contain no account, workspace, file, or collaborator identifiers.
 * ════════════════════════════════════════════════
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { validateFigmaGovernance } from './validate-figma-governance.mjs';

const baseline = JSON.parse(fs.readFileSync('.claude/figma-governance.json', 'utf8'));

function changed(mutator) {
  const policy = structuredClone(baseline);
  mutator(policy);
  return validateFigmaGovernance(policy);
}

test('accepts the disconnected fail-closed repository contract', () => {
  assert.deepEqual(validateFigmaGovernance(baseline), []);
});

test('rejects connection and wildcard scope', () => {
  const errors = changed((policy) => {
    policy.status = 'connected';
    policy.scope.wildcardsAllowed = true;
    policy.scope.fileIds = ['*'];
  });
  assert.ok(errors.some((error) => error.includes('disconnected')));
  assert.ok(errors.some((error) => error.includes('wildcard')));
});

test('rejects silent design/repository writes and relaxed external actions', () => {
  const errors = changed((policy) => {
    policy.actions.writeDesign = 'allow';
    policy.actions.repositoryWrite = 'allow';
    policy.actions.installPlugin = 'allow';
    policy.actions.purchaseSeat = 'allow';
    policy.actions.autoSync = 'allow';
  });
  assert.ok(errors.some((error) => error.includes('writeDesign')));
  assert.ok(errors.some((error) => error.includes('repositoryWrite')));
  assert.ok(errors.some((error) => error.includes('installPlugin')));
  assert.ok(errors.some((error) => error.includes('purchaseSeat')));
  assert.ok(errors.some((error) => error.includes('autoSync')));
});

test('rejects public sharing, Auth state, and customer data', () => {
  const errors = changed((policy) => {
    policy.scope.publicSharingAllowed = true;
    policy.artifacts.authStateInRepository = true;
    policy.artifacts.customerDataAllowed = true;
  });
  assert.ok(errors.some((error) => error.includes('public sharing')));
  assert.ok(errors.some((error) => error.includes('Auth state')));
  assert.ok(errors.some((error) => error.includes('customer data')));
});
