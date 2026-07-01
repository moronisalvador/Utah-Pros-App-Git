// POST /api/qbo-estimate — push a UPR estimate to QuickBooks Online.
//
// Mirrors qbo-invoice.js (one-way UPR → QBO). Auth: x-webhook-secret (server-side)
// or a Supabase Bearer (admin).
// Body:
//   { "estimate_id": "<uuid>" }                       — create OR update the QBO estimate
//   { "estimate_id": "<uuid>", "action": "delete" }   — delete it from QBO (revert to draft)
//   { "estimate_id": "<uuid>", "action": "send",      — ask QBO to EMAIL the estimate to the
//     "send_to": "name@x.com" (optional) }              customer (defaults to the contact's email)
//
// Builds itemized QBO lines from the estimate's line items (each carries its own QBO
// Item + Class), customer = the contact's qbo_customer_id, claim/job ref in the memo.
// If the estimate already has a qbo_estimate_id it is UPDATED in place (sparse).

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { getConnection, divisionToQbo, findClassId, createEstimate, updateEstimate, deleteEstimate, sendEstimate, ensureQboCustomer } from '../lib/quickbooks.js';

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
      worker_name: 'qbo-estimate', status, records_processed: processed,
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
  const estimateId = body.estimate_id;
  if (!estimateId) return jsonResponse({ error: 'Provide estimate_id' }, 400, request, env);

  const est = (await db.select('estimates', `id=eq.${estimateId}&limit=1`))?.[0];
  if (!est) return jsonResponse({ error: 'Estimate not found' }, 404, request, env);

  // ── Cleanup path: delete from QBO ──
  if (body.action === 'delete') {
    if (!est.qbo_estimate_id) return jsonResponse({ error: 'No qbo_estimate_id to delete' }, 400, request, env);
    try {
      await deleteEstimate(env, est.qbo_estimate_id);
      await db.update('estimates', `id=eq.${estimateId}`, { qbo_estimate_id: null, qbo_synced_at: null, qbo_sync_error: null });
      return jsonResponse({ deleted: est.qbo_estimate_id }, 200, request, env);
    } catch (e) {
      return jsonResponse({ error: e.message }, 500, request, env);
    }
  }

  // Estimates are contact-owned and pre-sale: a job is OPTIONAL (only present once the
  // estimate has been converted). Division + address come from the estimate itself.
  const job = est.job_id
    ? (await db.select('jobs', `id=eq.${est.job_id}&select=division,job_number,claim_id,address,city,state,zip,date_of_loss,primary_contact_id&limit=1`))?.[0] || null
    : null;
  const contactId = est.contact_id || job?.primary_contact_id;

  // ── Send path: ask QBO to email the estimate to the customer ──
  if (body.action === 'send') {
    if (!est.qbo_estimate_id) return jsonResponse({ error: 'Estimate has not been sent to QuickBooks yet — save it first, then email.' }, 400, request, env);

    let sendTo = (body.send_to || '').trim() || null;
    if (!sendTo && contactId) {
      const c = (await db.select('contacts', `id=eq.${contactId}&select=email&limit=1`))?.[0];
      sendTo = (c?.email || '').trim() || null;
    }
    if (!sendTo) return jsonResponse({ error: 'No email address on file for this customer — add one to the contact (or pass send_to) before emailing.' }, 400, request, env);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sendTo)) return jsonResponse({ error: `Customer email looks invalid: ${sendTo}` }, 400, request, env);

    try {
      const qboEst = await sendEstimate(env, est.qbo_estimate_id, sendTo);
      const nowIso = new Date().toISOString();
      await db.update('estimates', `id=eq.${estimateId}`, {
        qbo_emailed_at:   nowIso,
        qbo_email_status: qboEst?.EmailStatus || 'EmailSent',
        sent_to_email:    sendTo,
        qbo_sync_error:   null,
      });
      await logRun(db, 'completed', 1, null, startedAt);
      return jsonResponse({ ok: true, emailed_to: sendTo, email_status: qboEst?.EmailStatus || 'EmailSent' }, 200, request, env);
    } catch (e) {
      await logRun(db, 'error', 0, e.message, startedAt);
      return jsonResponse({ error: e.message, intuit_tid: e.intuitTid || null }, 500, request, env);
    }
  }

  try {
    let contact = contactId
      ? (await db.select('contacts', `id=eq.${contactId}&select=qbo_customer_id,name&limit=1`))?.[0]
      : null;
    // On-demand: create the QBO customer now (when actually estimated) if it
    // doesn't exist yet — the contact-insert auto-sync trigger is being retired.
    if (contactId && !contact?.qbo_customer_id) {
      await ensureQboCustomer(request, env, contactId);
      contact = (await db.select('contacts', `id=eq.${contactId}&select=qbo_customer_id,name&limit=1`))?.[0];
    }
    if (!contact?.qbo_customer_id) throw new Error('Estimate contact has no QuickBooks customer — sync the client first');

    // Division comes from the estimate's intended type (pre-sale); fall back to a linked
    // job's division once the estimate has been converted.
    const divisionVal = est.intended_division || job?.division || null;
    const map = divisionToQbo(divisionVal);
    if (!map) throw new Error(`No QuickBooks mapping for division "${divisionVal || ''}"`);

    const claim = job?.claim_id
      ? (await db.select('claims', `id=eq.${job.claim_id}&select=claim_number,date_of_loss,loss_address,loss_city,loss_state,loss_zip&limit=1`))?.[0] || null
      : null;
    const claimNo = est.claim_number || claim?.claim_number || null;

    const divClassId = map.className ? await findClassId(env, map.className) : null;

    // Build QBO lines from the estimate's line items (itemized — each line carries its
    // own QBO Item + Class). Fall back to a single division-summary line if none yet.
    const items = await db.select('estimate_line_items', `estimate_id=eq.${estimateId}&order=sort_order.asc.nullslast,created_at.asc`) || [];
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
      const amount = Number(est.amount ?? 0);
      const detail = { ItemRef: { value: map.itemId } };
      if (divClassId) detail.ClassRef = { value: divClassId };
      lines = [{ DetailType: 'SalesItemLineDetail', Amount: amount, SalesItemLineDetail: detail }];
    }
    const lineTotal = lines.reduce((s, l) => s + Number(l.Amount || 0), 0);
    if (!(lineTotal > 0)) throw new Error('Estimate total is 0 — add a line item with an amount before saving');

    // Service address: the estimate's own property address (pre-sale), then a linked job,
    // then the claim's loss address. Date of loss only exists once there's a job/claim.
    const fmtDol = (d) => { if (!d) return ''; const p = String(d).split('T')[0].split('-'); return p.length === 3 ? `${+p[1]}/${+p[2]}/${p[0]}` : String(d); };
    const dol = fmtDol(job?.date_of_loss || claim?.date_of_loss);
    const addr1     = est.property_address || job?.address || claim?.loss_address || null;
    const addrCity  = est.property_city    || job?.city    || claim?.loss_city    || null;
    const addrState = est.property_state   || job?.state   || claim?.loss_state   || null;
    const addrZip   = est.property_zip     || job?.zip     || claim?.loss_zip      || null;
    const serviceAddr = [addr1, addrCity, addrState, addrZip].filter(Boolean).join(', ');
    const memo = [
      dol ? `Date of loss: ${dol}` : null,
      job?.job_number ? `Job: ${job.job_number}` : null,
      claimNo ? `Claim: ${claimNo}` : null,
      serviceAddr ? `Service Address: ${serviceAddr}` : null,
    ].filter(Boolean).join(' · ') || `Estimate ${est.estimate_number || ''}`.trim();
    const shipAddr = Object.fromEntries(Object.entries({
      Line1: addr1, City: addrCity, CountrySubDivisionCode: addrState, PostalCode: addrZip,
    }).filter(([, v]) => v));
    const hasShip = Object.keys(shipAddr).length > 0;

    // Use the UPR estimate number as the QBO DocNumber (unique — a job can have many
    // estimates, so job_number alone wouldn't be unique). Requires "Custom transaction
    // numbers" ON in QBO to take effect; if OFF, QBO ignores it and auto-numbers.
    const docNumber = est.estimate_number ? String(est.estimate_number).slice(0, 21) : null;
    // Expiration date (optional) → QBO ExpirationDate (YYYY-MM-DD).
    const expDate = est.expiration_date ? String(est.expiration_date).slice(0, 10) : null;

    // Update in place if already synced, else create.
    let qboEst, mode;
    if (est.qbo_estimate_id) {
      qboEst = await updateEstimate(env, est.qbo_estimate_id, { Line: lines, PrivateNote: memo, CustomerMemo: { value: memo }, ...(docNumber ? { DocNumber: docNumber } : {}), ...(expDate ? { ExpirationDate: expDate } : {}), ...(hasShip ? { ShipAddr: shipAddr } : {}) });
      mode = 'updated';
    } else {
      const payload = {
        CustomerRef: { value: String(contact.qbo_customer_id) },
        Line: lines,
        TxnStatus: 'Pending',
        PrivateNote: memo,
        CustomerMemo: { value: memo },
        ...(docNumber ? { DocNumber: docNumber } : {}),
        ...(expDate ? { ExpirationDate: expDate } : {}),
        ...(hasShip ? { ShipAddr: shipAddr } : {}),
      };
      qboEst = await createEstimate(env, payload);
      mode = 'created';
    }

    const nowIso = new Date().toISOString();
    const patch = { qbo_estimate_id: String(qboEst.Id), qbo_synced_at: nowIso, qbo_sync_error: null, qbo_doc_number: qboEst.DocNumber != null ? String(qboEst.DocNumber) : null };
    if (mode === 'created') {
      // First time it reaches QBO: advance draft → submitted (drives the "Sent" status).
      if (est.status === 'draft') { patch.status = 'submitted'; if (!est.submitted_at) patch.submitted_at = nowIso; }
    }
    await db.update('estimates', `id=eq.${estimateId}`, patch);
    await logRun(db, 'completed', 1, null, startedAt);
    return jsonResponse({ ok: true, mode, qbo_estimate_id: qboEst.Id, doc_number: qboEst.DocNumber, total: qboEst.TotalAmt }, 200, request, env);
  } catch (e) {
    await db.update('estimates', `id=eq.${estimateId}`, { qbo_sync_error: (e.message || 'push failed').slice(0, 500) });
    await logRun(db, 'error', 0, e.message, startedAt);
    return jsonResponse({ error: e.message, intuit_tid: e.intuitTid || null }, 500, request, env);
  }
}
