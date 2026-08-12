/**
 * ════════════════════════════════════════════════
 * FILE: quickbooks-callback.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Finishes QuickBooks sign-in, refuses a different connected company,
 *   stores the OAuth connection, and returns the browser to Integrations.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  QuickBooks OAuth helpers, server Supabase client
 *   Data:      reads  → integration_config, integration_credentials, employees,
 *                       contacts, invoices, estimates, payments/receipts,
 *                       qbo_invoice_commands, qbo_attachments, document line items
 *              writes → integration_credentials, integration_config
 *
 * NOTES / GOTCHAS:
 *   - Same-company reconnects are allowed. A different company is refused
 *     before token exchange because persisted QBO IDs are connection-scoped.
 *   - This is a top-level OAuth navigation and always returns a 302 redirect.
 * ════════════════════════════════════════════════
 */

import {
  exchangeCodeForTokens,
  saveTokens,
  fetchCompanyName,
  qboEnvironment,
} from '../lib/quickbooks.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';
import { requireQboProviderTraffic, isQboProviderTrafficDisabled } from '../lib/qbo-provider-traffic.js';
import { qboProviderTrafficDisabledRouteResponse } from './qbo-provider-traffic-response.js';

// The page that consumes the ?qbo= return param (Settings → Integrations,
// Session B / P2 — retargeted from the retired /dev-tools tab). Exported so the
// round-trip contract is test-covered alongside the page's ?qbo= handler.
export const QBO_RETURN_PATH = '/settings/integrations';
const QBO_LINK_PROBES = Object.freeze([
  ['contacts', 'qbo_customer_id=not.is.null&select=id&limit=1'],
  ['invoices', 'qbo_invoice_id=not.is.null&select=id&limit=1'],
  ['estimates', 'qbo_estimate_id=not.is.null&select=id&limit=1'],
  ['payments', 'or=(qbo_payment_id.not.is.null,stripe_fee_qbo_purchase_id.not.is.null)&select=id&limit=1'],
  ['qbo_attachments', 'qbo_attachable_id=not.is.null&select=id&limit=1'],
  ['invoice_line_items', 'or=(qbo_item_id.not.is.null,qbo_class_id.not.is.null)&select=id&limit=1'],
  ['estimate_line_items', 'or=(qbo_item_id.not.is.null,qbo_class_id.not.is.null)&select=id&limit=1'],
  ['integration_config', 'key=in.(qbo_stripe_clearing_account_id,qbo_fee_expense_account_id,qbo_bank_account_id)&value=not.is.null&select=key&limit=1'],
  ['payments', 'qbo_realm_id=not.is.null&select=id&limit=1'],
  ['payment_receipts', 'qbo_realm_id=not.is.null&select=id&limit=1'],
  ['payment_receipt_attempts', 'qbo_realm_id=not.is.null&select=id&limit=1'],
  ['qbo_invoice_commands', 'realm_id=not.is.null&select=id&limit=1'],
]);
const QBO_CALLBACK_FAILED_MESSAGE = 'QuickBooks connection could not be completed. Start a new connection attempt.';
const QBO_CALLBACK_MAINTENANCE_MESSAGE = 'QuickBooks maintenance interrupted the connection. Reconnect after maintenance.';

export function appBaseFrom(env) {
  if (env.APP_BASE_URL) return env.APP_BASE_URL;
  try { return new URL(env.QBO_REDIRECT_URI).origin; } catch { return 'https://dev.utahpros.app'; }
}

// Build the browser-facing redirect URL after the OAuth round-trip. Pure +
// exported so the retarget (/settings/integrations?qbo=…) is asserted in a test.
export function buildReturnLocation(base, status, msg) {
  const qs = new URLSearchParams({ qbo: status });
  if (msg) qs.set('msg', msg.slice(0, 200));
  return `${base}${QBO_RETURN_PATH}?${qs.toString()}`;
}

function redirect(env, status, msg) {
  const location = buildReturnLocation(appBaseFrom(env), status, msg);
  return new Response(null, { status: 302, headers: { Location: location } });
}

