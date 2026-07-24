/**
 * FILE: check-migration-provenance.node-test.mjs
 *
 * WHAT THIS DOES (plain language):
 *   Proves the migration provenance gate blocks unmapped ledger rows and functional SQL drift while
 *   allowing a specifically documented comment-only source difference.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  scripts/check-migration-provenance.mjs
 *
 * NOTES / GOTCHAS:
 *   - Fixtures live in a temporary Git repository and never connect to Supabase.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  extractFunctionBodies,
  normalizeFunctionBody,
  validateProvenance,
} from './check-migration-provenance.mjs';

function md5(value) {
  return crypto.createHash('md5').update(value).digest('hex');
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upr-migration-provenance-'));
  fs.mkdirSync(path.join(root, 'supabase', 'migrations'), { recursive: true });
  const source = [
    'CREATE OR REPLACE FUNCTION public.fixture()',
    ' RETURNS integer',
    ' LANGUAGE sql',
    " SET search_path TO 'public'",
    'AS $function$',
    '-- source explanation',
    ' SELECT 1;',
    '$function$;',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'supabase', 'migrations', 'fixture.sql'), source);
  spawnSync('git', ['init'], { cwd: root, windowsHide: true });
  spawnSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root, windowsHide: true });
  spawnSync('git', ['config', 'user.name', 'Fixture'], { cwd: root, windowsHide: true });
  spawnSync('git', ['add', '.'], { cwd: root, windowsHide: true });
  spawnSync('git', ['commit', '-m', 'fixture'], { cwd: root, windowsHide: true });
  const captureBaseCommit = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).stdout.trim();

  const local = extractFunctionBodies(source).get('fixture');
  const liveBody = '\n SELECT 1;\n';
  const manifest = {
    projectRef: 'fixture',
    ledgerFloorVersion: '1',
    evidenceMaxAgeHours: 6,
    ledgerMappings: [{
      version: '1',
      name: 'fixture',
      path: 'supabase/migrations/fixture.sql',
      reviewedOriginCommit: 'HEAD',
    }],
    selectedFunctions: [{
      identity: 'fixture()',
      path: 'supabase/migrations/fixture.sql',
      allowedRawDrift: 'comments_only',
    }],
    selectedPolicies: [],
  };
  const evidence = {
    capturedAt: '2026-07-23T22:48:29Z',
    captureBaseCommit,
    projectRef: 'fixture',
    ledgerTail: [{ version: '1', name: 'fixture' }],
    functions: [{
      identity: 'fixture()',
      rawMd5: md5(liveBody),
      semanticMd5: md5(normalizeFunctionBody(liveBody)),
      securityDefiner: true,
      config: ['search_path=public'],
      anonExecute: false,
      authenticatedExecute: true,
      serviceRoleExecute: true,
      publicExecute: false,
    }],
    policies: [],
  };
  return { root, manifest, evidence, local };
}

test('allows documented comment-only raw drift', () => {
  const fixture = makeFixture();
  const result = validateProvenance({
    ...fixture,
    ref: 'HEAD',
    worktree: false,
    now: new Date('2026-07-23T23:00:00Z'),
  });
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
});

test('blocks an unmapped live ledger row', () => {
  const fixture = makeFixture();
  fixture.evidence.ledgerTail.push({ version: '2', name: 'unreviewed' });
  const result = validateProvenance({
    ...fixture,
    ref: 'HEAD',
    worktree: false,
    now: new Date('2026-07-23T23:00:00Z'),
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes('Unmapped live ledger row')));
});

test('blocks functional body drift', () => {
  const fixture = makeFixture();
  fixture.evidence.functions[0].semanticMd5 = md5('SELECT 2;');
  const result = validateProvenance({
    ...fixture,
    ref: 'HEAD',
    worktree: false,
    now: new Date('2026-07-23T23:00:00Z'),
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes('semantic fingerprint drift')));
});

test('blocks a wrong reviewed-origin commit', () => {
  const fixture = makeFixture();
  fixture.manifest.ledgerMappings[0].reviewedOriginCommit = 'deadbeef';
  const result = validateProvenance({
    ...fixture,
    ref: 'HEAD',
    worktree: false,
    now: new Date('2026-07-23T23:00:00Z'),
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes('not reachable')));
});

test('blocks a release blob that differs from the reviewed origin', () => {
  const fixture = makeFixture();
  const migrationPath = path.join(fixture.root, 'supabase', 'migrations', 'fixture.sql');
  fs.appendFileSync(migrationPath, '-- unreviewed release edit\n');
  const result = validateProvenance({
    ...fixture,
    ref: 'HEAD',
    worktree: true,
    now: new Date('2026-07-23T23:00:00Z'),
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes('differs from reviewed origin')));
});

test('treats checkout CRLF conversion as the same reviewed repository text', () => {
  const fixture = makeFixture();
  const migrationPath = path.join(fixture.root, 'supabase', 'migrations', 'fixture.sql');
  const source = fs.readFileSync(migrationPath, 'utf8');
  fs.writeFileSync(migrationPath, source.replace(/\n/g, '\r\n'));
  const result = validateProvenance({
    ...fixture,
    ref: 'HEAD',
    worktree: true,
    now: new Date('2026-07-23T23:00:00Z'),
  });
  assert.equal(result.ok, true);
});

test('blocks stale live evidence', () => {
  const fixture = makeFixture();
  const result = validateProvenance({
    ...fixture,
    ref: 'HEAD',
    worktree: false,
    now: new Date('2026-07-24T12:00:00Z'),
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes('release window')));
});

test('blocks an evidence capture base outside release ancestry', () => {
  const fixture = makeFixture();
  fixture.evidence.captureBaseCommit = 'deadbeef';
  const result = validateProvenance({
    ...fixture,
    ref: 'HEAD',
    worktree: false,
    now: new Date('2026-07-23T23:00:00Z'),
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes('is not an ancestor')));
});

test('compares selected policy identities and fingerprints', () => {
  const fixture = makeFixture();
  fixture.manifest.selectedPolicies = [{
    identity: 'public.fixture:fixture_select',
    command: 'SELECT',
    roles: ['authenticated'],
    usingMd5: md5('true'),
    withCheckMd5: null,
  }];
  fixture.evidence.policies = [{
    ...fixture.manifest.selectedPolicies[0],
    usingMd5: md5('false'),
  }];
  const result = validateProvenance({
    ...fixture,
    ref: 'HEAD',
    worktree: false,
    now: new Date('2026-07-23T23:00:00Z'),
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes('unexpected live policy usingMd5')));
});

test('supports an explicit service-only invoker function contract', () => {
  const fixture = makeFixture();
  fixture.manifest.selectedFunctions[0].expected = {
    securityDefiner: false,
    config: ['search_path=""'],
    anonExecute: false,
    authenticatedExecute: false,
    serviceRoleExecute: true,
    publicExecute: false,
  };
  Object.assign(fixture.evidence.functions[0], fixture.manifest.selectedFunctions[0].expected);

  const result = validateProvenance({
    ...fixture,
    ref: 'HEAD',
    worktree: false,
    now: new Date('2026-07-23T23:00:00Z'),
  });
  assert.equal(result.ok, true);
});

test('supports reviewed exact-source migrations that generate live function definitions', () => {
  const fixture = makeFixture();
  delete fixture.manifest.selectedFunctions[0].allowedRawDrift;
  fixture.manifest.selectedFunctions[0].expectedLiveFingerprints = {
    rawMd5: fixture.evidence.functions[0].rawMd5,
    semanticMd5: fixture.evidence.functions[0].semanticMd5,
  };

  const result = validateProvenance({
    ...fixture,
    ref: 'HEAD',
    worktree: false,
    now: new Date('2026-07-23T23:00:00Z'),
  });
  assert.equal(result.ok, true);
});
