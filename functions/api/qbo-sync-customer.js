// POST /api/qbo-sync-customer
// Creates (or links) a QuickBooks Online customer from a UPR contact.
//
// Auth: either the existing server capability (x-webhook-secret header matching
// QBO_WEBHOOK_SECRET) or an active internal admin Supabase session.
//
// Body:
//   { "contact_id": "<uuid>" }                — sync one contact (used on demand by billing workers)
//   { "backfill": true, "limit": N }          — sync up to N pending paying-party contacts
//   { "backfill": true, "dry_run": true }     — preview only: report would-create vs
//                                               would-link, writing nothing

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { authorizeQboRequest, QBO_ADMIN_ROLES } from '../lib/qbo-auth.js';
import { supabase } from '../lib/supabase.js';
import { recordWorkerRun } from '../lib/worker-runs.js';
import {
  getConnection,
  mapContactToCustomer,
  findExistingCustomer,
  disambiguatedCustomerPayload,
  createCustomer,
  customerCreateRequestId,
} from '../lib/quickbooks.js';

const QUALIFYING_ROLES = ['homeowner', 'property_manager', 'tenant'];

function qualifies(c) {
  return !!(c && QUALIFYING_ROLES.includes(c.role) && c.name && c.name.trim() && !c.qbo_customer_id);
}

// dryRun: report the intended action (create/link) without creating or writing back.
async function currentContactQboCustomerId(db, contactId) {
  const current = (await db.select(
    'contacts',
    `id=eq.${contactId}&select=id,qbo_customer_id&limit=1`,
  ))?.[0];
  return current?.qbo_customer_id ? String(current.qbo_customer_id) : null;
}

async function writeContactQboCustomerId(db, contactId, customerId) {
  const rows = await db.update('contacts', `id=eq.${contactId}&qbo_customer_id=is.null`, {
    qbo_customer_id: String(customerId),
    qbo_synced_at: new Date().toISOString(),
    qbo_sync_error: null,
  });
  if (rows?.[0]?.qbo_customer_id) return String(rows[0].qbo_customer_id);
  return currentContactQboCustomerId(db, contactId);
}

async function writeContactQboSyncError(db, contactId, message) {
  const rows = await db.update('contacts', `id=eq.${contactId}&qbo_customer_id=is.null`, {
    qbo_sync_error: message.slice(0, 500),
  });
  if (rows?.[0]) return null;
  return currentContactQboCustomerId(db, contactId);
}

export async function syncOne(env, db, contact, { dryRun = false, realmId } = {}) {
  if (!qualifies(contact)) return { id: contact.id, name: contact.name, skipped: true };

  const payload = mapContactToCustomer(contact);

  try {
    // Dedup only on verified identity: exact email or family-name + exact phone.
    // DisplayName alone is never enough to attach a money path to a customer.
    const match = await findExistingCustomer(env, contact, payload);

    // Distinct QBO customers both look right — never guess on a money path, and
    // never create a third. Surface it for a human to link manually.
    if (match?.ambiguous) {
      const list = match.candidates.map((c) => `${c.DisplayName} (#${c.Id})`).join(', ');
      const err = `Multiple QuickBooks customers could match: ${list} — link manually.`;
      if (!dryRun) {
        const storedCustomerId = await writeContactQboSyncError(db, contact.id, err);
        if (storedCustomerId) {
          return { id: contact.id, name: contact.name, action: 'linked', matched_by: 'concurrent', qbo_customer_id: storedCustomerId };
        }
      }
      return { id: contact.id, name: contact.name, error: err };
    }

    if (dryRun) {
      return match
        ? { id: contact.id, name: contact.name, action: 'link', matched_by: match.matchedBy,
            qbo_customer_id: match.customer.Id, qbo_display_name: match.customer.DisplayName }
        : { id: contact.id, name: contact.name, action: 'create', qbo_display_name: payload.DisplayName };
    }

    let customer = match?.customer;
    const linked = !!customer;

    if (!customer) {
      try {
        customer = await createCustomer(env, payload, {
          requestId: await customerCreateRequestId(realmId, contact.id, 'primary'),
        });
      } catch (e) {
        // 6240 = duplicate name. Disambiguate with the phone's last 4 and retry once.
        if (e.qboCode === '6240' || /duplicate/i.test(e.message || '')) {
          customer = await createCustomer(env, disambiguatedCustomerPayload(contact, payload), {
            requestId: await customerCreateRequestId(realmId, contact.id, 'disambiguated'),
          });
        } else {
          throw e;
        }
      }
    }

    const storedCustomerId = await writeContactQboCustomerId(db, contact.id, customer.Id);
    if (!storedCustomerId) throw new Error('QuickBooks customer sync lost its contact mapping');
    const converged = storedCustomerId !== String(customer.Id);
    return { id: contact.id, name: contact.name, action: linked || converged ? 'linked' : 'created',
             matched_by: converged ? 'concurrent' : match?.matchedBy, qbo_customer_id: storedCustomerId };
  } catch (e) {
    const tid = e.intuitTid ? ` [intuit_tid: ${e.intuitTid}]` : '';
    if (!dryRun) {
      const storedCustomerId = await writeContactQboSyncError(db, contact.id, (e.message || 'sync failed') + tid);
      if (storedCustomerId) {
        return { id: contact.id, name: contact.name, action: 'linked', matched_by: 'concurrent', qbo_customer_id: storedCustomerId };
      }
    }
    return { id: contact.id, name: contact.name, error: e.message, intuit_tid: e.intuitTid || null };
  }
}

