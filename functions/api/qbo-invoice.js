// POST /api/qbo-invoice — push a UPR invoice to QuickBooks Online (one invoice per job).
//
// Auth: x-webhook-secret (server-side) or a Supabase Bearer (admin).
// Body:
//   { "invoice_id": "<uuid>" }                       — create OR update the QBO invoice
//   { "invoice_id": "<uuid>", "action": "delete" }   — delete it from QBO (cleanup)
//   { "invoice_id": "<uuid>", "action": "send",      — ask QBO to EMAIL the invoice to
//     "send_to": "name@x.com" (optional) }             the customer (defaults to the
//                                                       invoice contact's email)
//
// Builds one summary line from the job's division (Item + Class) at the invoice
// total, customer = the contact's qbo_customer_id, with the claim/job ref in the
// private note. If the invoice already has a qbo_invoice_id it is UPDATED in place
// (sparse update) — this is what makes auto-push on edit work (Phase 0.5). Detailed
// line items / adjustments come in phase 2b.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { getConnection, divisionToQbo, findClassId, createInvoice, updateInvoice, deleteInvoice, sendInvoice } from '../lib/quickbooks.js';

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
  } catch { /* best-effort */ }
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
  try { body = await request.json(); } catch { /* empty */ }
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

  // ── Send path: ask QBO to email the invoice to the customer ──
  if (body.action === 'send') {
    if (!inv.qbo_invoice_id) return jsonResponse({ error: 'Invoice has not been sent to QuickBooks yet — push it first, then email.' }, 400, request, env);

    // Recipient: explicit override, else the invoice contact's email on file.
    let sendTo = (body.send_to || '').trim() || null;
    if (!sendTo && inv.contact_id) {
      const c = (await db.select('contacts', `id=eq.${inv.contact_id}&select=email&limit=1`))?.[0];
      sendTo = (c?.email || '').trim() || null;
    }
    if (!sendTo) return jsonResponse({ error: 'No email address on file for this customer — add one to the contact (or pass send_to) before emailing.' }, 400, request, env);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sendTo)) return jsonResponse({ error: `Customer email looks invalid: ${sendTo}` }, 400, request, env);

    try {
      const qboInv = await sendInvoice(env, inv.qbo_invoice_id, sendTo);
      const nowIso = new Date().toISOString();
      await db.update('invoices', `id=eq.${invoiceId}`, {
        qbo_emailed_at:   nowIso,
        qbo_email_status: qboInv?.EmailStatus || 'EmailSent',
        sent_to_email:    sendTo,
        qbo_sync_error:   null,
      });
      await logRun(db, 'completed', 1, null, startedAt);
      return jsonResponse({ ok: true, emailed_to: sendTo, email_status: qboInv?.EmailStatus || 'EmailSent' }, 200, request, env);
    } catch (e) {
      await logRun(db, 'error', 0, e.message, startedAt);
      return jsonResponse({ error: e.message, intuit_tid: e.intuitTid || null }, 500, request, env);
    }
  }

  try {
    const job = (await db.select('jobs', `id=eq.${inv.job_id}&select=division,job_number,claim_id,address,city,state,zip,date_of_loss&limit=1`))?.[0];
    if (!job) throw new Error('Job not found for invoice');

    const contact = inv.contact_id
      ? (await db.select('contacts', `id=eq.${inv.contact_id}&select=qbo_customer_id,name&limit=1`))?.[0]
      : null;
    if (!contact?.qbo_customer_id) throw new Error('Invoice contact has no QuickBooks customer — sync the client first');

    const map = divisionToQbo(job.division);
    if (!map) throw new Error(`No QuickBooks mapping for division "${job.division}"`);

    const claim = job.claim_id
      ? (await db.select('claims', `id=eq.${job.claim_id}&select=claim_number,date_of_loss,loss_address,loss_city,loss_state,loss_zip&limit=1`))?.[0] || null
      : null;
    const claimNo = inv.claim_number || claim?.claim_number || null;

    const divClassId = map.className ? await findClassId(env, map.className) : null;

    // Build QBO lines from the invoice's line items (itemized — each line carries its
    // own QBO Item + Class). Fall back to a single division-summary line for invoices
    // that have no line items yet.
    const items = await db.select('invoice_line_items', `invoice_id=eq.${invoiceId}&order=sort_order.asc.nullslast,created_at.asc`) || [];
    let lines;
    if (items.length) {
      lines = items.map(li => {
        const amt = Number(li.line_total != null ? li.line_total : Number(li.quantity || 0) * Number(li.unit_price || 0));
        const detail = { ItemRef: { value: String(li.qbo_item_id || map.itemId) } };
        const cls = li.qbo_class_id || divClassId;
        if (cls) detail.ClassRef = { value: String(cls) };
        if (li.quantity != null) detail.Qty = Number(li.quantity);
        if (li.unit_price != null) detail.UnitPrice = Number(li.unit_price);
        return {
          DetailType: 'SalesItemLineDetail',
          Amount: amt,
          ...(li.description ? { Description: li.description } : {}),
          SalesItemLineDetail: detail,
        };
      });
    } else {
      const amount = Number(inv.adjusted_total ?? inv.total ?? 0);
      const detail = { ItemRef: { value: map.itemId } };
      if (divClassId) detail.ClassRef = { value: divClassId };
      lines = [{ DetailType: 'SalesItemLineDetail', Amount: amount, SalesItemLineDetail: detail }];
    }
    const lineTotal = lines.reduce((s, l) => s + Number(l.Amount || 0), 0);
    if (!(lineTotal > 0)) throw new Error('Invoice total is 0 — add a line item with an amount before syncing');

    // Standard memo + the job's service/loss address (can differ from billing). Address from
    // the job, falling back to the claim's loss address; date of loss likewise.
    const fmtDol = (d) => { if (!d) return ''; const p = String(d).split('T')[0].split('-'); return p.length === 3 ? `${+p[1]}/${+p[2]}/${p[0]}` : String(d); };
    const dol = fmtDol(job.date_of_loss || claim?.date_of_loss);
    const serviceAddr = ([job.address, job.city, job.state, job.zip].filter(Boolean).join(', '))
      || ([claim?.loss_address, claim?.loss_city, claim?.loss_state, claim?.loss_zip].filter(Boolean).join(', '));
    // Printed on the invoice (CustomerMemo) + kept internally (PrivateNote).
    const memo = `Date of loss: ${dol} · Job: ${job.job_number || ''} · Claim: ${claimNo || ''} · Service Address: ${serviceAddr}`;
    // Service address → the invoice's structured Ship To (no length limit; prints when QBO's
    // Sales > Shipping toggle is on). Per-field: job first, then the claim's loss address.
    const shipAddr = Object.fromEntries(Object.entries({
      Line1: job.address || claim?.loss_address || null,
      City: job.city || claim?.loss_city || null,
      CountrySubDivisionCode: job.state || claim?.loss_state || null,
      PostalCode: job.zip || claim?.loss_zip || null,
    }).filter(([, v]) => v));
    const hasShip = Object.keys(shipAddr).length > 0;

    // Use the job number as the QBO invoice number (DocNumber): unique (one invoice per
    // job), short, and the most traceable reference. Requires "Custom transaction numbers"
    // ON in QBO to take effect; if it's OFF, QBO ignores it and auto-numbers instead.
    // (QBO DocNumber max is 21 chars.)
    const docNumber = job.job_number ? String(job.job_number).slice(0, 21) : null;

    // Estimate → Invoice link: if this invoice was converted from a UPR estimate
    // that already exists in QBO, link the QBO invoice to that QBO estimate. This is
    // how QBO marks the estimate "converted" (Closed) and rolls it into the invoice —
    // so finishing a convert in UPR completes the conversion in QBO too.
    let linkedTxn = null;
    if (inv.estimate_id) {
      const est = (await db.select('estimates', `id=eq.${inv.estimate_id}&select=qbo_estimate_id&limit=1`))?.[0];
      if (est?.qbo_estimate_id) linkedTxn = [{ TxnId: String(est.qbo_estimate_id), TxnType: 'Estimate' }];
    }

    // Online-payment flags — make the emailed QBO invoice show a "Pay now" card/ACH
    // button. Driven by the accept_card / accept_ach billing toggles (integration_config).
    // Only set a flag when true (never write false,false), so this stays inert until
    // QuickBooks Payments is enabled on the company AND the toggles are on.
    const payCfg = (await db.select('integration_config', 'key=in.(accept_card,accept_ach)&select=key,value')) || [];
    const cfgOn = (k) => payCfg.find((r) => r.key === k)?.value === 'true';
    const onlinePay = {};
    if (cfgOn('accept_card')) onlinePay.AllowOnlineCreditCardPayment = true;
    if (cfgOn('accept_ach')) onlinePay.AllowOnlineACHPayment = true;
    const hasOnlinePay = Object.keys(onlinePay).length > 0;

    // Update in place if already synced, else create. `extra` carries the online-pay flags
    // so we can retry without them if QBO rejects (Payments not enabled on the company yet).
    const pushInvoice = (extra) =>
      inv.qbo_invoice_id
        ? updateInvoice(env, inv.qbo_invoice_id, { Line: lines, PrivateNote: memo, CustomerMemo: { value: memo }, ...(docNumber ? { DocNumber: docNumber } : {}), ...(hasShip ? { ShipAddr: shipAddr } : {}), ...(linkedTxn ? { LinkedTxn: linkedTxn } : {}), ...extra })
        : createInvoice(env, { CustomerRef: { value: String(contact.qbo_customer_id) }, Line: lines, PrivateNote: memo, CustomerMemo: { value: memo }, ...(docNumber ? { DocNumber: docNumber } : {}), ...(hasShip ? { ShipAddr: shipAddr } : {}), ...(linkedTxn ? { LinkedTxn: linkedTxn } : {}), ...extra });

    const mode = inv.qbo_invoice_id ? 'updated' : 'created';
    let qboInv, onlinePayWarning = null;
    try {
      qboInv = await pushInvoice(onlinePay);
    } catch (e) {
      // If QBO rejected specifically because of the online-pay flags, retry without them so
      // the invoice still syncs; surface a clear hint instead of a cryptic QBO fault.
      if (hasOnlinePay && /payment|online|merchant/i.test(e.message || '')) {
        qboInv = await pushInvoice({});
        onlinePayWarning = 'Invoice synced, but online card/ACH pay could not be turned on — enable QuickBooks Payments in QuickBooks first.';
      } else {
        throw e;
      }
    }

    const nowIso = new Date().toISOString();
    // Capture QBO's own invoice number (DocNumber) so UPR can display the matching number.
    const patch = { qbo_invoice_id: String(qboInv.Id), qbo_synced_at: nowIso, qbo_sync_error: null, qbo_doc_number: qboInv.DocNumber != null ? String(qboInv.DocNumber) : null };
    if (mode === 'created') {
      // First time it reaches QBO: stamp "sent" + a default Net-30 due date (drives aging).
      if (!inv.sent_at) patch.sent_at = nowIso;
      if (!inv.due_date) {
        const base = inv.invoice_date ? new Date(inv.invoice_date + 'T00:00:00Z') : new Date();
        base.setUTCDate(base.getUTCDate() + 30);
        patch.due_date = base.toISOString().slice(0, 10);
      }
    }
    await db.update('invoices', `id=eq.${invoiceId}`, patch);
    await logRun(db, 'completed', 1, null, startedAt);
    return jsonResponse({ ok: true, mode, qbo_invoice_id: qboInv.Id, doc_number: qboInv.DocNumber, total: qboInv.TotalAmt, online_pay_warning: onlinePayWarning }, 200, request, env);
  } catch (e) {
    await db.update('invoices', `id=eq.${invoiceId}`, { qbo_sync_error: (e.message || 'push failed').slice(0, 500) });
    await logRun(db, 'error', 0, e.message, startedAt);
    return jsonResponse({ error: e.message, intuit_tid: e.intuitTid || null }, 500, request, env);
  }
}
