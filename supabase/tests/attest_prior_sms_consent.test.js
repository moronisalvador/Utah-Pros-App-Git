/**
 * ════════════════════════════════════════════════
 * FILE: attest_prior_sms_consent.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the prior-service SMS consent change and checks its database safety promises as part of
 *   the isolated database test lane. It does not connect to the shared live database.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:url, vitest
 *   Internal:  supabase/migrations/20260724014423_attest_prior_sms_consent.sql
 *   Data:      reads  → migration file only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Isolated PostgreSQL execution still requires the governed local runtime and role fixtures.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  '../migrations/20260724014423_attest_prior_sms_consent.sql',
  import.meta.url,
)), 'utf8').replace(/\r\n/g, '\n');

const attestSignature =
  'public.attest_prior_sms_consent(uuid, uuid, text, date, text, text)';
const statusSignature =
  'public.get_service_sms_consent_status(uuid, text)';

describe('attest_prior_sms_consent database contract', () => {
  it('creates deny-by-default current and append-only evidence tables', () => {
    expect(migration).toContain('CREATE TABLE public.service_sms_consents');
    expect(migration).toContain(
      'CREATE TABLE public.service_sms_consent_attestations',
    );
    expect(migration).toContain(
      'ALTER TABLE public.service_sms_consents ENABLE ROW LEVEL SECURITY;',
    );
    expect(migration).toContain(
      'ALTER TABLE public.service_sms_consents FORCE ROW LEVEL SECURITY;',
    );
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.service_sms_consents\n  FROM PUBLIC, anon, authenticated, service_role;',
    );
    expect(migration).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.service_sms_consents\n  TO service_role;',
    );
    expect(migration).toContain(
      'GRANT SELECT, INSERT ON TABLE public.service_sms_consent_attestations\n  TO service_role;',
    );
    expect(migration).toContain(
      'CREATE POLICY service_sms_consents_service_role_manage',
    );
    expect(migration).toContain(
      'CREATE POLICY service_sms_consent_attestations_service_role_insert',
    );
    expect(migration).not.toMatch(
      /CREATE POLICY[\s\S]+TO (?:anon|authenticated)/i,
    );
    expect(migration).toContain(
      'REFERENCES public.contacts(id) ON DELETE RESTRICT',
    );
  });

  it('keeps both exact RPC overloads service-role-only and invoker-rights', () => {
    expect(migration.match(/SECURITY INVOKER/g)).toHaveLength(2);
    for (const signature of [attestSignature, statusSignature]) {
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION ${signature}\n  FROM PUBLIC, anon, authenticated, service_role;`,
      );
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION ${signature}\n  TO service_role;`,
      );
    }
  });

  it('separates service consent from the generic automated-marketing boolean', () => {
    expect(migration).toContain(
      "'service_related_customer_project_messages'",
    );
    expect(migration).toContain("'prior_sms_consent_v1'");
    expect(migration).not.toMatch(/UPDATE public\.contacts[\s\S]+opt_in_status/i);
    expect(migration).not.toContain("opt_in_source = 'prior_consent_attestation'");
  });

  it('serializes by phone and refuses duplicate suppression or a pending STOP', () => {
    expect(migration).toContain(
      "pg_advisory_xact_lock(hashtextextended('messaging-phone:' || v_phone_key, 0))",
    );
    expect(migration).toContain('ORDER BY c.id\n  FOR UPDATE;');
    expect(migration).toContain('c.dnd IS TRUE');
    expect(migration).toContain('c.opt_out_at IS NOT NULL');
    expect(migration).toContain(
      "e.processing_state IN ('received', 'claimed', 'retryable', 'failed')",
    );
    expect(migration).toContain(
      "ARRAY['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']",
    );
  });

  it('keeps raw evidence append-only and leaves only a redacted legacy-log reference', () => {
    expect(migration).toContain(
      'INSERT INTO public.service_sms_consent_attestations',
    );
    expect(migration).toContain('ON CONFLICT (contact_id) DO UPDATE');
    expect(migration).toContain("'prior_consent_attested'");
    expect(migration).toContain("'attestation_id', v_attestation_id");
    expect(migration).toContain("'sender_identity', 'Utah Pros Restoration'");
    expect(migration).toContain('v_actor.id');
    expect(migration).toContain('v_recorded_at');
    const legacyLog = migration.slice(
      migration.indexOf('INSERT INTO public.sms_consent_log'),
    );
    expect(legacyLog).not.toContain("'evidence_note'");
    expect(legacyLog).not.toContain("'request_ip'");
    expect(legacyLog).not.toContain("'consent_obtained_on'");
  });
});
