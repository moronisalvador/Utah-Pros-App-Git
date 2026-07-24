/**
 * Credential-free contract guard for the unapplied historical service-SMS
 * consent migration. Isolated PostgreSQL execution and live role verification
 * remain separate owner-gated release checks.
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

describe('historical service-SMS consent migration contract', () => {
  it('creates a deny-by-default service-only evidence table', () => {
    expect(migration).toContain('CREATE TABLE public.service_sms_consents');
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
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]+service_sms_consents/i);
  });

  it('keeps both exact RPC signatures service-role-only and invoker-rights', () => {
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

  it('never promotes narrow service consent into generic automated consent', () => {
    expect(migration).toContain("'service_related_customer_project_messages'");
    expect(migration).toContain("'prior_sms_consent_v1'");
    expect(migration).not.toMatch(/UPDATE public\.contacts[\s\S]+opt_in_status/i);
    expect(migration).not.toContain("opt_in_source = 'prior_consent_attestation'");
  });

  it('serializes suppression and preserves STOP to later START chronology', () => {
    expect(migration).toContain(
      "pg_advisory_xact_lock(hashtextextended('messaging-phone:' || v_phone_key, 0))",
    );
    expect(migration).toContain('ORDER BY c.id\n  FOR UPDATE;');
    expect(migration).toMatch(/FROM public\.employees[\s\S]+LIMIT 1\s+FOR SHARE;/i);
    expect(migration).toContain("'code', 'CONTACT_OPTED_OUT'");
    expect(migration).toContain("'code', 'CONTACT_PENDING_STOP'");
    expect(migration).toContain(
      "e.processing_state IN ('received', 'claimed', 'retryable', 'failed')",
    );
    expect(migration).toContain("later_event.processing_state = 'processed'");
    expect(migration).toContain("ARRAY['start', 'unstop', 'subscribe', 'yes']");
  });

  it('appends trusted evidence and retains it during operational rollback', () => {
    expect(migration).toContain('ON CONFLICT (contact_id) DO UPDATE');
    expect(migration).toContain("'prior_consent_attested'");
    expect(migration).toContain("'consent_obtained_on', p_consent_obtained_on");
    expect(migration).toContain("'evidence_note', v_note");
    expect(migration).toContain("'request_ip', v_request_ip");
    expect(migration).toContain("'sender_identity', 'Utah Pros Restoration'");
    expect(migration).toContain(
      'Destructive schema\n--   removal, if ever required, must be a separate reviewed cleanup migration.',
    );
    expect(migration).not.toContain('--   DROP TABLE public.service_sms_consents;');
  });
});
