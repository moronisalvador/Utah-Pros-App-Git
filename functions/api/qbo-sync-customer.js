// POST /api/qbo-sync-customer
// Creates (or links) a QuickBooks Online customer from a UPR contact.
//
// Auth: either the DB trigger's shared secret (x-webhook-secret header matching
// QBO_WEBHOOK_SECRET) or a logged-in Supabase user (Authorization: Bearer …).
//
// Body:
//   { "contact_id": "<uuid>" }                — sync one contact (used by the trigger)
//   { "backfill": true, "limit": N }          — sync up to N pending paying-party contacts
//   { "backfill": true, "dry_run": true }     — preview only: report would-create vs
//                                               would-link, writing nothing

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import {
  getConnection,
  mapContactToCustomer,
  findExistingCustomer,
  createCustomer,
} from '../lib/quickbooks.js';

const QUALIFYING_ROLES = ['homeowner', 'property_manager', 'tenant'];

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

function qualifies(c) {
  return !!(c && QUALIFYING_ROLES.includes(c.role) && c.name && c.name.trim() && !c.qbo_customer_id);
}

// dryRun: report the intended action (create/link) without creating or writing back.
async function syncOne(env, db, contact, { dryRun = false } = {}) {
  if (!qualifies(contact)) return { id: contact.id, name: contact.name, skipped: true };

  const payload = mapContactToCustomer(contact);

  try {
    // Dedup: match an existing customer by email, then by exact display name.
    const match = await findExistingCustomer(env, contact, payload);

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
        customer = await createCustomer(env, payload);
      } catch (e) {
        // 6240 = duplicate name. Disambiguate with the phone's last 4 and retry once.
        if (e.qboCode === '6240' || /duplicate/i.test(e.message || '')) {
          const last4 = (contact.phone || '').replace(/\D/g, '').slice(-4);
          payload.DisplayName = `${payload.DisplayName} (${last4 || String(contact.id).slice(0, 4)})`;
          customer = await createCustomer(env, payload);
        } else {
          throw e;
        }
      }
    }

    await db.update('contacts', `id=eq.${contact.id}`, {
      qbo_customer_id: String(customer.Id),
      qbo_synced_at:   new Date().toISOString(),
      qbo_sync_error:  null,
    });
    return { id: contact.id, name: contact.name, action: linked ? 'linked' : 'created',
             matched_by: match?.matchedBy, qbo_customer_id: customer.Id };
  } catch (e) {
    const tid = e.intuitTid ? ` [intuit_tid: ${e.intuitTid}]` : '';
    if (!dryRun) {
      await db.update('contacts', `id=eq.${contact.id}`, {
        qbo_sync_error: ((e.message || 'sync failed') + tid).slice(0, 500),
      });
    }
    return { id: contact.id, name: contact.name, error: e.message, intuit_tid: e.intuitTid || null };
  }
}

async function logRun(db, status, processed, errorMessage, startedAt) {
  try {
    await db.insert('worker_runs', {
      worker_name:       'qbo-sync-customer',
      status,
      records_processed: processed,
      error_message:     errorMessage || null,
      started_at:        startedAt,
      completed_at:      new Date().toISOString(),
    });
  } catch (_) { /* logging is best-effort */ }
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

  if (!(await isAuthorized(request, env))) {
    return jsonResponse({ error: 'Unauthorized' }, 401, request, env);
  }

  const db = supabase(env);
  const conn = await getConnection(env);
  if (!conn || !conn.refresh_token) {
    return jsonResponse({ error: 'QuickBooks not connected' }, 409, request, env);
  }

  let body = {};
  try { body = await request.json(); } catch (_) { /* empty body */ }

  const dryRun = !!body.dry_run;

  try {
    const results = [];

    if (body.backfill) {
      const limit = Math.min(Number(body.limit) || 50, 100);
      const rows = await loadPending(db, limit);
      for (const c of (rows || [])) {
        results.push(await syncOne(env, db, c, { dryRun }));
      }
    } else if (body.contact_id) {
      const rows = await db.select('contacts', `id=eq.${body.contact_id}&limit=1`);
      if (!rows || !rows[0]) return jsonResponse({ error: 'Contact not found' }, 404, request, env);
      results.push(await syncOne(env, db, rows[0], { dryRun }));
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
