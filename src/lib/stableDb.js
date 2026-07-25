/**
 * ════════════════════════════════════════════════
 * FILE: stableDb.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The app talks to the database through a small client object that carries
 *   the logged-in user's access token. That token silently renews about once
 *   an hour. Before this file existed, every renewal REPLACED the client
 *   object, and every screen watching it re-loaded its data — which made
 *   pages visibly "reset" right when a tech came back to the app. This file
 *   builds a client whose identity never changes: it reads the CURRENT token
 *   at the moment of each request instead of baking it in, so a token renewal
 *   changes nothing on screen.
 *
 *   It also owns the app's ONE piece of 401 recovery: if the database rejects
 *   the token, it asks the caller to renew the session and quietly repeats the
 *   request. If the session is genuinely gone, the error is passed on so the
 *   app can say so — instead of failing invisibly forever.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./supabase.js (createSupabaseClient — the per-request worker)
 *   Data:      same tables as any caller — this is a pass-through wrapper
 *
 * NOTES / GOTCHAS:
 *   - `getToken` is called at the START of every request, so a request issued
 *     right after a renewal always carries the fresh JWT.
 *   - `apiKey` is a getter for the same reason — callers that build storage
 *     upload headers (`Bearer ${db.apiKey}`) read it at call time.
 *   - Identity stability is the whole point: consumers keep `[db]` in their
 *     dependency arrays (CLAUDE.md pattern) and those effects must NOT re-run
 *     on token renewal. Do not "simplify" this back to per-token clients.
 *   - Only 401 triggers recovery. A 403 / 42501 is a REAL permission denial
 *     (that is what DEV anon mode returns for a `TO authenticated` RPC) and
 *     must surface unchanged — never retry it, or dev mode spins.
 * ════════════════════════════════════════════════
 */
import { createSupabaseClient, db as anonDb } from './supabase.js';

// Build a db client with a STABLE identity whose token is resolved per-request.
//   getToken()   → the current access token, or null/undefined for anon.
//   onAuthError() → optional. Called when the DB rejects the JWT with a 401;
//                   resolves true once a fresh token is bound (retry is worth
//                   it), false when the session is unrecoverable. Omit it and
//                   the client behaves exactly as it did before recovery existed.
export function createTokenBoundClient(getToken, { onAuthError } = {}) {
  const fresh = () => createSupabaseClient(getToken());

  // One request, with at most ONE session-recovery retry on a 401.
  //
  // WHY RETRYING A WRITE IS SAFE HERE (this is NOT a contradiction of the
  // "never retry a non-idempotent write" rule in supabase.js — read on):
  // that rule is about TIMEOUTS, where we didn't get a response and the server
  // may well have processed the write, so re-sending could double-charge or
  // double-book. A 401 is categorically different — PostgREST rejects an
  // invalid JWT in auth middleware BEFORE any SQL runs, so a 401 is positive
  // proof the write did not happen. Repeating it cannot duplicate anything.
  const call = async (method, args) => {
    try {
      return await fresh()[method](...args);
    } catch (e) {
      if (e?.status !== 401) throw e;          // not an auth failure — surface it
      if (!getToken()) throw e;                // anon / DEV path: no session to renew
      if (!onAuthError) throw e;               // no recovery wired — surface it
      const recovered = await onAuthError();
      if (!recovered) throw e;                 // session is gone — surface the original
      // Retry ONCE. We are already inside the catch, so a second 401 propagates
      // straight out rather than looping back into recovery.
      return fresh()[method](...args);
    }
  };

  return {
    select: (...args) => call('select', args),
    insert: (...args) => call('insert', args),
    update: (...args) => call('update', args),
    delete: (...args) => call('delete', args),
    rpc:    (...args) => call('rpc', args),
    baseUrl: anonDb.baseUrl,
    get apiKey() { return getToken() || anonDb.apiKey; },
  };
}
