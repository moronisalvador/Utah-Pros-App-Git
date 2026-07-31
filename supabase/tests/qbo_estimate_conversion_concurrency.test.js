/**
 * QBO estimate-conversion concurrency (qa-staging integration).
 *
 * Exercises only disposable branch rows and temporary Auth identities. It
 * refuses every target except the committed qa-staging project, proves the
 * browser/service authorization boundary before a writer can mutate anything,
 * and never contacts QuickBooks or another provider.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';

import { supabase } from '../../functions/lib/supabase.js';
import { QA_FIXTURE_PASSWORD, signInFixture } from './helpers/qaFixtures.mjs';
import { QA_BRANCH_PROJECT_REF, QA_BRANCH_SENTINEL, assertQaBranchTarget } from '../../tests/qa/lib/target-policy.mjs';

const env = globalThis.process?.env || {};
const serviceKeyName = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
const url = env.SUPABASE_URL || '';
const anonKey = env.SUPABASE_ANON_KEY || '';
const serviceKey = env[serviceKeyName] || '';
const confirmed = env.UPR_QA_CONFIRMED_QA_BRANCH === QA_BRANCH_SENTINEL;
const projectRef = (() => {
  try { return new URL(url).hostname.split('.')[0]; } catch { return ''; }
})();
const hasCreds = !!(confirmed && anonKey && serviceKey && (() => {
  try {
    assertQaBranchTarget({ mode: 'qa-branch', projectRef, supabaseUrl: url });
    return true;
  } catch {
    return false;
  }
})());

if ((url || anonKey || serviceKey || confirmed) && !hasCreds) {
  throw new Error('QBO conversion integration test refused: exact qa-staging branch credentials are required; production is never a test target');
}

const db = hasCreds ? supabase({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey }) : null;
async function browserRpc(token, fn, params) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  if (!res.ok) {
    const error = new Error(`RPC ${fn}: ${res.status} ${text}`);
    error.status = res.status;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

async function createTemporaryUser(email) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: QA_FIXTURE_PASSWORD, email_confirm: true }),
  });
  const body = await res.json();
  if (!res.ok || !body.id) throw new Error(`temporary Auth user create failed: ${res.status}`);
  return body.id;
}

async function deleteTemporaryUser(id) {
  if (!id) return;
  await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
}

async function signIn(email) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: QA_FIXTURE_PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`temporary Auth sign-in failed: ${res.status}`);
  return body.access_token;
}

describe.skipIf(!hasCreds)('QBO estimate conversion concurrency (qa-staging)', () => {
  const runId = randomUUID();
  const tag = `qa-qbo-convert-${runId}`;
  const claimHash = createHash('sha256').update(`${tag}:retry`).digest('hex');
  let contactId;
  let jobId;
  let deniedJobId;
  let estimateId;
  let decisionEstimateId;
  let inactiveUserId;
  let externalUserId;
  let inactiveEmployeeId;
  let externalEmployeeId;
  let admin;
  let office;
  let tech;
  let inactiveToken;
  let externalToken;
  const invoiceIds = [];

  beforeAll(async () => {
    // Explicitly bind the constant into the test so accidental target-policy drift is visible.
    expect(projectRef).toBe(QA_BRANCH_PROJECT_REF);
    admin = await signInFixture('admin');
    office = await signInFixture('office');
    tech = await signInFixture('tech');

    inactiveUserId = await createTemporaryUser(`${tag}-inactive@upr-qa.test`);
    externalUserId = await createTemporaryUser(`${tag}-external@upr-qa.test`);
    inactiveToken = await signIn(`${tag}-inactive@upr-qa.test`);
    externalToken = await signIn(`${tag}-external@upr-qa.test`);
    const [inactive] = await db.insert('employees', {
      email: `${tag}-inactive@upr-qa.test`, full_name: `${tag} inactive admin`, display_name: 'QA inactive admin',
      role: 'admin', is_active: false, is_external: false, auth_user_id: inactiveUserId,
    });
    inactiveEmployeeId = inactive.id;
    const [external] = await db.insert('employees', {
      email: `${tag}-external@upr-qa.test`, full_name: `${tag} external admin`, display_name: 'QA external admin',
      role: 'admin', is_active: true, is_external: true, auth_user_id: externalUserId,
    });
    externalEmployeeId = external.id;

    const [contact] = await db.insert('contacts', { name: `${tag} contact`, phone: `+1801${String(Date.now()).slice(-7)}` });
    contactId = contact.id;
    const [job] = await db.insert('jobs', {
      job_number: `${tag}-job`, primary_contact_id: contactId, division: 'water', phase: 'job_received',
    });
    jobId = job.id;
    const [deniedJob] = await db.insert('jobs', {
      job_number: `${tag}-denied`, primary_contact_id: contactId, division: 'water', phase: 'job_received',
    });
    deniedJobId = deniedJob.id;
    const [estimate] = await db.insert('estimates', {
      job_id: jobId, contact_id: contactId, estimate_number: `${tag}-estimate`, estimate_type: 'initial', status: 'draft', amount: 0, subtotal: 0,
    });
    estimateId = estimate.id;
    const [decisionEstimate] = await db.insert('estimates', {
      job_id: jobId, contact_id: contactId, estimate_number: `${tag}-decision`, estimate_type: 'initial', status: 'draft', amount: 125, subtotal: 125,
    });
    decisionEstimateId = decisionEstimate.id;
    await db.insert('estimate_line_items', Array.from({ length: 8 }, (_, index) => ({
      estimate_id: estimateId, description: `${tag} line ${index}`, quantity: index + 1, unit: 'EA', unit_price: 10 + index, sort_order: index,
    })));
  });

  afterAll(async () => {
    await db.delete('qbo_events', `id=eq.${claimHash}`).catch(() => {});
    // The converted estimate and invoice point at each other. Clear only those
    // disposable links first so cleanup cannot strand tagged money rows.
    if (estimateId) await db.update('estimates', `id=eq.${estimateId}`, { converted_invoice_id: null }).catch(() => {});
    if (invoiceIds.length) await db.update('invoices', `id=in.(${invoiceIds.join(',')})`, { estimate_id: null }).catch(() => {});
    if (estimateId) await db.delete('estimate_line_items', `estimate_id=eq.${estimateId}`).catch(() => {});
    if (invoiceIds.length) await db.delete('invoice_line_items', `invoice_id=in.(${invoiceIds.join(',')})`).catch(() => {});
    if (invoiceIds.length) await db.delete('invoices', `id=in.(${invoiceIds.join(',')})`).catch(() => {});
    if (estimateId) await db.delete('estimates', `id=eq.${estimateId}`).catch(() => {});
    if (decisionEstimateId) await db.delete('estimates', `id=eq.${decisionEstimateId}`).catch(() => {});
    // Job-related audit rows use a foreign key, so remove only this run's
    // exact job fixtures before removing the fixtures themselves.
    if (jobId || deniedJobId) await db.delete('system_events', `job_id=in.(${[jobId, deniedJobId].filter(Boolean).join(',')})`).catch(() => {});
    if (jobId || deniedJobId) await db.delete('jobs', `id=in.(${[jobId, deniedJobId].filter(Boolean).join(',')})`).catch(() => {});
    if (contactId) await db.delete('contacts', `id=eq.${contactId}`).catch(() => {});
    if (inactiveEmployeeId) await db.delete('employees', `id=eq.${inactiveEmployeeId}`).catch(() => {});
    if (externalEmployeeId) await db.delete('employees', `id=eq.${externalEmployeeId}`).catch(() => {});
    await deleteTemporaryUser(inactiveUserId);
    await deleteTemporaryUser(externalUserId);
  });

  it('allows the active admin browser and service role to create the same job invoice', async () => {
    const adminInvoice = await admin.rpc('create_invoice_for_job', { p_job_id: jobId, p_created_by: admin.fixture.employeeId });
    const serviceInvoice = await db.rpc('create_invoice_for_job', { p_job_id: jobId, p_created_by: null });
    expect(serviceInvoice.id).toBe(adminInvoice.id);
    invoiceIds.push(adminInvoice.id);
  });

  it('denies office, tech, inactive admin, and external admin before either writer can mutate', async () => {
    const denied = [office.token, tech.token, inactiveToken, externalToken];
    for (const token of denied) {
      await expect(browserRpc(token, 'create_invoice_for_job', { p_job_id: deniedJobId, p_created_by: null })).rejects.toMatchObject({ status: 403 });
      await expect(browserRpc(token, 'convert_estimate_to_invoice', { p_estimate_id: estimateId, p_force: false, p_created_by: null })).rejects.toMatchObject({ status: 403 });
    }
    expect(await db.select('invoices', `job_id=eq.${deniedJobId}&select=id`)).toHaveLength(0);
    const [estimate] = await db.select('estimates', `id=eq.${estimateId}&select=converted_invoice_id`);
    expect(estimate.converted_invoice_id).toBeNull();
  });

  it('serializes concurrent active-admin and service conversions into one linked invoice with one copied line set', async () => {
    const [fromAdmin, fromService] = await Promise.all([
      admin.rpc('convert_estimate_to_invoice', { p_estimate_id: estimateId, p_force: false, p_created_by: admin.fixture.employeeId }),
      db.rpc('convert_estimate_to_invoice', { p_estimate_id: estimateId, p_force: false, p_created_by: null }),
    ]);
    expect(fromAdmin.invoice_id).toBe(fromService.invoice_id);
    expect([fromAdmin.lines_copied, fromService.lines_copied].sort()).toEqual([0, 8]);
    const invoiceId = fromAdmin.invoice_id;
    const links = await db.select('invoices', `estimate_id=eq.${estimateId}&select=id`);
    const lines = await db.select('invoice_line_items', `invoice_id=eq.${invoiceId}&select=id`);
    const [estimate] = await db.select('estimates', `id=eq.${estimateId}&select=converted_invoice_id`);
    expect(links).toEqual([{ id: invoiceId }]);
    expect(estimate.converted_invoice_id).toBe(invoiceId);
    expect(lines).toHaveLength(8);
  });

  it('keeps retry reclamation service-only and atomically reclaims only the retry row', async () => {
    await db.insert('qbo_events', { id: claimHash, entity: 'Invoice', operation: 'Update', status: 'retry', error: 'test-only retry' });
    await expect(admin.rpc('claim_qbo_event', { p_id: claimHash, p_entity: 'Invoice', p_operation: 'Update' })).rejects.toThrow();
    expect(await db.rpc('claim_qbo_event', { p_id: claimHash, p_entity: 'Invoice', p_operation: 'Update' })).toBe(true);
    expect(await db.rpc('claim_qbo_event', { p_id: claimHash, p_entity: 'Invoice', p_operation: 'Update' })).toBe(false);
    const [event] = await db.select('qbo_events', `id=eq.${claimHash}&select=status,error,processed_at`);
    expect(event).toEqual({ status: 'processing', error: null, processed_at: null });
  });

  it('keeps QBO decision application service-only and cannot overwrite a manual decision', async () => {
    for (const token of [admin.token, office.token, tech.token, inactiveToken, externalToken]) {
      await expect(browserRpc(token, 'apply_qbo_estimate_decision', {
        p_estimate_id: decisionEstimateId, p_action: 'approve_only', p_approved_at: null, p_approved_amount: null,
      })).rejects.toMatchObject({ status: 403 });
    }
    const approved = await db.rpc('apply_qbo_estimate_decision', {
      p_estimate_id: decisionEstimateId, p_action: 'approve_only', p_approved_at: '2026-07-31T12:00:00Z', p_approved_amount: 100,
    });
    expect(approved).toMatchObject({ ok: true, action: 'approved-needs-manual-convert' });
    const rejectedAfterApproval = await db.rpc('apply_qbo_estimate_decision', {
      p_estimate_id: decisionEstimateId, p_action: 'reject', p_approved_at: null, p_approved_amount: null,
    });
    expect(rejectedAfterApproval).toEqual({ ok: true, skipped: 'already-decided', status: 'approved' });
    const [decision] = await db.select('estimates', `id=eq.${decisionEstimateId}&select=status,approved_at,approved_amount`);
    expect(decision.status).toBe('approved');
    expect(Number(decision.approved_amount)).toBe(100);
  });

  it('allows exactly one concurrent QBO invoice-link contender and keeps the CAS service-only', async () => {
    const invoiceId = invoiceIds[0];
    for (const token of [admin.token, office.token, tech.token, inactiveToken, externalToken]) {
      await expect(browserRpc(token, 'cas_qbo_invoice_link', {
        p_invoice_id: invoiceId, p_expected_qbo_invoice_id: null, p_new_qbo_invoice_id: 'qa-browser-denied', p_qbo_doc_number: 'qa-browser-denied',
      })).rejects.toMatchObject({ status: 403 });
    }
    const results = await Promise.all([
      db.rpc('cas_qbo_invoice_link', {
        p_invoice_id: invoiceId, p_expected_qbo_invoice_id: null, p_new_qbo_invoice_id: 'qa-cas-a', p_qbo_doc_number: 'QA-CAS-A',
      }),
      db.rpc('cas_qbo_invoice_link', {
        p_invoice_id: invoiceId, p_expected_qbo_invoice_id: null, p_new_qbo_invoice_id: 'qa-cas-b', p_qbo_doc_number: 'QA-CAS-B',
      }),
    ]);
    const success = results.find((result) => result.ok);
    const mismatch = results.find((result) => !result.ok);
    expect(success).toMatchObject({ ok: true, id: invoiceId });
    expect(mismatch).toMatchObject({ ok: false, reason: 'qbo-invoice-mismatch', current_qbo_invoice_id: success.qbo_invoice_id });
    let [invoice] = await db.select('invoices', `id=eq.${invoiceId}&select=qbo_invoice_id,qbo_doc_number,qbo_sync_error,qbo_emailed_at,qbo_email_status,sent_to_email,status`);
    expect(invoice).toMatchObject({
      qbo_invoice_id: success.qbo_invoice_id,
      qbo_doc_number: success.qbo_doc_number,
      qbo_sync_error: null,
      qbo_emailed_at: null,
      qbo_email_status: null,
      sent_to_email: null,
      status: 'saved',
    });

    const emailed = await db.rpc('cas_qbo_invoice_link', {
      p_invoice_id: invoiceId,
      p_expected_qbo_invoice_id: success.qbo_invoice_id,
      p_new_qbo_invoice_id: success.qbo_invoice_id,
      p_qbo_doc_number: success.qbo_doc_number,
      p_qbo_emailed_at: '2026-07-31T12:30:00Z',
      p_qbo_email_status: 'EmailSent',
      p_sent_to_email: 'qa-qbo-lifecycle@example.test',
      p_write_email_metadata: true,
    });
    expect(emailed).toMatchObject({ ok: true, id: invoiceId, qbo_invoice_id: success.qbo_invoice_id });
    [invoice] = await db.select('invoices', `id=eq.${invoiceId}&select=status,qbo_emailed_at`);
    expect(invoice.status).toBe('sent');
    expect(invoice.qbo_emailed_at).not.toBeNull();

    // The shipped editor marks a synced invoice draft when its contents change.
    // A save with no new email should become Saved, while a fresh send must
    // become Sent even if that edited invoice was still locally Draft.
    await db.update('invoices', `id=eq.${invoiceId}`, { status: 'draft' });
    const resaved = await db.rpc('cas_qbo_invoice_link', {
      p_invoice_id: invoiceId,
      p_expected_qbo_invoice_id: success.qbo_invoice_id,
      p_new_qbo_invoice_id: success.qbo_invoice_id,
      p_qbo_doc_number: success.qbo_doc_number,
    });
    expect(resaved).toMatchObject({ ok: true, id: invoiceId });
    [invoice] = await db.select('invoices', `id=eq.${invoiceId}&select=status,qbo_emailed_at`);
    expect(invoice.status).toBe('saved');
    expect(invoice.qbo_emailed_at).not.toBeNull();

    await db.update('invoices', `id=eq.${invoiceId}`, { status: 'draft' });
    const resent = await db.rpc('cas_qbo_invoice_link', {
      p_invoice_id: invoiceId,
      p_expected_qbo_invoice_id: success.qbo_invoice_id,
      p_new_qbo_invoice_id: success.qbo_invoice_id,
      p_qbo_doc_number: success.qbo_doc_number,
      p_qbo_emailed_at: '2026-07-31T12:45:00Z',
      p_qbo_email_status: 'EmailSent',
      p_sent_to_email: 'qa-qbo-lifecycle@example.test',
      p_write_email_metadata: true,
    });
    expect(resent).toMatchObject({ ok: true, id: invoiceId });
    [invoice] = await db.select('invoices', `id=eq.${invoiceId}&select=status,qbo_emailed_at`);
    expect(invoice.status).toBe('sent');
    expect(invoice.qbo_emailed_at).toContain('12:45:00');

    const cleared = await db.rpc('cas_qbo_invoice_link', {
      p_invoice_id: invoiceId,
      p_expected_qbo_invoice_id: success.qbo_invoice_id,
      p_new_qbo_invoice_id: null,
      p_qbo_doc_number: null,
    });
    expect(cleared).toMatchObject({ ok: true, id: invoiceId, qbo_invoice_id: null, qbo_doc_number: null });
    [invoice] = await db.select('invoices', `id=eq.${invoiceId}&select=qbo_invoice_id,qbo_doc_number,qbo_emailed_at,qbo_email_status,sent_to_email,status`);
    expect(invoice).toEqual({
      qbo_invoice_id: null,
      qbo_doc_number: null,
      qbo_emailed_at: null,
      qbo_email_status: null,
      sent_to_email: null,
      status: 'draft',
    });
  });

});
