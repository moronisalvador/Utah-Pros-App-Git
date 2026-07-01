/**
 * ════════════════════════════════════════════════
 * FILE: callrail-api.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The one place that figures out WHICH CallRail account we're pulling data
 *   from. CallRail's call list lives at /v3/a/{account}/calls, so we need the
 *   account id — but the person connecting only pastes an API key, not an id.
 *   This looks the id up: first from what we've already saved, then from a
 *   server setting, and if neither exists it asks CallRail's API for it (the
 *   key can list its own accounts) and saves it for next time.
 *
 * WHERE IT LIVES:
 *   Non-pure CallRail helper (touches the DB + CallRail's REST API). Kept
 *   separate from the pure predicates in callrail.js on purpose.
 *
 * DEPENDS ON:
 *   Packages:      none (platform fetch)
 *   Internal:      the worker-side supabase client is passed in
 *   External API:  CallRail REST API v3 (api.callrail.com/v3/a.json)
 *   Data:          reads  → integration_config (key='callrail_account_id')
 *                  writes → integration_config (stores it on first discovery)
 *
 * NOTES / GOTCHAS:
 *   - An API key can see more than one CallRail account; we take the first.
 *     A future multi-tenant version would let the connector pick, but UPR has
 *     exactly one account today.
 *   - Returns null (never throws) when the id can't be determined — callers
 *     surface a clear "couldn't determine the account" error instead.
 * ════════════════════════════════════════════════
 */

const authHeader = (apiKey) => ({ Authorization: `Token token="${apiKey}"` });

/**
 * Resolve the CallRail account id. Order: saved config → env (back-compat) →
 * discover via the API (and persist it). Returns a string id or null.
 */
export async function resolveCallRailAccountId(db, apiKey, env) {
  const [cfg] = await db.select('integration_config', 'key=eq.callrail_account_id&select=value');
  if (cfg?.value) return String(cfg.value);

  if (env?.CALLRAIL_ACCOUNT_ID) return String(env.CALLRAIL_ACCOUNT_ID);

  if (!apiKey) return null;

  const res = await fetch('https://api.callrail.com/v3/a.json', { headers: authHeader(apiKey) });
  if (!res.ok) return null;

  const data = await res.json().catch(() => ({}));
  const id = (data.accounts || [])[0]?.id;
  if (!id) return null;

  // Persist for next time (guard against a concurrent insert racing us).
  const [existing] = await db.select('integration_config', 'key=eq.callrail_account_id&select=value');
  if (!existing) {
    await db.insert('integration_config', { key: 'callrail_account_id', value: String(id) });
  }
  return String(id);
}