async function logRun(db, status, processed, errorMessage, startedAt) {
  await recordWorkerRun(db, {
    workerName: 'qbo-sync-customer', status, recordsProcessed: processed,
    errorMessage, startedAt,
  });
}

function loadPending(db, limit) {
  return db.select(
    'contacts',
    `qbo_customer_id=is.null&role=in.(${QUALIFYING_ROLES.join(',')})&name=not.is.null` +
      `&order=created_at.desc&limit=${limit}`,
  );
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const startedAt = new Date().toISOString();
  const db = supabase(env);

  const auth = await authorizeQboRequest(request, env, db, undefined, QBO_ADMIN_ROLES);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);

  const conn = await getConnection(env);
  if (!conn || !conn.refresh_token) {
    return jsonResponse({ error: 'QuickBooks not connected' }, 409, request, env);
  }

  let body = {};
  try { body = await request.json(); } catch { /* empty body */ }

  const dryRun = !!body.dry_run;

  try {
    const results = [];

    if (body.backfill) {
      const limit = Math.min(Number(body.limit) || 50, 100);
      const rows = await loadPending(db, limit);
      for (const c of (rows || [])) {
        results.push(await syncOne(env, db, c, { dryRun, realmId: conn.realm_id }));
      }
    } else if (body.contact_id) {
      // Reject non-UUID ids before they reach a PostgREST filter string.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body.contact_id))) {
        return jsonResponse({ error: 'contact_id must be a UUID' }, 400, request, env);
      }
      const rows = await db.select('contacts', `id=eq.${body.contact_id}&limit=1`);
      if (!rows || !rows[0]) return jsonResponse({ error: 'Contact not found' }, 404, request, env);
      results.push(await syncOne(env, db, rows[0], { dryRun, realmId: conn.realm_id }));
    } else {
      return jsonResponse({ error: 'Provide contact_id or backfill:true' }, 400, request, env);
    }

    if (dryRun) {
      const would_create = results.filter(r => r.action === 'create').length;
      const would_link   = results.filter(r => r.action === 'link').length;
      const skipped      = results.filter(r => r.skipped).length;
      return jsonResponse({ dry_run: true, would_create, would_link, skipped, results }, 200, request, env);
    }

    const created = results.filter(r => r.action === 'created').length;
    const linked  = results.filter(r => r.action === 'linked').length;
    const errored = results.filter(r => r.error).length;
    const skipped = results.filter(r => r.skipped).length;
    const synced  = created + linked;

    await logRun(db, errored ? 'error' : 'completed', synced, errored ? `${errored} failed` : null, startedAt);
    return jsonResponse({ synced, created, linked, errored, skipped, results }, 200, request, env);
  } catch (e) {
    if (!dryRun) await logRun(db, 'error', 0, e.message, startedAt);
    return jsonResponse({ error: e.message }, 500, request, env);
  }
}
