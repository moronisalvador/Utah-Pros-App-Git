/**
 * ════════════════════════════════════════════════
 * FILE: notification-producer-local-bootstrap.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the producer/reminder disposable-bootstrap source to its exact local
 *   inputs, denying ambient credentials and unsafe invocation before
 *   containers start.
 * ════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  BASELINE_SHA256,
  LOCAL_DB_PORTS,
  LOCAL_EXCLUDED_SERVICES,
  QUALIFICATION_AUXILIARY_INPUTS,
  QUALIFICATION_HASHED_INPUTS,
  QUALIFICATION_MIGRATIONS,
  QUALIFICATION_PATHS,
  QUALIFICATION_PRODUCTION_PREDECESSORS,
  QUALIFICATION_REPOSITORY_INPUTS,
  QUALIFICATION_ROLLBACKS,
  SUBPROCESS_TIMEOUT_MS,
  SUPABASE_CLI_VERSION,
  assertCleanQualificationStatus,
  assertCommittedInputs,
  assertHashedInputs,
  assertLocalDockerEndpoint,
  assertOwnedContainersStopped,
  disposableChildEnv,
} from '../../../scripts/qa/qualify-notification-producer-local.mjs';

const root = path.resolve('.');
const runner = path.join(root, 'scripts/qa/qualify-notification-producer-local.mjs');
const runnerSource = fs.readFileSync(runner, 'utf8');
const config = fs.readFileSync(path.join(root, 'scripts/qa/supabase-notification-producer-local.toml'), 'utf8');
const seed = fs.readFileSync(path.join(root, 'scripts/qa/seed-notification-producer-local.sql'), 'utf8');
const candidate = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260801215912_notification_producer_authorization.sql'),
  'utf8',
);
const isolatedProof = fs.readFileSync(
  path.join(root, 'supabase/tests/notification_producer_authorization_isolated.sql'),
  'utf8',
);

describe('PR #573 local notification-producer bootstrap', () => {
  it('pins the CLI and exact committed bootstrap inputs', () => {
    expect(SUPABASE_CLI_VERSION).toBe('2.111.0');
    expect(SUBPROCESS_TIMEOUT_MS).toBe(300_000);
    expect(LOCAL_DB_PORTS).toEqual([55322, 55320]);
    expect(BASELINE_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(QUALIFICATION_MIGRATIONS.map(([file]) => file)).toEqual([
      '20260730214500_pg_net_worker_url_allowlists.sql',
      '20260731223000_notification_unsafe_producer_containment.sql',
      '20260801215912_notification_producer_authorization.sql',
      '20260802040935_preserve_notify_emit_event_id.sql',
      '20260803221500_notification_activation_prerequisites.sql',
      '20260803223000_appointment_reminder_delivery_claims.sql',
    ]);
    expect(QUALIFICATION_PRODUCTION_PREDECESSORS.map(([file]) => file))
      .toEqual([
        '20260804000042_sync_appointment_crew_enum_authorization_hotfix.sql',
      ]);
    expect(QUALIFICATION_ROLLBACKS.map(([file]) => file)).toEqual([
      '20260803223000_appointment_reminder_delivery_claims.rollback.sql',
      '20260803221500_notification_activation_prerequisites.rollback.sql',
      '20260802040935_preserve_notify_emit_event_id.rollback.sql',
      '20260801215912_notification_producer_authorization.rollback.sql',
    ]);
    expect(QUALIFICATION_AUXILIARY_INPUTS.map(([file]) => file)).toEqual([
      'scripts/qa/supabase-notification-producer-local.toml',
      'scripts/qa/seed-notification-producer-local.sql',
      'scripts/qa/seed-appointment-reminder-absent-local.sql',
      'supabase/tests/notification_producer_authorization.test.sql',
      'supabase/tests/notification_producer_authorization_isolated.sql',
      'supabase/tests/appointment_reminder_delivery_claims_isolated.sql',
      'supabase/tests/sync_appointment_crew_hotfix_isolated.sql',
      'scripts/qa/sql/notification_producer_authorization_lifecycle.sql',
      'scripts/qa/sql/notification_producer_authorization_rollback_lifecycle.sql',
      'scripts/qa/sql/appointment_reminder_activation_rollback_lifecycle.sql',
    ]);
    expect(QUALIFICATION_PATHS.production.predecessorMigrations
      .map(([file]) => file)).toEqual([
      '20260730214500_pg_net_worker_url_allowlists.sql',
      '20260731223000_notification_unsafe_producer_containment.sql',
    ]);
    expect(QUALIFICATION_PATHS.production.pendingMigrations
      .map(([file]) => file)).toEqual([
      '20260801215912_notification_producer_authorization.sql',
      '20260802040935_preserve_notify_emit_event_id.sql',
      '20260803221500_notification_activation_prerequisites.sql',
      '20260803223000_appointment_reminder_delivery_claims.sql',
    ]);
    expect(QUALIFICATION_PATHS.qa.predecessorMigrations
      .map(([file]) => file)).toEqual([
      '20260730214500_pg_net_worker_url_allowlists.sql',
      '20260731223000_notification_unsafe_producer_containment.sql',
      '20260801215912_notification_producer_authorization.sql',
      '20260802040935_preserve_notify_emit_event_id.sql',
    ]);
    expect(QUALIFICATION_PATHS.qa.pendingMigrations
      .map(([file]) => file)).toEqual([
      '20260803221500_notification_activation_prerequisites.sql',
      '20260803223000_appointment_reminder_delivery_claims.sql',
    ]);
    expect(QUALIFICATION_PATHS.qa.rollbacks.map(([file]) => file)).toEqual([
      '20260803223000_appointment_reminder_delivery_claims.rollback.sql',
      '20260803221500_notification_activation_prerequisites.rollback.sql',
    ]);
    for (const [, hash] of QUALIFICATION_HASHED_INPUTS) {
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(QUALIFICATION_REPOSITORY_INPUTS).toContain(
      'scripts/qa/qualify-notification-producer-local.mjs',
    );
    expect(QUALIFICATION_REPOSITORY_INPUTS).toContain(
      'scripts/qa/safe-child-env.mjs',
    );
    expect(() => assertCommittedInputs({ requireProofs: false })).not.toThrow();
  });

  it('refuses independent drift in every hashed qualification input', () => {
    for (const entry of QUALIFICATION_HASHED_INPUTS) {
      expect(() => assertHashedInputs(
        [entry],
        file => Buffer.concat([fs.readFileSync(file), Buffer.from('\ninput drift')]),
      )).toThrow(entry[0]);
    }
  });

  it('refuses any dirty or untracked qualification input status', () => {
    expect(() => assertCleanQualificationStatus('')).not.toThrow();
    for (const status of [
      ' M supabase/migrations/candidate.sql',
      'M  scripts/qa/seed.sql',
      '?? scripts/qa/proof.sql',
      ' D db/baseline/schema.sql',
    ]) {
      expect(() => assertCleanQualificationStatus(status))
        .toThrow('tracked, committed, and clean');
    }
  });

  it('keeps the generated project loopback-only and unlinked', () => {
    expect(config).toContain('project_id = "upr-pr573-notification-producer-local-v1"');
    expect(config).toContain('port = 54321');
    expect(config).toContain('port = 55322');
    expect(config).toContain('shadow_port = 55320');
    expect(config).toContain('major_version = 17');
    expect(config).not.toMatch(/\[remotes\]|project_ref|https:\/\//i);
    expect(config).toMatch(/127\.0\.0\.1:4173/g);
    expect(LOCAL_EXCLUDED_SERVICES).toEqual([
      'gotrue',
      'realtime',
      'storage-api',
      'imgproxy',
      'kong',
      'mailpit',
      'postgrest',
      'postgres-meta',
      'studio',
      'edge-runtime',
      'logflare',
      'vector',
      'supavisor',
    ]);
    expect(runnerSource).toContain(
      "'--exclude',\n        LOCAL_EXCLUDED_SERVICES.join(',')",
    );
  });

  it('uses only synthetic producer rows; the overlay leaves the reminder foundation absent', () => {
    // The shared seed is a byte-pinned input of the LIVE appointment-crew
    // qualification receipt, so this lane must not edit it — it still carries
    // the synthetic appointment.reminder row and placeholder cron. The
    // separate overlay removes both AFTER the seed, which is what leaves the
    // disposable stack matching qa-staging's reminder-absent shape.
    for (const key of [
      'appointment.assigned',
      'appointment.updated',
      'appointment.canceled',
      'timesheet.change_requested',
      'timesheet.change_reviewed',
    ]) expect(seed).toContain(`'${key}'`);
    expect((seed.match(/true, 910[1-5]/g) || [])).toHaveLength(5);
    expect(seed).toContain('ON CONFLICT (type_key) DO UPDATE');
    expect(seed).toContain('Synthetic local fixture');
    expect(seed).not.toMatch(/@|phone|token|secret/i);

    const overlay = fs.readFileSync(
      path.join(root, 'scripts/qa/seed-appointment-reminder-absent-local.sql'),
      'utf8',
    );
    expect(overlay).toContain(
      "DELETE FROM public.notification_types WHERE type_key = 'appointment.reminder'",
    );
    expect(overlay).toContain("cron.unschedule('upr_appointment_reminders')");
    expect(overlay).not.toMatch(/INSERT|cron\.schedule\(/);
    // The runner must copy AND execute the overlay after the seed, twice,
    // mirroring the seed's own idempotency reassertion.
    expect(runnerSource).toContain('seed-appointment-reminder-absent-local.sql');
    expect((runnerSource.match(/seed-reminder-absent\.sql/g) || []).length)
      .toBeGreaterThanOrEqual(3);
  });

  it('scrubs hosted credentials from all child commands', () => {
    expect(disposableChildEnv({
      PATH: 'synthetic-path',
      SUPABASE_ACCESS_TOKEN: 'hosted',
      SUPABASE_URL: 'https://hosted.example',
      DATABASE_URL: 'hosted',
      VITE_SUPABASE_ANON_KEY: 'hosted',
    })).toEqual({
      PATH: 'synthetic-path',
      SUPABASE_TELEMETRY_DISABLED: '1',
      PGOPTIONS: '-cupr.isolated_test_database=on',
    });
  });

  it('allows only verified local Docker sockets or standard Windows pipes', () => {
    const localSocket = { isSocket: () => true };
    expect(assertLocalDockerEndpoint(
      'colima',
      'unix:///tmp/upr-local-docker.sock',
      { stat: () => localSocket },
    )).toMatchObject({
      name: 'colima',
      socketPath: '/tmp/upr-local-docker.sock',
    });
    expect(assertLocalDockerEndpoint(
      'desktop-linux',
      'npipe:////./pipe/dockerDesktopLinuxEngine',
      { platform: 'win32' },
    )).toMatchObject({
      name: 'desktop-linux',
      socketPath: null,
    });
    for (const endpoint of [
      'tcp://remote.example.invalid:2376',
      'ssh://remote.example.invalid',
      'http://remote.example.invalid',
    ]) {
      expect(() => assertLocalDockerEndpoint(
        'remote',
        endpoint,
        { stat: () => localSocket },
      )).toThrow('allowlisted local Unix socket or named pipe');
    }
    expect(() => assertLocalDockerEndpoint(
      'colima',
      'unix:///tmp/not-a-socket',
      { stat: () => ({ isSocket: () => false }) },
    )).toThrow('not a local socket');
  });

  it('contains local-only restore, rollback, network, and cleanup guardrails', () => {
    const source = fs.readFileSync(runner, 'utf8');
    expect(source).toContain('GRANT supabase_admin TO postgres;');
    expect(source).toContain('REVOKE supabase_admin FROM postgres;');
    expect(source).toContain("pg_has_role('postgres', 'supabase_admin', 'member')");
    expect(source).toContain('CREATE EXTENSION IF NOT EXISTS pg_cron;');
    expect(source).toContain(
      'CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;',
    );
    expect(source).toContain("to_regclass('cron.job')");
    expect(source).toContain("to_regprocedure('extensions.plan(integer)')");
    expect(source).toContain('os.homedir()');
    expect(source).toContain("'upr-notification-producer-local'");
    expect(source).toContain('startAttempted = true;');
    expect(source).toContain('timeout: timeoutMs');
    expect(source).toContain("killSignal: 'SIGTERM'");
    expect(source).toContain('exceeded the five-minute subprocess limit');
    expect(source).toContain('com.docker.network.bridge.host_binding_ipv4=127.0.0.1');
    expect(source).toMatch(/'--network-id',\s+network/);
    expect(source).toContain("path.join(ROOT, 'node_modules', '.bin', 'supabase')");
    expect(source).not.toContain("run('npx'");
    expect(source).toContain("'--single-transaction'");
    expect(source).toContain(
      "...containerInputs.rollbacks.flatMap(file => ['-f', file])",
    );
    expect(source).toContain(
      'runProofs(dockerContext, [containerInputs.rollback[pathName]])',
    );
    expect(source).toContain('command output suppressed to avoid local-key disclosure');
    expect(source).toContain('local cleanup failed; preserved ${workdir}');
    expect(source).toContain('assertDisposableStackStopped(dockerContext)');
    expect(source).toContain('owned disposable container absence check');
    expect(source).toContain('disposable loopback port absence check');
    expect(source).toContain('disposable Docker network absence check');
    expect(source).toContain('no owned containers; ports ${LOCAL_DB_PORTS.join');
    expect(source).not.toContain("fs.cpSync(path.join(ROOT, 'supabase', 'tests')");
    expect(source).toContain(
      "path.join(ROOT, 'supabase', 'tests', 'notification_producer_authorization_isolated.sql')",
    );
    expect(source).toContain("'PGOPTIONS=-cupr.isolated_test_database=on'");
    expect(source).toContain("execArgs.push('-v', 'UPR_ISOLATED_DB=1')");
    expect(source).toContain('const DB_CONTAINER = `supabase_db_${LOCAL_PROJECT_ID}`');
    expect(source).toContain("runDocker(dockerContext, ['cp', source");
    expect(source).toContain("DOCKER_CONTEXT: dockerContext");
    expect(source).toContain("'com.supabase.cli.project'");
    expect(source).toContain('networks[network]?.NetworkID !== networkId');
    expect(source).toContain("'psql',\n    '-q',\n    '-v',\n    'ON_ERROR_STOP=1'");
    const seedApplication =
      "['-f', `${CONTAINER_TMP_ROOT}/seed.sql`],";
    expect(source.split(seedApplication)).toHaveLength(3);
    expect(source.indexOf('const dockerContext = verifyLocalDockerContext()'))
      .toBeLessThan(source.indexOf('const network = createLoopbackNetwork(dockerContext.name)'));
    expect(source.indexOf('const commitSha = qualificationCommitSha()'))
      .toBeLessThan(source.indexOf('const dockerContext = verifyLocalDockerContext()'));
    expect(source).toContain("'--untracked-files=all'");
    expect(source).toContain('emitQualificationEvidence(commitSha, dockerContext)');
    expect(source).toContain("schema: 'upr-pr573-local-qualification-v1'");
    expect(source).toContain("production: ['forward-rollback', 'clean-reapply']");
    expect(source).toContain("qa: ['forward-rollback', 'clean-reapply']");
    expect(source).not.toContain("run('psql'");
    expect(source).not.toContain("'test', 'db'");
  });

  it('fails closed when an owned disposable container remains', () => {
    expect(() => assertOwnedContainersStopped('')).not.toThrow();
    expect(() => assertOwnedContainersStopped('abc123\n'))
      .toThrow('container process remained');
  });

  it('refuses arguments before any local process can start', () => {
    const result = spawnSync(process.execPath, [runner, '--linked'], {
      cwd: root,
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('accepts no arguments');
  });

  it('guards against the reserved information_schema columns alias regression', () => {
    expect(candidate).not.toMatch(/information_schema\.columns\s+column\b/);
  });

  it('keeps appointment_crew employee fields behind table-specific nested guards', () => {
    expect(candidate).toMatch(
      /IF TG_TABLE_NAME = 'appointment_crew' THEN\s+IF TG_OP IN \('INSERT', 'UPDATE'\)[\s\S]*?NEW\.employee_id[\s\S]*?END IF;\s+END IF;/,
    );
    expect(candidate).toMatch(
      /IF TG_TABLE_NAME = 'appointment_crew' THEN\s+IF TG_OP = 'UPDATE'[\s\S]*?NEW\.employee_id[\s\S]*?END IF;\s+END IF;/,
    );
  });

  it('sequences state-changing claim and release assertions deterministically', () => {
    for (const sequence of [
      ['v_native_first :=', 'v_native_duplicate :=', 'IF v_native_first IS NOT TRUE'],
      ['v_pwa_first :=', 'v_pwa_duplicate :=', 'IF v_pwa_first IS NOT TRUE'],
      ['v_email_first :=', 'v_email_duplicate :=', 'IF v_email_first IS NOT TRUE'],
      ['v_release_first :=', 'v_release_duplicate :=', 'v_reclaim :='],
    ]) {
      const positions = sequence.map(marker => isolatedProof.indexOf(marker));
      expect(positions.every(position => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
    }
    expect(isolatedProof.indexOf('v_reclaim :='))
      .toBeLessThan(isolatedProof.indexOf('IF v_release_first IS NOT TRUE'));
  });
});
