/**
 * ════════════════════════════════════════════════
 * FILE: work_authorization_sms_consent.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Exercises the signed Work Authorization consent bridge against the isolated
 *   local Supabase stack. It proves exact-disclosure recording, mismatch
 *   fail-closed behavior, global-opt-in separation, DND precedence and browser
 *   denial.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  functions/lib/supabase.js; migration 20260727005212
 *   Data:      writes → disposable local contacts, jobs, sign requests,
 *                       documents, events and consent evidence
 *
 * NOTES / GOTCHAS:
 *   - Run only through `npm run test:db:local`; that runner refuses the shared
 *     project and supplies the local service-role/anon keys.
 *   - No provider endpoint is called and no message row is inserted.
 * ════════════════════════════════════════════════
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { supabase } from '../../functions/lib/supabase.js';

const env = globalThis.process?.env || {};
const db = supabase({
  SUPABASE_URL: env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
});
const DISCLOSURE_VERSION = 'upr_work_auth_sms_v1';
const DISCLOSURE_SHA256 =
  '22b2a37dc4094f683da6c0fe1d4955da989733a3a799307129b9fa83cae1265e';
const WRONG_SHA256 = '0'.repeat(64);

describe('signed Work Authorization service-SMS consent (isolated DB)', () => {
  const runId = Date.now();
  const phone = `+1559${String(runId).slice(-7)}`;
  const legacyPhone = `+1558${String(runId).slice(-7)}`;
  let contactId;
  let jobId;
  let legacyContactId;
  let actorId;

  async function seedSignRequest(docType) {
    const token = crypto.randomUUID();
    const [row] = await db.insert('sign_requests', {
      token,
      job_id: jobId,
      contact_id: contactId,
      doc_type: docType,
      signer_email: 'local-consent-test@example.invalid',
      status: 'pending',
    });
    return { id: row.id, token };
  }

  async function complete(
    token,
    disclosureSha256 = DISCLOSURE_SHA256,
    signerIp = '192.0.2.10',
  ) {
    return db.rpc('complete_sign_request_with_work_authorization_sms_consent', {
      p_token: token,
      p_signer_name: 'Local Consent Test',
      p_signer_ip: signerIp,
      p_signed_file_path: `${jobId}/esign/local-test.pdf`,
      p_consent_terms: null,
      p_consent_commitment: null,
      p_consent_esign: null,
      p_consent_authority: null,
      p_sms_disclosure_version: DISCLOSURE_VERSION,
      p_sms_disclosure_sha256: disclosureSha256,
    });
  }

  beforeAll(async () => {
    const [actor] = await db.insert('employees', {
      email: `local-wa-consent-${runId}@example.invalid`,
      full_name: `Local WA Consent Actor ${runId}`,
      display_name: 'Local WA Actor',
      role: 'admin',
      is_active: true,
      is_external: false,
    });
    actorId = actor.id;

    const [contact] = await db.insert('contacts', {
      phone,
      name: `Local WA Consent ${runId}`,
      opt_in_status: false,
      dnd: false,
    });
    contactId = contact.id;
    const [legacyContact] = await db.insert('contacts', {
      phone: legacyPhone,
      name: `Local Legacy Consent ${runId}`,
      opt_in_status: false,
      dnd: false,
    });
    legacyContactId = legacyContact.id;
    await db.insert('service_sms_consents', {
      contact_id: legacyContactId,
      phone: legacyPhone,
      consent_scope: 'service_related_customer_project_messages',
      consent_method: 'verbal_permission',
      consent_obtained_on: '2026-07-26',
      evidence_note: 'Local compatibility evidence only',
      attestation_version: 'prior_sms_consent_v1',
      sender_identity: 'Utah Pros Restoration',
      recorded_by: actorId,
      request_ip: '192.0.2.20',
    });

    const [job] = await db.insert('jobs', {
      insured_name: `Local WA Consent ${runId}`,
      client_phone: phone,
    });
    jobId = job.id;
  });

  afterAll(async () => {
    await db.delete(
      'service_sms_consents',
      `contact_id=eq.${legacyContactId}`,
    ).catch(() => {});
    await db.delete('sms_consent_log', `contact_id=eq.${contactId}`).catch(() => {});
    await db.delete(
      'work_authorization_sms_consents',
      `contact_id=eq.${contactId}`,
    ).catch(() => {});
    await db.delete('job_documents', `job_id=eq.${jobId}`).catch(() => {});
    await db.delete('system_events', `job_id=eq.${jobId}`).catch(() => {});
    await db.delete('sign_requests', `job_id=eq.${jobId}`).catch(() => {});
    await db.delete('jobs', `id=eq.${jobId}`).catch(() => {});
    await db.delete('contacts', `id=eq.${contactId}`).catch(() => {});
    await db.delete('contacts', `id=eq.${legacyContactId}`).catch(() => {});
    await db.delete('employees', `id=eq.${actorId}`).catch(() => {});
  });

  it('completes a changed-disclosure signature but records no permission', async () => {
    const request = await seedSignRequest('work_auth');
    const result = await complete(request.token, WRONG_SHA256);

    expect(result.success).toBe(true);
    expect(result.sms_consent_recorded).toBe(false);
    expect(result.sms_consent_reason).toBe('disclosure_not_approved');
    expect(await db.select(
      'work_authorization_sms_consents',
      `sign_request_id=eq.${request.id}&select=sign_request_id`,
    )).toHaveLength(0);

    const status = await db.rpc('get_service_sms_consent_status', {
      p_contact_id: contactId,
      p_destination_phone: phone,
    });
    expect(status).toMatchObject({ allowed: false, code: 'NO_CONSENT' });
  });

  it('requires a server-observed signer IP for automatic consent evidence', async () => {
    const request = await seedSignRequest('work_auth');
    const result = await complete(request.token, DISCLOSURE_SHA256, null);

    expect(result.success).toBe(true);
    expect(result.sms_consent_recorded).toBe(false);
    expect(result.sms_consent_reason).toBe('sign_request_not_eligible');
    expect(await db.select(
      'work_authorization_sms_consents',
      `sign_request_id=eq.${request.id}&select=sign_request_id`,
    )).toHaveLength(0);
  });

  it('records exact Work Authorization evidence without setting global opt-in', async () => {
    const request = await seedSignRequest('work_auth');
    const result = await complete(request.token);

    expect(result.success).toBe(true);
    expect(result.sms_consent_recorded).toBe(true);
    expect(result.sms_consent_reason).toBe('upr_signed_work_authorization');

    const [evidence] = await db.select(
      'work_authorization_sms_consents',
      `sign_request_id=eq.${request.id}&select=sign_request_id,contact_id,job_id,phone,signer_ip,consent_scope,consent_source,disclosure_version,disclosure_sha256,signed_file_path,signed_at`,
    );
    expect(evidence).toMatchObject({
      sign_request_id: request.id,
      contact_id: contactId,
      job_id: jobId,
      phone,
      signer_ip: '192.0.2.10',
      consent_scope: 'service_related_customer_project_messages',
      consent_source: 'upr_signed_work_authorization',
      disclosure_version: DISCLOSURE_VERSION,
      disclosure_sha256: DISCLOSURE_SHA256,
    });

    const [contact] = await db.select(
      'contacts',
      `id=eq.${contactId}&select=opt_in_status,opt_in_source,opt_in_at`,
    );
    expect(contact.opt_in_status).toBe(false);
    expect(contact.opt_in_source).toBeNull();
    expect(contact.opt_in_at).toBeNull();

    const [legacyLog] = await db.select(
      'sms_consent_log',
      `contact_id=eq.${contactId}&source=eq.upr_signed_work_authorization&select=performed_by,ip_address`,
    );
    expect(legacyLog).toEqual({
      performed_by: null,
      ip_address: null,
    });

    const status = await db.rpc('get_service_sms_consent_status', {
      p_contact_id: contactId,
      p_destination_phone: phone,
    });
    expect(status).toMatchObject({
      allowed: true,
      code: 'SERVICE_CONSENT',
      consent_scope: 'service_related_customer_project_messages',
    });
  });

  it('preserves the existing staff-attestation response contract', async () => {
    const expectedKeys = [
      'allowed',
      'attested_at',
      'code',
      'consent_scope',
      'contact_id',
    ];
    const withDestination = await db.rpc('get_service_sms_consent_status', {
      p_contact_id: legacyContactId,
      p_destination_phone: legacyPhone,
    });
    const withDefaultDestination = await db.rpc('get_service_sms_consent_status', {
      p_contact_id: legacyContactId,
    });

    for (const status of [withDestination, withDefaultDestination]) {
      expect(Object.keys(status).sort()).toEqual(expectedKeys);
      expect(status).toMatchObject({
        allowed: true,
        code: 'SERVICE_CONSENT',
        contact_id: legacyContactId,
        consent_scope: 'service_related_customer_project_messages',
      });
      expect(status.attested_at).toEqual(expect.any(String));
    }
  });

  it('keeps DND authoritative over signed evidence', async () => {
    await db.update('contacts', `id=eq.${contactId}`, { dnd: true });
    const status = await db.rpc('get_service_sms_consent_status', {
      p_contact_id: contactId,
      p_destination_phone: phone,
    });
    expect(status).toMatchObject({ allowed: false, code: 'DND_ACTIVE' });
    expect(await db.select(
      'work_authorization_sms_consents',
      `contact_id=eq.${contactId}&select=sign_request_id`,
    )).toHaveLength(1);
    await db.update('contacts', `id=eq.${contactId}`, { dnd: false });
  });

  it('does not record consent for another document type', async () => {
    const request = await seedSignRequest('direction_pay');
    const result = await complete(request.token);
    expect(result.success).toBe(true);
    expect(result.sms_consent_recorded).toBeUndefined();
    expect(await db.select(
      'work_authorization_sms_consents',
      `sign_request_id=eq.${request.id}&select=sign_request_id`,
    )).toHaveLength(0);
  });

  it('denies the anonymous browser role at the RPC boundary', async () => {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/rpc/complete_sign_request_with_work_authorization_sms_consent`,
      {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_token: crypto.randomUUID(),
          p_signer_name: 'Denied',
          p_signer_ip: '192.0.2.11',
          p_signed_file_path: 'denied.pdf',
        }),
      },
    );
    expect([401, 403, 404]).toContain(res.status);
  });
});
