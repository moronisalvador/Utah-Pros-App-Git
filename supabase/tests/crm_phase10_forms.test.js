/**
 * ════════════════════════════════════════════════
 * FILE: crm_phase10_forms.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the CRM Forms database functions work against the real database.
 *   It checks that: a form can be created, published, then edited without
 *   changing the already-published copy (draft→publish versioning); a form
 *   submission turns into exactly one lead even if the same submission is
 *   delivered twice (idempotency); ticking the consent box records a real SMS
 *   opt-in with the person's IP and the consent-text version; and NOT ticking
 *   it records no opt-in. All test rows are tagged to the disposable TEST org
 *   and deleted when the test finishes.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → form_definitions, form_submissions, inbound_leads,
 *                       contacts, sms_consent_log, lead_attribution,
 *                       system_events, crm_orgs
 *              writes → all of the above via upsert_form / upsert_lead_from_form
 *                       RPCs; every row deleted in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project (a SQL RPC's
 *     behavior can't be a pure unit test). Self-skips via describe.skipIf when
 *     VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are absent, same as the other
 *     CRM suites — CI's `npm test` doesn't pass those secrets.
 *   - Committed RED (before the RPC bodies were filled — the stubs raise
 *     'not implemented (phase 10)') per the Phase 10 test-first requirement.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;
const one = (r) => (Array.isArray(r) ? r[0] : r);

describe.skipIf(!hasCreds)('CRM Phase 10 — forms (integration)', () => {
  const runId = Date.now();
  const token1 = `test-form-tok-${runId}-a`;
  const token2 = `test-form-tok-${runId}-b`;
  const phone1 = `+1557${String(runId).slice(-7)}`;
  const phone2 = `+1558${String(runId).slice(-7)}`;
  const ip = '203.0.113.7';

  let testOrgId;
  let formId;         // form used for lead-submission tests
  const createdFormIds = [];
  const createdLeadIds = [];

  const schema = {
    fields: [
      { key: 'name',    type: 'text',    label: 'Full name', required: true },
      { key: 'phone',   type: 'phone',   label: 'Phone',     required: true },
      { key: 'consent', type: 'consent', label: 'I agree to receive text messages from Utah Pros.', required: true },
    ],
    submitText: 'Request a quote',
    thankYou: 'Thanks — we will reach out shortly.',
  };

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;
  });

  afterAll(async () => {
    // Order matters: leads/submissions reference forms; consent/attribution reference leads.
    for (const lid of createdLeadIds) {
      await db.delete('lead_attribution', `lead_id=eq.${lid}`).catch(() => {});
      await db.delete('system_events', `entity_id=eq.${lid}`).catch(() => {});
    }
    await db.delete('inbound_leads', `callrail_id=in.(form:${token1},form:${token2})`).catch(() => {});
    for (const fid of createdFormIds) {
      await db.delete('system_events', `entity_id=eq.${fid}`).catch(() => {});
      await db.delete('form_definitions', `id=eq.${fid}`).catch(() => {}); // cascades versions + submissions
    }
    await db.delete('sms_consent_log', `phone=in.(${encodeURIComponent(phone1)},${encodeURIComponent(phone2)})`).catch(() => {});
    await db.delete('contacts', `phone=in.(${encodeURIComponent(phone1)},${encodeURIComponent(phone2)})`).catch(() => {});
  });

  // ─── upsert_form: create → publish → edit-without-mutating-published ───
  it('creates a draft form with a public_id', async () => {
    const row = one(await db.rpc('upsert_form', {
      p_name: `TEST form ${runId}`,
      p_schema: schema,
      p_theme: { primary: '#6366f1' },
      p_org_id: testOrgId,
    }));
    expect(row.id).toBeTruthy();
    expect(row.public_id).toBeTruthy();
    expect(row.status).toBe('draft');
    expect(row.published_version_id).toBeFalsy();
    formId = row.id;
    createdFormIds.push(row.id);
  });

  it('publishes the form (status → published, published_version_id set)', async () => {
    const row = one(await db.rpc('upsert_form', {
      p_id: formId,
      p_schema: schema,
      p_publish: true,
      p_org_id: testOrgId,
    }));
    expect(row.status).toBe('published');
    expect(row.published_version_id).toBeTruthy();
  });

  it('editing after publish creates a new draft and does NOT mutate the published version', async () => {
    const published = one(await db.rpc('upsert_form', { p_id: formId, p_org_id: testOrgId, p_publish: false }));
    const publishedVersionId = published.published_version_id;

    const editedSchema = { ...schema, thankYou: 'EDITED thank-you copy' };
    const afterEdit = one(await db.rpc('upsert_form', {
      p_id: formId, p_schema: editedSchema, p_publish: false, p_org_id: testOrgId,
    }));
    // Published pointer unchanged by a draft edit.
    expect(afterEdit.published_version_id).toBe(publishedVersionId);

    // The published snapshot still carries the ORIGINAL thankYou copy.
    const [pubVersion] = await db.select(
      'form_definition_versions',
      `id=eq.${publishedVersionId}&select=schema,is_published,version`,
    );
    expect(pubVersion.is_published).toBe(true);
    expect(pubVersion.schema.thankYou).toBe('Thanks — we will reach out shortly.');
  });

  it('get_forms returns the form with its published schema and a submissions array', async () => {
    const rows = await db.rpc('get_forms', { p_org_id: testOrgId });
    const mine = (rows || []).find((f) => f.id === formId);
    expect(mine).toBeTruthy();
    expect(mine.public_id).toBeTruthy();
    expect(Array.isArray(mine.submissions)).toBe(true);
    expect(typeof mine.submission_count).toBe('number');
  });

  // ─── upsert_lead_from_form: idempotency + consent ───
  it('a submission with consent creates one lead + contact + opt-in + attribution + events', async () => {
    const lead = one(await db.rpc('upsert_lead_from_form', {
      p_form_id: formId,
      p_submission_token: token1,
      p_data: { name: 'Test Person', phone: phone1, consent: true },
      p_utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'water-damage' },
      p_consent: true,
      p_ip: ip,
      p_user_agent: 'vitest',
      p_org_id: testOrgId,
    }));
    expect(lead.id).toBeTruthy();
    expect(lead.source_type).toBe('form');
    expect(lead.callrail_id).toBe(`form:${token1}`);
    expect(lead.contact_id).toBeTruthy();
    createdLeadIds.push(lead.id);

    // Contact opted in.
    const [contact] = await db.select('contacts', `id=eq.${lead.contact_id}&select=opt_in_status,phone`);
    expect(contact.opt_in_status).toBe(true);

    // Consent log: opt_in row with the IP and a version marker in details.
    const consentRows = await db.select(
      'sms_consent_log',
      `contact_id=eq.${lead.contact_id}&event_type=eq.opt_in&select=ip_address,details`,
    );
    expect(consentRows.length).toBe(1);
    expect(consentRows[0].ip_address).toBe(ip);
    expect(consentRows[0].details).toMatch(/v\d+/); // consent-text version

    // Attribution written (channel derived from utm_source=google → google_ads).
    const attr = await db.select('lead_attribution', `lead_id=eq.${lead.id}&select=channel,campaign`);
    expect(attr.length).toBe(1);
    expect(attr[0].channel).toBe('google_ads');

    // form_submissions row exists for the token.
    const subs = await db.select('form_submissions', `submission_token=eq.${token1}&select=id,lead_id`);
    expect(subs.length).toBe(1);
    expect(subs[0].lead_id).toBe(lead.id);

    // system_events: both crm_lead_created and crm_form_submitted fired.
    const evLead = await db.select('system_events', `entity_id=eq.${lead.id}&event_type=eq.crm_lead_created&select=id`);
    expect(evLead.length).toBeGreaterThanOrEqual(1);
    const evForm = await db.select('system_events', `event_type=eq.crm_form_submitted&entity_id=eq.${formId}&select=id`);
    expect(evForm.length).toBeGreaterThanOrEqual(1);
  });

  it('redelivering the SAME submission token returns the same lead (no duplicate, no second opt-in)', async () => {
    const again = one(await db.rpc('upsert_lead_from_form', {
      p_form_id: formId,
      p_submission_token: token1,
      p_data: { name: 'Test Person', phone: phone1, consent: true },
      p_consent: true,
      p_ip: ip,
      p_org_id: testOrgId,
    }));
    expect(again.callrail_id).toBe(`form:${token1}`);

    const subs = await db.select('form_submissions', `submission_token=eq.${token1}&select=id`);
    expect(subs.length).toBe(1); // still exactly one

    const consentRows = await db.select('sms_consent_log', `contact_id=eq.${again.contact_id}&event_type=eq.opt_in&select=id`);
    expect(consentRows.length).toBe(1); // no second opt-in row
  });

  it('a submission WITHOUT consent records no SMS opt-in', async () => {
    const lead = one(await db.rpc('upsert_lead_from_form', {
      p_form_id: formId,
      p_submission_token: token2,
      p_data: { name: 'No Consent', phone: phone2, consent: false },
      p_consent: false,
      p_ip: ip,
      p_org_id: testOrgId,
    }));
    expect(lead.callrail_id).toBe(`form:${token2}`);
    createdLeadIds.push(lead.id);

    const consentRows = await db.select('sms_consent_log', `contact_id=eq.${lead.contact_id}&event_type=eq.opt_in&select=id`);
    expect(consentRows.length).toBe(0);

    const [contact] = await db.select('contacts', `id=eq.${lead.contact_id}&select=opt_in_status`);
    expect(contact.opt_in_status).not.toBe(true);
  });
});
