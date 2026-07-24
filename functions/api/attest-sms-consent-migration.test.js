/**
 * Credential-free static guard for the unapplied historical service-SMS consent
 * migration. The DB lane mirrors these checks; live apply verification is separate.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20260724014423_attest_prior_sms_consent.sql',
  import.meta.url,
)), 'utf8').replace(/\r\n/g, '\n');

const attestSignature =
  'public.attest_prior_sms_consent(uuid, uuid, text, date, text, text)';
const statusSignature =
  'public.get_service_sms_consent_status(uuid, text)';

describe('historical service-SMS consent migration static guard', () => {
  it('uses deny-by-default current/history tables and exact RPC ACLs', () => {
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
    for (const signature of [attestSignature, statusSignature]) {
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION ${signature}\n  FROM PUBLIC, anon, authenticated, service_role;`,
      );
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION ${signature}\n  TO service_role;`,
      );
    }
  });

  it('never promotes narrow service consent into generic automated consent', () => {
    expect(migration).toContain(
      "'service_related_customer_project_messages'",
    );
    expect(migration).toContain("'prior_sms_consent_v1'");
    expect(migration).not.toMatch(/UPDATE public\.contacts[\s\S]+opt_in_status/i);
  });

  it('fails closed across duplicate contacts and durable pending STOP events', () => {
    expect(migration).toContain(
      "pg_advisory_xact_lock(hashtextextended('messaging-phone:' || v_phone_key, 0))",
    );
    expect(migration).toContain('ORDER BY c.id\n  FOR UPDATE;');
    expect(migration).toContain('c.dnd IS TRUE');
    expect(migration).toContain('c.opt_out_at IS NOT NULL');
    expect(migration).toContain(
      "e.processing_state IN ('received', 'claimed', 'retryable', 'failed')",
    );
  });

  it('keeps raw actor/IP evidence in append-only service storage', () => {
    expect(migration).toContain(
      'INSERT INTO public.service_sms_consent_attestations',
    );
    expect(migration).toContain('ON CONFLICT (contact_id) DO UPDATE');
    expect(migration).toContain("'prior_consent_attested'");
    expect(migration).toContain("'attestation_id', v_attestation_id");
    expect(migration).toContain("'sender_identity', 'Utah Pros Restoration'");
    const legacyLog = migration.slice(
      migration.indexOf('INSERT INTO public.sms_consent_log'),
    );
    expect(legacyLog).not.toContain("'evidence_note'");
    expect(legacyLog).not.toContain("'request_ip'");
  });
});
