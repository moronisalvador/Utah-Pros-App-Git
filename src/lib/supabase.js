/**
 * ════════════════════════════════════════════════
 * FILE: supabase.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The one place the app talks to the database over the web. Every screen's
 *   read and write goes through the five small functions here (select, insert,
 *   update, delete, rpc). It attaches the signed-in user's pass to each request,
 *   gives up on a request that hangs too long, and turns any refusal from the
 *   database into a clear error the calling screen can react to.
 *
 * DEPENDS ON:
 *   Packages:  none (browser fetch)
 *   Internal:  none — this is the bottom layer. src/lib/stableDb.js wraps it.
 *   Data:      every table and RPC the app reads or writes — this is the pipe,
 *              not a consumer.
 *
 * EXPORTS:
 *   createSupabaseClient(token) → a client bound to one token (one request's worth)
 *   db                          → unauthenticated singleton, bootstrapping ONLY
 *                                 (the sanctioned CLAUDE.md Rule 3 exception;
 *                                 components use `const { db } = useAuth()`)
 *
 * NOTES / GOTCHAS:
 *   - Uses the anon key + REST, never the Supabase JS SDK (that is realtime.js
 *     only). RLS/grants must assume every internet caller has the anon key.
 *   - EVERY method THROWS on a non-OK response — including 404. Nothing here
 *     returns [] on failure, so every caller needs a try/catch.
 *   - Thrown errors carry `status` and `body` alongside the message. The MESSAGE
 *     TEXT IS LOAD-BEARING — callers pattern-match it (Layout.jsx looks for
 *     '23505' to spot a duplicate phone), so do not reformat it.
 *   - Only `select` retries, and only on a network error or timeout — NEVER a
 *     write, because a timeout means the server may have processed it anyway.
 *     (401 retries are a different, safe case handled a layer up in stableDb.js;
 *     that file explains why.)
 * ════════════════════════════════════════════════
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const TIMEOUT_MS = 30000; // 30 seconds — field techs on weak signal need time, but not forever

function getHeaders(token) {
  const h = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
  h['Authorization'] = `Bearer ${token || SUPABASE_ANON_KEY}`;
  return h;
}

// Wraps fetch with an AbortController timeout.
// Throws a clear "Request timed out" error instead of hanging forever.
function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .then(res => { clearTimeout(timer); return res; })
    .catch(err => {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('Request timed out. Check your connection and try again.');
      throw err;
    });
}

// Builds the Error thrown for a non-OK response.
//
// The MESSAGE FORMAT IS LOAD-BEARING — callers pattern-match on it (Layout.jsx
// checks for '23505'/'contacts_phone_key' to detect a duplicate phone), so it is
// byte-identical to what this file has always thrown. `status` and `body` are
// ADDITIVE: they let a caller branch on the HTTP status without string-matching.
// stableDb.js keys its 401 session-recovery on `status` — see that file.
async function responseError(label, res) {
  const body = await res.text();
  const error = new Error(`${label}: ${res.status} ${body}`);
  error.status = res.status;
  error.body = body;
  return error;
}

// Retries a fetch once on network failure or timeout (not on 4xx/5xx).
// Gives field techs on weak signal a transparent second chance.
//
// SAFETY: only ever wrap idempotent GETs (select) in this. A timeout does NOT
// mean the server didn't process the request — it means we didn't get the
// response. Re-sending a non-idempotent write (insert/update/delete/rpc) can
// duplicate it (double payment, double appointment). Writers below call
// fetchWithTimeout directly (no retry) for exactly this reason.
async function fetchWithRetry(url, options) {
  try {
    return await fetchWithTimeout(url, options);
  } catch (err) {
    // Only retry on network/timeout errors, not on bad responses
    const isRetryable = err.message?.includes('timed out') ||
      err.message?.includes('Failed to fetch') ||
      err.name === 'NetworkError';
    if (!isRetryable) throw err;
    // Wait 1.5s then try once more
    await new Promise(r => setTimeout(r, 1500));
    return fetchWithTimeout(url, options);
  }
}

export function createSupabaseClient(token) {
  const headers = getHeaders(token);

  return {
    async select(table, query = '') {
      const res = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers });
      if (!res.ok) throw await responseError(`SELECT ${table}`, res);
      return res.json();
    },

    async insert(table, data) {
      const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });
      if (!res.ok) throw await responseError(`INSERT ${table}`, res);
      return res.json();
    },

    async update(table, filter, data) {
      const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(data),
      });
      if (!res.ok) throw await responseError(`UPDATE ${table}`, res);
      if (res.status === 204) return null;
      return res.json();
    },

    async delete(table, filter) {
      const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw await responseError(`DELETE ${table}`, res);
      // 204 No Content is a valid success response — no body to parse
      if (res.status === 204) return null;
      return res.json();
    },

    async rpc(fn, params = {}) {
      const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      });
      if (!res.ok) throw await responseError(`RPC ${fn}`, res);
      // Some RPCs (e.g. delete functions) return 204 No Content — no body to parse
      if (res.status === 204) return null;
      return res.json();
    },

    // Expose for direct storage fetches (file upload/delete in JobPage)
    baseUrl: SUPABASE_URL,
    apiKey: token || SUPABASE_ANON_KEY,
  };
}

// Singleton for unauthenticated requests (bootstrapping, public reads)
export const db = createSupabaseClient();
