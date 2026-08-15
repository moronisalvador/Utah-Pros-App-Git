/**
 * ════════════════════════════════════════════════
 * FILE: appointment-crew-local-qualification.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the safety boundaries for the local appointment-crew repair check.
 *   It verifies that both live predecessor shapes, reviewed source hashes,
 *   loopback networking, rollback containment, and commit identity stay fixed.
 *
 * DEPENDS ON:
 *   Packages:  Node built-ins, Vitest
 *   Internal:  scripts/qa/qualify-appointment-crew-repair-local.mjs
 *   Data:      reads  → committed migration, rollback, and test source
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This static test never starts Docker or connects to any database.
 * ════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PRODUCTION_PREDECESSOR,
  QA_PREDECESSOR,
  QUALIFICATION_HASHED_INPUTS,
  QUALIFICATION_REPOSITORY_INPUTS,
  SUCCESSOR_INPUTS,
  SUPABASE_CLI_VERSION,
  assertCleanQualificationStatus,
  assertHashedInputs,
  assertLocalDockerEndpoint,
  disposableChildEnv,
} from '../../../scripts/qa/qualify-appointment-crew-repair-local.mjs';

const root = path.resolve('.');
const runner = fs.readFileSync(path.join(root, 'scripts/qa/qualify-appointment-crew-repair-local.mjs'), 'utf8');

describe('appointment crew local qualification', () => {
  it('pins both exact predecessor chains and the successor repair inputs', () => {
    expect(SUPABASE_CLI_VERSION).toBe('2.111.0');
    expect(PRODUCTION_PREDECESSOR.map(([file]) => file)).toEqual([
      'db/baseline/schema.sql',
      'supabase/migrations/20260804000042_sync_appointment_crew_enum_authorization_hotfix.sql',
    ]);
    expect(QA_PREDECESSOR.map(([file]) => file)).toEqual([
      'db/baseline/schema.sql', 'scripts/qa/seed-notification-producer-local.sql',
      'supabase/migrations/20260730214500_pg_net_worker_url_allowlists.sql',
      'supabase/migrations/20260731223000_notification_unsafe_producer_containment.sql',
      'supabase/migrations/20260801215912_notification_producer_authorization.sql',
      'supabase/migrations/20260802040935_preserve_notify_emit_event_id.sql',
    ]);
    expect(SUCCESSOR_INPUTS.map(([file]) => file)).toEqual([
      'supabase/migrations/20260804000910_appointment_crew_atomic_save_and_audit_repair.sql',
      'supabase/rollbacks/20260804000910_appointment_crew_atomic_save_and_audit_repair.rollback.sql',
      'supabase/tests/appointment_crew_atomic_save_and_audit_repair.test.sql',
    ]);
    expect(QUALIFICATION_HASHED_INPUTS.every(([, hash]) => /^[a-f0-9]{64}$/.test(hash))).toBe(true);
    expect(QUALIFICATION_REPOSITORY_INPUTS).toContain('scripts/qa/qualify-appointment-crew-repair-local.mjs');
    expect(QUALIFICATION_REPOSITORY_INPUTS).toContain('tests/qa/unit/appointment-crew-local-qualification.test.js');
    expect(() => assertHashedInputs()).not.toThrow();
  });

  it('refuses dirty qualification inputs and scrubs hosted credentials', () => {
    expect(() => assertCleanQualificationStatus('?? proof.sql')).toThrow('tracked, committed, and clean');
    expect(disposableChildEnv({ PATH: 'synthetic', SUPABASE_ACCESS_TOKEN: 'no', DATABASE_URL: 'no', SUPABASE_URL: 'https://hosted.invalid' })).toEqual({ PATH: 'synthetic', SUPABASE_TELEMETRY_DISABLED: '1', PGOPTIONS: '-cupr.isolated_test_database=on' });
  });

  it('allows only local Docker sockets and retains loopback, rollback, and commit guards', () => {
    expect(assertLocalDockerEndpoint('colima', 'unix:///tmp/upr-local.sock', { stat: () => ({ isSocket: () => true }) })).toMatchObject({ name: 'colima' });
    expect(() => assertLocalDockerEndpoint('remote', 'tcp://db.invalid:2376', { stat: () => ({ isSocket: () => true }) })).toThrow('allowlisted local Unix socket or named pipe');
    for (const marker of [
      'com.docker.network.bridge.host_binding_ipv4=127.0.0.1',
      "'--network-id', network", "'--no-backup'", "'--untracked-files=all'",
      "'ls-files', '--error-unmatch'", "'--single-transaction'",
      '{{json .NetworkSettings.Networks}}',
      'database container is not attached to the verified disposable network',
      "'[studio]'", "'[local_smtp]'", "'[analytics]'",
      'studio: 55423', 'smtp: 55424', 'analytics: 55427',
      'studio: 55433', 'smtp: 55434', 'analytics: 55437',
      "cycle === 'production-predecessor' ? 'prod' : 'qa'",
      '`uprcr-${cycleSlug}-${process.pid}-${randomUUID().slice(0, 8)}`',
      'failClosedProof', 'rollback retained sync execute',
      'rollback retained appointment column write',
      'rollback retained crew column write',
      'rollback retained merge execute',
      'production-predecessor', 'qa-m1-m2-predecessor',
      'command output suppressed to avoid local-key disclosure',
    ]) expect(runner).toContain(marker);
    expect(runner).not.toContain('--linked');
    expect(runner).not.toContain('db push');
    expect(runner).not.toContain('apply_migration');
    expect(runner).not.toContain("run('npx'");
  });
});
