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

test('allows documented comment-or-whitespace raw drift', () => {
  const fixture = makeFixture();
  fixture.manifest.selectedFunctions[0].allowedRawDrift = 'comments_or_whitespace';
  const result = validateProvenance({
    ...fixture,
    ref: 'HEAD',
    worktree: false,
    now: new Date('2026-07-23T23:00:00Z'),
  });
  assert.equal(result.ok, true);
  assert.match(result.warnings[0], /comment\/whitespace-normalized/);
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

test('warns but does not block on stale live evidence', () => {
  const fixture = makeFixture();
  const result = validateProvenance({
    ...fixture,
    ref: 'HEAD',
    worktree: false,
    now: new Date('2026-07-24T12:00:00Z'),
  });
  // Staleness is not drift: the evidence still proves the catalog state at capture time.
  // Failing here is what made CI go red on a clock and skip build+test.
  assert.equal(result.ok, true);
  assert.equal(result.stale, true);
  assert.ok(result.warnings.some((warning) => warning.includes('release window')));
  assert.equal(result.issues.length, 0);
});

test('blocks stale live evidence under --strict-freshness (the release gate)', () => {
  const fixture = makeFixture();
  const result = validateProvenance({
    ...fixture,
    ref: 'HEAD',
    worktree: false,
    now: new Date('2026-07-24T12:00:00Z'),
    strictFreshness: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.ok(result.issues.some((issue) => issue.includes('release window')));
});

test('blocks malformed evidence with a missing or future capturedAt, even when lenient', () => {
  const fixture = makeFixture();
  const result = validateProvenance({
    ...fixture,
    ref: 'HEAD',
    worktree: false,
    evidence: { ...fixture.evidence, capturedAt: '2099-01-01T00:00:00Z' },
    now: new Date('2026-07-23T23:00:00Z'),
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes('missing or future capturedAt')));
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

test('supports explicit live fingerprints for a reviewed dynamic migration', () => {
  const fixture = makeFixture();
  const expectedFingerprints = {
    rawMd5: md5('dynamic reviewed raw body'),
    semanticMd5: md5('dynamic reviewed semantic body'),
  };
  fixture.manifest.selectedFunctions[0] = {
    identity: 'fixture()',
    path: 'supabase/migrations/fixture.sql',
    expectedFingerprints,
  };
  Object.assign(fixture.evidence.functions[0], expectedFingerprints);

  const result = validateProvenance({
    ...fixture,
    ref: 'HEAD',
    worktree: false,
    now: new Date('2026-07-23T23:00:00Z'),
  });
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 0);
});

test('blocks drift from explicit live fingerprints for a dynamic migration', () => {
  const fixture = makeFixture();
  fixture.manifest.selectedFunctions[0] = {
    identity: 'fixture()',
    path: 'supabase/migrations/fixture.sql',
    expectedFingerprints: {
      rawMd5: fixture.evidence.functions[0].rawMd5,
      semanticMd5: md5('different reviewed semantic body'),
    },
  };

  const result = validateProvenance({
    ...fixture,
    ref: 'HEAD',
    worktree: false,
    now: new Date('2026-07-23T23:00:00Z'),
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.includes('unexpected live semanticMd5 fingerprint')),
  );
});

test('extracts function bodies under any dollar-quote tag, not an enumerated few', () => {
  // Regression for 2026-08-09: crm_lead_read_boundary quoted its bodies with $fn$,
  // which the parser did not accept, so the gate reported "does not define" for three
  // tracked CRM functions the migration plainly did define. The tag set had already
  // been too narrow once before ($function$ only, widened to include $$ on 2026-07-24
  // after a hand-pin went stale). Enumerating tags was never the safety property —
  // the backreferenced closing tag is — so any tag must parse.
  const fingerprints = new Set();
  for (const tag of ['$$', '$function$', '$fn$', '$body$', '$q1$']) {
    const source = [
      'CREATE OR REPLACE FUNCTION public.tagged(p_id uuid)',
      'RETURNS SETOF json',
      'LANGUAGE plpgsql',
      `AS ${tag}`,
      'BEGIN',
      '  RETURN QUERY SELECT 1;',
      'END;',
      `${tag};`,
    ].join('\n');
    const found = extractFunctionBodies(source).get('tagged');
    assert.ok(found, `tag ${tag} should parse`);
    fingerprints.add(found.rawMd5);
  }
  // One fingerprint across all five: the body is identical, so the tag must not leak
  // into what gets hashed. If it did, the same function would drift purely by requoting.
  assert.equal(fingerprints.size, 1);
});

test('a mismatched dollar-quote pair still does not parse', () => {
  // The backreference is the actual guard. Keep it honest: opening $fn$ and closing
  // $$ must NOT yield a body, or the widened tag set would have traded a false
  // negative for a false positive.
  const source = [
    'CREATE OR REPLACE FUNCTION public.mismatched(p_id uuid)',
    'RETURNS SETOF json',
    'LANGUAGE plpgsql',
    'AS $fn$',
    'BEGIN',
    '  RETURN QUERY SELECT 1;',
    'END;',
    '$$;',
  ].join('\n');
  assert.equal(extractFunctionBodies(source).get('mismatched'), undefined);
});
