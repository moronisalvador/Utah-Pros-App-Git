/**
 * ════════════════════════════════════════════════
 * FILE: notification-producer-crew-composition-local.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the two-lineage local qualification harness to the Production-like
 *   and QA-like predecessors. It runs no containers or database commands.
 * ════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CHILD_PROCESS_TIMEOUT_MS,
  PRODUCTION_PREDECESSOR,
  QA_PREDECESSOR,
  QUALIFICATION_HASHED_INPUTS,
  QUALIFICATION_REPOSITORY_INPUTS,
  SUCCESSOR_INPUTS,
  SUPABASE_CLI_VERSION,
  assertCleanupObservation,
  assertCleanQualificationStatus,
  assertLocalDockerEndpoint,
  childResultOrThrow,
  disposableChildEnv,
} from '../../../scripts/qa/qualify-notification-producer-crew-composition-local.mjs';

const root = path.resolve('.');
const runner = fs.readFileSync(
  path.join(root, 'scripts/qa/qualify-notification-producer-crew-composition-local.mjs'),
  'utf8',
);
const seed = fs.readFileSync(
  path.join(root, 'scripts/qa/seed-notification-producer-crew-composition-local.sql'),
  'utf8',
);
const productionSeed = fs.readFileSync(
  path.join(root, 'scripts/qa/seed-notification-producer-crew-composition-production-local.sql'),
  'utf8',
);
const compositionProof = fs.readFileSync(
  path.join(root, 'supabase/tests/notification_producer_crew_phase_a_composition_isolated.sql'),
  'utf8',
);

describe('notification-producer + Crew Phase-A composition local qualification', () => {
  it('pins both actual predecessor lineages and exactly one forward composition', () => {
    expect(SUPABASE_CLI_VERSION).toBe('2.111.0');
    expect(PRODUCTION_PREDECESSOR.map(([file]) => file)).toEqual([
      'db/baseline/schema.sql',
      'scripts/qa/seed-notification-producer-crew-composition-local.sql',
      'scripts/qa/seed-notification-producer-crew-composition-production-local.sql',
      'supabase/migrations/20260730214500_pg_net_worker_url_allowlists.sql',
      'supabase/migrations/20260731223000_notification_unsafe_producer_containment.sql',
      'supabase/migrations/20260804000042_sync_appointment_crew_enum_authorization_hotfix.sql',
      'supabase/migrations/20260804000910_appointment_crew_atomic_save_and_audit_repair.sql',
    ]);
    expect(QA_PREDECESSOR.map(([file]) => file)).toEqual([
      'db/baseline/schema.sql',
      'scripts/qa/seed-notification-producer-crew-composition-local.sql',
      'supabase/migrations/20260730214500_pg_net_worker_url_allowlists.sql',
      'supabase/migrations/20260731223000_notification_unsafe_producer_containment.sql',
      'supabase/migrations/20260801215912_notification_producer_authorization.sql',
      'supabase/migrations/20260802040935_preserve_notify_emit_event_id.sql',
      'supabase/migrations/20260804000910_appointment_crew_atomic_save_and_audit_repair.sql',
    ]);
    expect(SUCCESSOR_INPUTS.map(([file]) => file)).toEqual([
      'supabase/migrations/20260804153859_notification_producer_crew_phase_a_composition.sql',
      'supabase/rollbacks/20260804153859_notification_producer_crew_phase_a_composition.rollback.sql',
      'supabase/tests/appointment_crew_atomic_save_and_audit_repair.test.sql',
      'supabase/tests/notification_producer_crew_phase_a_composition_isolated.sql',
      'scripts/qa/sql/notification_producer_crew_phase_a_composition_lifecycle.sql',
      'scripts/qa/sql/notification_producer_crew_phase_a_composition_rollback_lifecycle.sql',
    ]);
    expect(QUALIFICATION_HASHED_INPUTS.every(([, hash]) => /^[a-f0-9]{64}$/.test(hash))).toBe(true);
    expect(QUALIFICATION_REPOSITORY_INPUTS).toContain(
      'tests/qa/unit/notification-producer-crew-composition-local.test.js',
    );
    expect(QUALIFICATION_REPOSITORY_INPUTS).toContain(
      'tests/qa/unit/notification-producer-crew-composition.test.js',
    );
  });

  it('keeps the local-only, commit-bound, rollback-and-reapply safety guards', () => {
    expect(CHILD_PROCESS_TIMEOUT_MS).toBe(300_000);
    expect(() => assertCleanQualificationStatus('?? proof.sql')).toThrow('tracked, committed, and clean');
    expect(disposableChildEnv({ PATH: 'synthetic', SUPABASE_ACCESS_TOKEN: 'hosted', DATABASE_URL: 'hosted' }))
      .toEqual({ PATH: 'synthetic', SUPABASE_TELEMETRY_DISABLED: '1', PGOPTIONS: '-cupr.isolated_test_database=on' });
    expect(assertLocalDockerEndpoint('colima', 'unix:///tmp/upr-local.sock', { stat: () => ({ isSocket: () => true }) })).toMatchObject({ name: 'colima' });
    for (const marker of [
      "'migration', 'up', '--local'", "'--network-id', network",
      "'--single-transaction'", "'--untracked-files=all'",
      "'UPR_ISOLATED_DB=1'",
      "'ls-files', '--error-unmatch'", 'compositionRollbackProof',
      'notification_producer_crew_phase_a_composition_lifecycle.sql',
      'notification_producer_crew_phase_a_composition_rollback_lifecycle.sql',
      'appointment_crew_atomic_save_and_audit_repair.test.sql',
      'notification_producer_crew_phase_a_composition_isolated.sql',
      'production-predecessor', 'qa-m1-m2-predecessor',
      'composition rollback regressed Phase-A browser crew RPC',
      'qualification commit changed during local execution',
      'com.docker.network.bridge.host_binding_ipv4=127.0.0.1',
      'CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;',
      "to_regprocedure('extensions.plan(integer)')",
      "timeout: timeoutMs",
      "killSignal: 'SIGTERM'",
      'post-cleanup running disposable process assertion',
      'post-cleanup all disposable container assertion',
      'post-cleanup disposable network assertion',
      'post-cleanup loopback port assertion',
      'preflight loopback port availability assertion',
      'owned disposable container fallback removal',
    ]) expect(runner).toContain(marker);
    expect(runner).not.toContain('--linked');
    expect(runner).not.toContain('db push');
    expect(runner).not.toContain('apply_migration');
    expect(runner).not.toContain("run('npx'");
    expect(runner).not.toMatch(/\b(?:lsof|netstat|powershell|ss)\b/iu);
  });

  it('reports bounded child timeouts without exposing suppressed output', () => {
    expect(() => childResultOrThrow({
      error: Object.assign(new Error('synthetic timeout'), { code: 'ETIMEDOUT' }),
      stderr: 'synthetic-local-key',
      status: null,
    }, {
      label: 'synthetic local command',
      quiet: true,
      timeoutMs: CHILD_PROCESS_TIMEOUT_MS,
    })).toThrow(
      'synthetic local command exceeded 300000 ms and was terminated; '
        + 'command output suppressed to avoid local-key disclosure',
    );
    expect(() => childResultOrThrow({
      error: Object.assign(new Error('synthetic timeout'), { code: 'ETIMEDOUT' }),
      stderr: 'synthetic-local-key',
      status: null,
    }, {
      label: 'synthetic local command',
      quiet: true,
      timeoutMs: CHILD_PROCESS_TIMEOUT_MS,
    })).not.toThrow('synthetic-local-key');
  });

  it('fails closed when owned Docker resources remain after cleanup', () => {
    expect(() => assertCleanupObservation({
      runningContainerIds: 'abc123\n',
      allContainerIds: 'abc123\n',
      networkNames: '',
    }, 'upr-owned-network')).toThrow('found a running process');
    expect(() => assertCleanupObservation({
      runningContainerIds: '',
      allContainerIds: 'abc123\n',
      networkNames: '',
    }, 'upr-owned-network')).toThrow('found containers');
    expect(() => assertCleanupObservation({
      runningContainerIds: '',
      allContainerIds: '',
      networkNames: 'bridge\nupr-owned-network\n',
    }, 'upr-owned-network')).toThrow('found the disposable Docker network');
    expect(() => assertCleanupObservation({
      runningContainerIds: '',
      allContainerIds: '',
      networkNames: 'bridge\n',
    }, 'upr-owned-network')).not.toThrow();
  });

  it('matches the verified QA and Production reminder predecessor shapes', () => {
    expect(seed).toContain("'appointment.assigned'");
    expect(seed).toContain("'timesheet.change_reviewed'");
    expect(seed).not.toContain("'appointment.reminder'");
    expect(seed).not.toMatch(/cron\.schedule|upr_appointment_reminders/i);
    expect(productionSeed).toContain("'appointment.reminder'");
    expect(productionSeed).toMatch(/false,\s*false,\s*9106/s);
    expect(productionSeed).not.toMatch(/cron\.schedule|upr_appointment_reminders/i);
    expect(runner).toContain('const seedEntries = predecessor.filter');
    expect(runner).toContain('for (const [relative] of seedEntries)');
  });

  it('attributes fixture crew changes through the live Phase-A service RPC', () => {
    expect(compositionProof).toContain(
      'FROM public.sync_appointment_crew(',
    );
    expect(compositionProof).not.toContain(
      'INSERT INTO public.appointment_crew',
    );
  });
});
