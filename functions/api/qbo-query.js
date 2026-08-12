/**
 * ════════════════════════════════════════════════
 * FILE: qbo-query.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets an authorized administrator inspect QuickBooks records without exposing
 *   credentials or changing anything. It accepts only read-only SELECT queries
 *   and returns stable, private-detail-free errors when QuickBooks refuses them.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  CORS, QBO authorization/provider helpers, server Supabase client
 *   Data:      reads  → integration_config, integration_credentials
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Provider Fault text is never returned to the browser; intuit_tid remains
 *     available as the safe support correlation value.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { authorizeQboRequest } from '../lib/qbo-auth.js';
import { getConnection, qboFetch } from '../lib/quickbooks.js';
import { supabase } from '../lib/supabase.js';
import { requireQboProviderTraffic, isQboProviderTrafficDisabled } from '../lib/qbo-provider-traffic.js';
import { qboProviderTrafficDisabledRouteResponse } from './qbo-provider-traffic-response.js';

const MINOR_VERSION = '70';

function queryProviderError({ definitive = false, intuitTid = null } = {}) {
  return {
    error: definitive
      ? 'QuickBooks rejected the read-only query.'
      : 'QuickBooks query is temporarily unavailable.',
    code: definitive ? 'qbo_query_rejected' : 'qbo_query_unavailable',
    intuit_tid: intuitTid,
  };
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const db = supabase(env);
  const auth = await authorizeQboRequest(request, env, db);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }

  const q = (body.query || '').trim();
  if (!q) return jsonResponse({ error: 'Provide a "query"' }, 400, request, env);
  if (!/^select\s/i.test(q)) {
    return jsonResponse({ error: 'Only SELECT (read-only) queries are allowed' }, 400, request, env);
  }
  try { await requireQboProviderTraffic(env); } catch (error) { if (isQboProviderTrafficDisabled(error)) return qboProviderTrafficDisabledRouteResponse(request, env); throw error; }
  const conn = await getConnection(env);
  if (!conn || !conn.refresh_token || !conn.realm_id) {
    return jsonResponse({ error: 'QuickBooks not connected' }, 409, request, env);
  }

  try {
    const res = await qboFetch(env, `/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, {
      method: 'GET',
      // Freeze the company selected at admission. qboFetch verifies this before
      // a refresh or Accounting API request, so a reconnect cannot redirect a
      // read-only browser query into a different company.
      expectedRealmId: String(conn.realm_id),
    });
    const tid = res.headers.get('intuit_tid') || null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return jsonResponse(
        queryProviderError({ definitive: res.status >= 400 && res.status < 500, intuitTid: tid }),
        res.status,
        request,
        env,
      );
    }
    return jsonResponse({ queryResponse: data.QueryResponse || {}, intuit_tid: tid }, 200, request, env);
  } catch (e) {
    if (isQboProviderTrafficDisabled(e)) {
      return qboProviderTrafficDisabledRouteResponse(request, env);
    }
    return jsonResponse(queryProviderError({ intuitTid: e?.intuitTid || null }), 502, request, env);
  }
}
