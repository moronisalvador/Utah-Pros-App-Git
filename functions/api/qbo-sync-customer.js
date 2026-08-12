/**
 * ════════════════════════════════════════════════
 * FILE: qbo-sync-customer.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Links a UPR contact to the right QuickBooks customer or creates one when no
 *   safe match exists. It can process one contact, preview a batch, or backfill
 *   a bounded batch without exposing provider fault text to the caller.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  CORS, QBO auth/provider helpers, timeout, Supabase, worker telemetry
 *   Data:      reads  → contacts, integration_config, integration_credentials
 *              writes → contacts, worker_runs
 *
 * NOTES / GOTCHAS:
 *   - Customer creates use stable request identities and are pinned to the
 *     expected QBO company. Ambiguous identity matches require manual linking.
 *   - Contact sync evidence and browser responses retain only a stable error
 *     category plus intuit_tid; raw provider fault text is never persisted there.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { fetchWithTimeout } from '../lib/http.js';
import { authorizeQboRequest, QBO_ADMIN_ROLES } from '../lib/qbo-auth.js';
import { requireQboProviderTraffic, isQboProviderTrafficDisabled } from '../lib/qbo-provider-traffic.js';
import { qboProviderTrafficDisabledRouteResponse } from './qbo-provider-traffic-response.js';
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
const isConnectionBoundary = (error) => ['qbo-realm-mismatch', 'qbo-connection-changed'].includes(error?.code);
const isRealmMismatch = (error) => error?.code === 'qbo-realm-mismatch';

function stableIntuitTid(value) {
  const tid = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9._-]{1,128}$/.test(tid) ? tid : null;
}

function stableCustomerSyncError(error) {
  if (isQboProviderTrafficDisabled(error)) return 'qbo_provider_traffic_disabled';
  const faultCode = String(error?.faultCode ?? error?.qboCode ?? '').trim();
  const safeFaultCode = /^\d{1,10}$/.test(faultCode) ? faultCode : null;
  const status = Number(error?.status);
  const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  const base = safeFaultCode
    ? `qbo_customer_fault_${safeFaultCode}`
    : safeStatus
      ? `qbo_customer_http_${safeStatus}`
      : error?.retryable === true
        ? 'qbo_customer_retryable_failure'
        : 'qbo_customer_failure';
  const tid = stableIntuitTid(error?.intuitTid);
  return tid ? `${base} [intuit_tid:${tid}]` : base;
}

function qualifies(c) {
  return !!(c && QUALIFYING_ROLES.includes(c.role) && c.name && c.name.trim() && !c.qbo_customer_id);
}

function publicCustomerSyncFailure(error) {
  const definitive = Number(error?.status) >= 400 && Number(error?.status) < 500;
  // A realm mismatch means the user must re-establish which company owns the
  // customer. Never invite an unchanged retry that can recapture a replacement
  // realm. A same-realm token CAS race may retain the stable request identity.
  if (isRealmMismatch(error)) {
    return {
      error: 'QuickBooks company changed during customer sync. Reload and review the customer before starting a new sync.',
      code: error.code,
      intuit_tid: stableIntuitTid(error?.intuitTid),
      retry_same_request: false,
    };
  }
  if (isConnectionBoundary(error)) {
    return {
      error: 'QuickBooks connection changed during customer sync. Retry the same request.',
      code: error.code,
      intuit_tid: stableIntuitTid(error?.intuitTid),
      retry_same_request: true,
    };
  }
  return {
    error: definitive
      ? 'QuickBooks rejected the customer sync.'
      : 'QuickBooks customer sync could not be completed. Retry the same request.',
    code: definitive ? 'qbo_customer_sync_rejected' : 'qbo_customer_sync_failed',
    intuit_tid: stableIntuitTid(error?.intuitTid),
    retry_same_request: !definitive,
  };
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

export async function syncOne(env, db, contact, { dryRun = false, realmId, expectedRealmId = realmId } = {}) {
  if (!qualifies(contact)) return { id: contact.id, name: contact.name, skipped: true };

  const payload = mapContactToCustomer(contact);

  try {
    // Dedup only on verified identity: exact email or family-name + exact phone.
    // DisplayName alone is never enough to attach a money path to a customer.
    const match = await findExistingCustomer(env, contact, payload, { expectedRealmId });

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
          expectedRealmId,
        });
      } catch (e) {
        // 6240 = duplicate name. Disambiguate with the phone's last 4 and retry once.
        if (e.qboCode === '6240' || /duplicate/i.test(e.message || '')) {
          customer = await createCustomer(env, disambiguatedCustomerPayload(contact, payload), {
            requestId: await customerCreateRequestId(realmId, contact.id, 'disambiguated'),
            expectedRealmId,
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
    // qbo-provider-traffic rechecks at the last possible point before a
    // provider fetch. It is a maintenance refusal, not a failed customer
    // sync, and must reach the route without writing qbo_sync_error.
    if (isQboProviderTrafficDisabled(e)) throw e;
    const failure = publicCustomerSyncFailure(e);
    const tid = failure.intuit_tid ? ` [intuit_tid: ${failure.intuit_tid}]` : '';
    if (!dryRun) {
      const storedCustomerId = await writeContactQboSyncError(db, contact.id, failure.error + tid);
      if (storedCustomerId) {
        return { id: contact.id, name: contact.name, action: 'linked', matched_by: 'concurrent', qbo_customer_id: storedCustomerId };
      }
    }
    return { id: contact.id, name: contact.name, ...failure };
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
  const db = supabase(env, fetchWithTimeout);

  const auth = await authorizeQboRequest(request, env, db, undefined, QBO_ADMIN_ROLES);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);

  let body = {};
  try { body = await request.json(); } catch { /* empty body */ }

  try { await requireQboProviderTraffic(env); } catch (error) { if (isQboProviderTrafficDisabled(error)) return qboProviderTrafficDisabledRouteResponse(request, env); throw error; }
  const conn = await getConnection(env);
  if (!conn || !conn.refresh_token) {
    return jsonResponse({ error: 'QuickBooks not connected' }, 409, request, env);
  }

  let expectedRealmId = conn.realm_id == null ? '' : String(conn.realm_id);
  if (body.expected_realm_id != null) {
    if (typeof body.expected_realm_id !== 'string' || !body.expected_realm_id.trim()) {
      return jsonResponse({ error: 'expected_realm_id must be nonblank text' }, 400, request, env);
    }
    expectedRealmId = body.expected_realm_id.trim();
  }
  if (!expectedRealmId || String(conn.realm_id) !== expectedRealmId) {
    return jsonResponse({
      error: 'QuickBooks company changed before customer sync. Reload and review the customer before starting a new sync.',
      code: 'qbo-realm-mismatch',
      retry_same_request: false,
    }, 409, request, env);
  }

  const dryRun = !!body.dry_run;

  try {
    const results = [];

    if (body.backfill) {
      const limit = Math.min(Number(body.limit) || 50, 100);
      const rows = await loadPending(db, limit);
      for (const c of (rows || [])) {
        results.push(await syncOne(env, db, c, {
          dryRun, realmId: expectedRealmId, expectedRealmId,
        }));
      }
    } else if (body.contact_id) {
      // Reject non-UUID ids before they reach a PostgREST filter string.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body.contact_id))) {
        return jsonResponse({ error: 'contact_id must be a UUID' }, 400, request, env);
      }
      const rows = await db.select('contacts', `id=eq.${body.contact_id}&limit=1`);
      if (!rows || !rows[0]) return jsonResponse({ error: 'Contact not found' }, 404, request, env);
      results.push(await syncOne(env, db, rows[0], {
        dryRun, realmId: expectedRealmId, expectedRealmId,
      }));
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
    if (!dryRun) await logRun(db, 'error', 0, stableCustomerSyncError(e), startedAt);
    if (isQboProviderTrafficDisabled(e)) {
      return qboProviderTrafficDisabledRouteResponse(request, env);
    }
    return jsonResponse({
      error: 'QuickBooks customer sync could not be completed.',
      code: 'qbo_customer_sync_failed',
      intuit_tid: stableIntuitTid(e?.intuitTid),
    }, 500, request, env);
  }
}