async function existingQboRealm(db) {
  const rows = await db.select(
    'integration_credentials',
    'provider=eq.quickbooks&select=realm_id&limit=1',
  );
  const value = rows?.[0]?.realm_id;
  return value == null || !String(value).trim() ? null : String(value).trim();
}

async function hasUnscopedQboLinks(db) {
  for (const [table, query] of QBO_LINK_PROBES) {
    if ((await db.select(table, query))?.length) return true;
  }
  return false;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const u = new URL(request.url);

  if (u.searchParams.get('error')) {
    return redirect(env, 'error', QBO_CALLBACK_FAILED_MESSAGE);
  }

  const code    = u.searchParams.get('code');
  const state   = u.searchParams.get('state');
  const realmId = u.searchParams.get('realmId');
  if (!code || !realmId) return redirect(env, 'error', 'Missing code or realmId');

  const db = supabase(env, fetchWithTimeout);
  try {
    // Verify state (CSRF).
    const cfg = await db.select('integration_config', `key=eq.qbo_oauth_state&limit=1`);
    const expected = cfg?.[0]?.value;
    if (!expected || expected !== state) return redirect(env, 'badstate');
    try { await requireQboProviderTraffic(env); } catch (error) {
      if (isQboProviderTrafficDisabled(error)) return qboProviderTrafficDisabledRouteResponse(request, env);
      throw error;
    }

    const environment = qboEnvironment(env);

    // External IDs are company-scoped. Before the durable binding migration,
    // the current credential realm is the only attributable company identity.
    const currentRealm = await existingQboRealm(db);
    if (currentRealm && currentRealm !== String(realmId)) {
      return redirect(env, 'error', 'QuickBooks is already connected to a different company. Reconcile existing QBO links before switching companies.');
    }
    if (!currentRealm && await hasUnscopedQboLinks(db)) {
      return redirect(env, 'error', 'Existing QuickBooks links have no company attribution. Reconcile them before reconnecting.');
    }

    // Resolve the connecting employee (best-effort) from the stashed auth user id.
    let connectedBy = null;
    const userRows = await db.select('integration_config', `key=eq.qbo_oauth_user&limit=1`);
    const authUid = userRows?.[0]?.value;
    if (authUid) {
      const emp = await db.select('employees', `auth_user_id=eq.${authUid}&select=id&limit=1`);
      connectedBy = emp?.[0]?.id || null;
    }

    const tokens = await exchangeCodeForTokens(env, code);
    // The authorization code has now been consumed. If maintenance begins
    // before credentials are written, do not expose a 503 that invites the
    // browser to replay a one-time code; send the user through a fresh connect
    // round-trip instead, without making a credential write.
    try {
      await requireQboProviderTraffic(env);
    } catch (error) {
      if (isQboProviderTrafficDisabled(error)) {
        return redirect(env, 'error', 'QuickBooks maintenance started before the connection could be saved. Please reconnect after maintenance.');
      }
      throw error;
    }
    await saveTokens(env, tokens, {
      realm_id:     realmId,
      environment,
      connected_at: new Date().toISOString(),
      connected_by: connectedBy,
    });

    const companyName = await fetchCompanyName(env, { expectedRealmId: realmId });
    if (companyName) {
      // The name is provider-derived data. Recheck immediately before storing
      // it because maintenance can begin while the provider read is in flight.
      try {
        await requireQboProviderTraffic(env);
        await db.update('integration_credentials', `provider=eq.quickbooks`, { company_name: companyName });
      } catch (error) {
        if (!isQboProviderTrafficDisabled(error)) throw error;
      }
    }

    // Clear transient state.
    await db.delete('integration_config', `key=eq.qbo_oauth_state`);
    await db.delete('integration_config', `key=eq.qbo_oauth_user`);

    return redirect(env, 'connected');
  } catch (e) {
    if (isQboProviderTrafficDisabled(e)) {
      return redirect(env, 'error', QBO_CALLBACK_MAINTENANCE_MESSAGE);
    }
    return redirect(env, 'error', QBO_CALLBACK_FAILED_MESSAGE);
  }
}
