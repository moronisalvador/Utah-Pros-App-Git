/**
 * FILE: tooling-skill-contracts.node-test.mjs
 *
 * WHAT THIS DOES (plain language):
 *   Checks that dispatcher trigger fixtures remain complete and that the neutral UPR skills retain
 *   their safety, routing, and portability contracts.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  tooling/evals/skill-routing.json and tooling/skills
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve('.');
const evals = JSON.parse(
  fs.readFileSync(path.join(root, 'tooling', 'evals', 'skill-routing.json'), 'utf8'),
);
const newFeature = fs.readFileSync(
  path.join(root, 'tooling', 'skills', 'new-feature', 'SKILL.md'),
  'utf8',
);
const masterplan = fs.readFileSync(
  path.join(root, 'tooling', 'skills', 'masterplan', 'SKILL.md'),
  'utf8',
);
const dbMigration = fs.readFileSync(
  path.join(root, 'tooling', 'skills', 'db-migration', 'SKILL.md'),
  'utf8',
);
const newCrmModule = fs.readFileSync(
  path.join(root, 'tooling', 'skills', 'new-crm-module', 'SKILL.md'),
  'utf8',
);
const mobileReadiness = fs.readFileSync(
  path.join(root, 'tooling', 'skills', 'mobile-readiness-wave', 'SKILL.md'),
  'utf8',
);

test('routing fixtures cover positive, negative, and collision decisions', () => {
  const ids = new Set();
  const expectedPrimaries = new Set();
  for (const fixture of evals.cases) {
    assert.ok(fixture.id && fixture.prompt);
    assert.ok(!ids.has(fixture.id), `duplicate fixture id: ${fixture.id}`);
    ids.add(fixture.id);
    expectedPrimaries.add(fixture.expectedPrimary);
    assert.ok(Array.isArray(fixture.expectedSupporting));
  }
  assert.ok(expectedPrimaries.has('new-feature'));
  assert.ok(expectedPrimaries.has('masterplan'));
  assert.ok(expectedPrimaries.has('db-migration'));
  assert.ok(expectedPrimaries.has('new-crm-module'));
  assert.ok(expectedPrimaries.has('mobile-readiness-wave'));
  assert.ok(expectedPrimaries.has(null));
  assert.ok(
    evals.cases.some(
      (fixture) =>
        fixture.expectedPrimary === 'new-feature' && fixture.expectedSupporting.includes('db-migration'),
    ),
  );
  assert.ok(
    evals.cases.some(
      (fixture) =>
        fixture.expectedPrimary === 'masterplan' && fixture.expectedSupporting.includes('db-migration'),
    ),
  );
  assert.ok(
    evals.cases.some(
      (fixture) =>
        fixture.expectedPrimary === 'mobile-readiness-wave' &&
        fixture.expectedSupporting.includes('mobile-readiness-security-reviewer'),
    ),
  );
  assert.ok(
    evals.cases.some(
      (fixture) =>
        fixture.expectedPrimary === 'mobile-readiness-wave' &&
        fixture.expectedSupporting.includes('db-migration'),
    ),
  );
});

test('new-feature keeps routing, authorization, risk, and verification boundaries', () => {
  for (const required of [
    'Run `git status --short --branch`',
    'Route instead of duplicating another dispatcher',
    'Planning, repository authoring, live database apply',
    'A valid session is authentication, not authorization',
    'Never point write-capable tests at the shared Supabase project',
    '`worker-security-reviewer`',
    '`consent-path-auditor`',
    'Report repository, isolated-test, shared-database',
  ]) {
    assert.ok(newFeature.includes(required), `new-feature missing contract: ${required}`);
  }
});

test('masterplan is proportionate, evidence-led, and runtime-neutral', () => {
  for (const required of [
    '**UNKNOWN**',
    'Choose a proportionate artifact tier',
    'A Foundation phase is appropriate only',
    'Otherwise serialize',
    'particular model',
    'Challenge the plan',
    'If only planning was requested, stop there',
  ]) {
    assert.ok(masterplan.includes(required), `masterplan missing contract: ${required}`);
  }
  for (const forbidden of [
    '.Codex/',
    'ultracode',
    'maximum parallelism',
    'Supabase dev branch',
    'strongest available model',
  ]) {
    assert.ok(!masterplan.includes(forbidden), `masterplan retained forbidden language: ${forbidden}`);
    assert.ok(!newFeature.includes(forbidden), `new-feature retained forbidden language: ${forbidden}`);
  }
});

test('routed database and CRM dispatchers preserve separate live and delivery gates', () => {
  for (const required of [
    'Keep four states separate',
    'mutation-heavy tests at the',
    'Do not grant `authenticated` or `service_role` reflexively',
    'Without a current instruction to apply the exact reviewed migration',
  ]) {
    assert.ok(dbMigration.includes(required), `db-migration missing contract: ${required}`);
  }
  for (const required of [
    'does not invent a new phase',
    'Route each database portion through `db-migration`',
    'database-backed status only when',
    'Commit, push, PR, deploy, live',
  ]) {
    assert.ok(newCrmModule.includes(required), `new-crm-module missing contract: ${required}`);
  }
});

test('mobile readiness keeps bounded ownership, production gates, and honest evidence', () => {
  for (const required of [
    'Use an isolated worktree',
    'Never treat the dated audit as current `dev`',
    'at most three simultaneous subagents',
    '`mobile-readiness-security-reviewer`',
    'Without a separate explicit owner instruction',
    'Never conflate a local test with production verification',
    'enforce a five-minute maximum',
    'Do not mark a finding closed solely because code was written',
  ]) {
    assert.ok(
      mobileReadiness.includes(required),
      `mobile-readiness-wave missing contract: ${required}`,
    );
  }
});
