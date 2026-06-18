// POST /api/qbo-sync-customer
// Creates a QuickBooks Online customer from a UPR contact.
//
// Auth: either the DB trigger's shared secret (x-webhook-secret header matching
// QBO_WEBHOOK_SECRET) or a logged-in Supabase user (Authorization: Bearer …).
//
// Body:
//   { "contact_id": "<uuid>" }      — sync one contact (used by the trigger)
//   { "backfill": true, "limit": N } — sync up to N pending paying-party contacts

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import {
  getConnection,
  mapContactToCustomer,
  findCustomerByDisplayName,
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

async function syncOne(env, db, contact) {
  if (!qualifies(contact)) return { id: contact.id, skipped: true };

  try {
    const payload = mapContactToCustomer(contact);

    // Dedup: reuse an existing QuickBooks customer with the same display name.
    let customer = await findCustomerByDisplayName(env, payload.DisplayName);
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
    return { id: contact.id, qbo_customer_id: customer.Id, name: contact.name };
  } catch (e) {
    await db.update('contacts', `id=eq.${contact.id}`, {
      qbo_sync_error: (e.message || 'sync failed').slice(0, 500),
    });
    return { id: contact.id, error: e.message };
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

  try {
    const results = [];

    if (body.backfill) {
      const limit = Math.min(Number(body.limit) || 50, 200);
      const rows = await db.select(
        'contacts',
        `qbo_customer_id=is.null&role=in.(${QUALIFYING_ROLES.join(',')})&name=not.is.null` +
          `&order=created_at.desc&limit=${limit}`,
      );
      for (const c of (rows || [])) {
        results.push(await syncOne(env, db, c));
      }
    } else if (body.contact_id) {
      const rows = await db.select('contacts', `id=eq.${body.contact_id}&limit=1`);
      if (!rows || !rows[0]) return jsonResponse({ error: 'Contact not found' }, 404, request, env);
      results.push(await syncOne(env, db, rows[0]));
    } else {
      return jsonResponse({ error: 'Provide contact_id or backfill:true' }, 400, request, env);
    }

    const synced  = results.filter(r => r.qbo_customer_id).length;
    const errored = results.filter(r => r.error).length;
    const skipped = results.filter(r => r.skipped).length;

    await logRun(db, errored ? 'error' : 'completed', synced, errored ? `${errored} failed` : null, startedAt);
    return jsonResponse({ synced, errored, skipped, results }, 200, request, env);
  } catch (e) {
    await logRun(db, 'error', 0, e.message, startedAt);
    return jsonResponse({ error: e.message }, 500, request, env);
  }
}
