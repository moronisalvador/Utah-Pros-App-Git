// POST /api/qbo-query  — READ-ONLY QuickBooks Online query passthrough.
//
// Lets us inspect QBO data (Items, Classes, Invoices, Customers, reports) using
// the stored connection, without ever exposing tokens. The QBO /query API is
// read-only by nature; we additionally reject anything that isn't a SELECT.
//
// Auth: x-webhook-secret (server-side, e.g. pg_net) or a Supabase Bearer (admin).
// Body: { "query": "SELECT * FROM Class MAXRESULTS 100" }

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { getConnection, qboFetch } from '../lib/quickbooks.js';

const MINOR_VERSION = '70';

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

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!(await isAuthorized(request, env))) {
    return jsonResponse({ error: 'Unauthorized' }, 401, request, env);
  }

  const conn = await getConnection(env);
  if (!conn || !conn.refresh_token) {
    return jsonResponse({ error: 'QuickBooks not connected' }, 409, request, env);
  }

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }

  const q = (body.query || '').trim();
  if (!q) return jsonResponse({ error: 'Provide a "query"' }, 400, request, env);
  if (!/^select\s/i.test(q)) {
    return jsonResponse({ error: 'Only SELECT (read-only) queries are allowed' }, 400, request, env);
  }

  try {
    const res = await qboFetch(env, `/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
    const tid = res.headers.get('intuit_tid') || null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const fault = data?.Fault?.Error?.[0];
      return jsonResponse({
        error: fault ? `${fault.Message}${fault.Detail ? ' — ' + fault.Detail : ''}` : `QBO query ${res.status}`,
        intuit_tid: tid,
      }, res.status, request, env);
    }
    return jsonResponse({ queryResponse: data.QueryResponse || {}, intuit_tid: tid }, 200, request, env);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, request, env);
  }
}
