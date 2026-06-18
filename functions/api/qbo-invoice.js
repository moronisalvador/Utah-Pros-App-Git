// POST /api/qbo-invoice — push a UPR invoice to QuickBooks Online (one invoice per job).
//
// Auth: x-webhook-secret (server-side) or a Supabase Bearer (admin).
// Body:
//   { "invoice_id": "<uuid>" }                       — create the QBO invoice
//   { "invoice_id": "<uuid>", "action": "delete" }   — delete it from QBO (cleanup)
//
// Builds one summary line from the job's division (Item + Class) at the invoice
// total, customer = the contact's qbo_customer_id, with the claim/job ref in the
// private note. Idempotent (skips if qbo_invoice_id already set). Detailed line
// items / adjustments come in phase 2b.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { getConnection, divisionToQbo, findClassId, createInvoice, deleteInvoice } from '../lib/quickbooks.js';

async function isAuthorized(request, env) {
  const secret = request.headers.get('x-webhook-secret');
  if (secret && env.QBO_WEBHOOK_SECRET && secret === env.QBO_WEBHOOK_SECRET) return true;
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return false;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

async function logRun(db, status, processed, errorMessage, startedAt) {
  try {
    await db.insert('worker_runs', {
      worker_name: 'qbo-invoice', status, records_processed: processed,
      error_message: errorMessage || null, started_at: startedAt, completed_at: new Date().toISOString(),
    });
  } catch (_) { /* best-effort */ }
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const startedAt = new Date().toISOString();

  if (!(await isAuthorized(request, env))) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  const db = supabase(env);
  const conn = await getConnection(env);
  if (!conn || !conn.refresh_token) return jsonResponse({ error: 'QuickBooks not connected' }, 409, request, env);

  let body = {};
  try { body = await request.json(); } catch (_) { /* empty */ }
  const invoiceId = body.invoice_id;
  if (!invoiceId) return jsonResponse({ error: 'Provide invoice_id' }, 400, request, env);

  const inv = (await db.select('invoices', `id=eq.${invoiceId}&limit=1`))?.[0];
  if (!inv) return jsonResponse({ error: 'Invoice not found' }, 404, request, env);

  // ── Cleanup path: delete from QBO ──
  if (body.action === 'delete') {
    if (!inv.qbo_invoice_id) return jsonResponse({ error: 'No qbo_invoice_id to delete' }, 400, request, env);
    try {
      await deleteInvoice(env, inv.qbo_invoice_id);
      await db.update('invoices', `id=eq.${invoiceId}`, { qbo_invoice_id: null, qbo_synced_at: null, qbo_sync_error: null });
      return jsonResponse({ deleted: inv.qbo_invoice_id }, 200, request, env);
    } catch (e) {
      return jsonResponse({ error: e.message }, 500, request, env);
    }
  }

  // ── Idempotency ──
  if (inv.qbo_invoice_id) {
    return jsonResponse({ skipped: true, reason: 'already synced', qbo_invoice_id: inv.qbo_invoice_id }, 200, request, env);
  }

  try {
    const job = (await db.select('jobs', `id=eq.${inv.job_id}&select=division,job_number,claim_id&limit=1`))?.[0];
    if (!job) throw new Error('Job not found for invoice');

    const contact = inv.contact_id
      ? (await db.select('contacts', `id=eq.${inv.contact_id}&select=qbo_customer_id,name&limit=1`))?.[0]
      : null;
    if (!contact?.qbo_customer_id) throw new Error('Invoice contact has no QuickBooks customer — sync the client first');

    const map = divisionToQbo(job.division);
    if (!map) throw new Error(`No QuickBooks mapping for division "${job.division}"`);

    const amount = Number(inv.adjusted_total ?? inv.total ?? 0);
    if (!(amount > 0)) throw new Error('Invoice total is 0 — add an amount before pushing');

    let claimNo = inv.claim_number;
    if (!claimNo && job.claim_id) {
      claimNo = (await db.select('claims', `id=eq.${job.claim_id}&select=claim_number&limit=1`))?.[0]?.claim_number || null;
    }

    const classId = map.className ? await findClassId(env, map.className) : null;

    const line = {
      DetailType: 'SalesItemLineDetail',
      Amount: amount,
      SalesItemLineDetail: {
        ItemRef: { value: map.itemId },
        ...(classId ? { ClassRef: { value: classId } } : {}),
      },
    };
    const payload = {
      CustomerRef: { value: String(contact.qbo_customer_id) },
      Line: [line],
      PrivateNote: `UPR ${inv.invoice_number} · job ${job.job_number || ''}${claimNo ? ' · claim ' + claimNo : ''}`,
    };

    const qboInv = await createInvoice(env, payload);
    await db.update('invoices', `id=eq.${invoiceId}`, {
      qbo_invoice_id: String(qboInv.Id), qbo_synced_at: new Date().toISOString(), qbo_sync_error: null,
    });
    await logRun(db, 'completed', 1, null, startedAt);
    return jsonResponse({ ok: true, qbo_invoice_id: qboInv.Id, doc_number: qboInv.DocNumber, total: qboInv.TotalAmt }, 200, request, env);
  } catch (e) {
    await db.update('invoices', `id=eq.${invoiceId}`, { qbo_sync_error: (e.message || 'push failed').slice(0, 500) });
    await logRun(db, 'error', 0, e.message, startedAt);
    return jsonResponse({ error: e.message, intuit_tid: e.intuitTid || null }, 500, request, env);
  }
}
