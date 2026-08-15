/**
 * ════════════════════════════════════════════════
 * FILE: qbo-provider-traffic.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps QuickBooks traffic stopped unless a server-owned switch is explicitly
 *   turned on. This gives operations a reliable pause before work reaches
 *   QuickBooks or changes the saved connection.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  supabase.js, http.js
 *   Data:      reads  → integration_config
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Only the exact value "true" permits traffic; every unavailable or odd
 *     result is deliberately treated as closed.
 *   - Do not cache an allow decision: callers place this guard beside each
 *     provider request and credential write.
 * ════════════════════════════════════════════════
 */

import { fetchWithTimeout } from './http.js';
import { supabase } from './supabase.js';

export const QBO_PROVIDER_TRAFFIC_CONFIG_KEY = 'qbo_provider_traffic_enabled';
export const QBO_PROVIDER_TRAFFIC_DISABLED_CODE = 'qbo_provider_traffic_disabled';
export const QBO_PROVIDER_TRAFFIC_DISABLED_MESSAGE = 'QuickBooks is temporarily unavailable. Please try again shortly.';
export const QBO_PROVIDER_TRAFFIC_LOOKUP_TIMEOUT_MS = 1_500;

function disabledError() {
  const error = new Error(QBO_PROVIDER_TRAFFIC_DISABLED_MESSAGE);
  error.code = QBO_PROVIDER_TRAFFIC_DISABLED_CODE;
  error.reason = QBO_PROVIDER_TRAFFIC_DISABLED_CODE;
  error.status = 503;
  return error;
}

function bounded(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(disabledError()), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timeoutId));
}

function qboProviderTrafficDb(env) {
  // The race below bounds injected test/route clients. The production client also
  // aborts its actual REST request at the same boundary so a timed-out lookup
  // does not keep a service-role request alive behind a denied decision.
  return supabase(env, (url, options) => (
    fetchWithTimeout(url, options, QBO_PROVIDER_TRAFFIC_LOOKUP_TIMEOUT_MS)
  ));
}

export function isQboProviderTrafficDisabled(error) {
  return error?.code === QBO_PROVIDER_TRAFFIC_DISABLED_CODE
    && error?.reason === QBO_PROVIDER_TRAFFIC_DISABLED_CODE
    && error?.status === 503;
}

/**
 * Requires a fresh, bounded exact-value maintenance decision before QBO traffic.
 * `db` is test injection only; production callers use the bounded service-role client.
 */
export async function requireQboProviderTraffic(env, db = qboProviderTrafficDb(env)) {
  try {
    const rows = await bounded(
      db.select(
        'integration_config',
        `key=eq.${QBO_PROVIDER_TRAFFIC_CONFIG_KEY}&select=value&limit=1`,
      ),
      QBO_PROVIDER_TRAFFIC_LOOKUP_TIMEOUT_MS,
    );
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.value !== 'true') throw disabledError();
  } catch (error) {
    if (isQboProviderTrafficDisabled(error)) throw error;
    throw disabledError();
  }
}

export function qboProviderTrafficDisabledResponse() {
  return new Response(JSON.stringify({
    error: QBO_PROVIDER_TRAFFIC_DISABLED_MESSAGE,
    code: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
    reason: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
  }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
