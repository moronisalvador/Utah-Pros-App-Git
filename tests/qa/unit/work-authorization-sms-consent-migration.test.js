/**
 * ════════════════════════════════════════════════
 * FILE: work-authorization-sms-consent-migration.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pins the reviewable database promises for converting an exact signed UPR
 *   Work Authorization into narrow project-service SMS evidence.
 *
 * DEPENDS ON:
 *   Packages:  vitest, Node.js built-ins
 *   Internal:  migration + rollback SQL with timestamp 20260727005212
 *   Data:      reads → SQL source only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is a credential-free intent/ACL guard, not live apply proof.
 *   - Behavioral database proof belongs to the isolated db lane.
 * ════════════════════════════════════════════════
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(new URL(
  '../../../supabase/migrations/20260727005212_upr_work_authorization_sms_consent.sql',
  import.meta.url,
));
const rollbackPath = fileURLToPath(new URL(
  '../../../supabase/rollbacks/20260727005212_upr_work_authorization_sms_consent.rollback.sql',
  import.meta.url,
));
const migration = readFileSync(migrationPath, 'utf8').replace(/\r\n/g, '\n');
const rollback = readFileSync(rollbackPath, 'utf8').replace(/\r\n/g, '\n');
const wrapperSignature =
  'public.complete_sign_request_with_work_authorization_sms_consent(\n'
  + '    uuid, text, text, text, boolean, boolean, boolean, boolean, text, text\n'
  + '  )';

describe('signed Work Authorization SMS consent migration', () => {
  it('ships a concrete rollback beside the additive migration', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(rollbackPath)).toBe(true);
    expect(rollback).toContain(
      'CREATE OR REPLACE FUNCTION public.get_service_sms_consent_status(',
    );
    expect(rollback).toContain(
      'DROP TABLE IF EXISTS public.work_authorization_sms_consents;',
    );
  });

  it('stores immutable evidence without a fake employee actor', () => {
    expect(migration).toContain(
      'CREATE TABLE public.work_authorization_sms_consents',
    );
    expect(migration).toContain(
      'sign_request_id uuid PRIMARY KEY\n'
      + '    REFERENCES public.sign_requests(id) ON DELETE RESTRICT',
    );
    expect(migration).toContain(
      'contact_id uuid NOT NULL\n'
      + '    REFERENCES public.contacts(id) ON DELETE RESTRICT',
    );
    expect(migration).toContain(
      "DEFAULT 'upr_signed_work_authorization'",
    );
    expect(migration).toContain(
      'signer_ip text NOT NULL\n'
      + '    CHECK (\n'
      + '      char_length(signer_ip) BETWEEN 3 AND 64',
    );
    const tableDefinition = migration.slice(
      migration.indexOf('CREATE TABLE public.work_authorization_sms_consents'),
      migration.indexOf('COMMENT ON TABLE public.work_authorization_sms_consents'),
    );
    expect(tableDefinition).not.toContain('recorded_by');
    expect(tableDefinition).not.toContain('employee');
  });

  it('keeps the evidence table and wrapper service-role-only', () => {
    expect(migration).toContain(
      'ALTER TABLE public.work_authorization_sms_consents ENABLE ROW LEVEL SECURITY;',
    );
    expect(migration).toContain(
      'ALTER TABLE public.work_authorization_sms_consents FORCE ROW LEVEL SECURITY;',
    );
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.work_authorization_sms_consents\n'
      + '  FROM PUBLIC, anon, authenticated, service_role;',
    );
    expect(migration).toContain(
      'GRANT SELECT, INSERT ON TABLE public.work_authorization_sms_consents\n'
      + '  TO service_role;',
    );
    expect(migration).toContain(
      `REVOKE ALL ON FUNCTION\n  ${wrapperSignature}\n`
      + '  FROM PUBLIC, anon, authenticated, service_role;',
    );
    expect(migration).toContain(
      `GRANT EXECUTE ON FUNCTION\n  ${wrapperSignature}\n  TO service_role;`,
    );
  });

  it('pins the exact disclosure and completes signature + evidence atomically', () => {
    expect(migration).toContain(
      "md5(v_status_definition) <> '4f28eae483e2a74b1d5504c17b444fd5'",
    );
    expect(migration).toContain(
      "md5(v_complete_definition) <> 'a0cd4e8872aee73a1d425bc92774c06c'",
    );
    expect(migration).toContain("'upr_work_auth_sms_v1'");
    expect(migration).toContain(
      "'22b2a37dc4094f683da6c0fe1d4955da989733a3a799307129b9fa83cae1265e'",
    );
    const wrapper = migration.slice(
      migration.indexOf(
        'CREATE OR REPLACE FUNCTION public.complete_sign_request_with_work_authorization_sms_consent',
      ),
      migration.indexOf(
        'CREATE OR REPLACE FUNCTION public.get_service_sms_consent_status',
      ),
    );
    expect(wrapper).toContain('v_result := public.complete_sign_request(');
    expect(wrapper).toContain(
      'INSERT INTO public.work_authorization_sms_consents',
    );
    expect(wrapper).toContain('v_req.signer_ip');
    expect(wrapper).toContain('ON CONFLICT (sign_request_id) DO NOTHING;');
    const legacyLogInsert = wrapper.slice(
      wrapper.indexOf('INSERT INTO public.sms_consent_log'),
      wrapper.indexOf("RETURN v_result || jsonb_build_object(\n    'sms_consent_recorded'"),
    );
    expect(legacyLogInsert).not.toContain('ip_address');
    expect(legacyLogInsert).not.toContain('v_req.signer_ip');
  });

  it('preserves suppression checks ahead of the new service evidence', () => {
    const status = migration.slice(
      migration.indexOf(
        'CREATE OR REPLACE FUNCTION public.get_service_sms_consent_status',
      ),
    );
    const dnd = status.indexOf('c.dnd IS TRUE');
    const optOut = status.indexOf('c.opt_out_at IS NOT NULL');
    const pendingStop = status.indexOf("'pending_stop'");
    const legacyService = status.indexOf('FROM public.service_sms_consents s');
    const workAuth = status.indexOf(
      'FROM public.work_authorization_sms_consents w',
    );
    expect(dnd).toBeGreaterThan(-1);
    expect(optOut).toBeGreaterThan(dnd);
    expect(pendingStop).toBeGreaterThan(optOut);
    expect(legacyService).toBeGreaterThan(pendingStop);
    expect(workAuth).toBeGreaterThan(legacyService);
    expect(status).toContain("'code', 'SERVICE_CONSENT'");
  });

  it('never broadens permission or performs messaging side effects', () => {
    expect(migration).not.toMatch(
      /UPDATE\s+public\.contacts[\s\S]+opt_in_status/i,
    );
    expect(migration).not.toContain('sendAutomatedMessage');
    expect(migration).not.toContain('INSERT INTO public.messages');
    expect(migration).not.toContain('INSERT INTO public.message_attempts');
    expect(migration).not.toContain('http_post');
  });
});
