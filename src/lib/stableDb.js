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
 * ════════════════════════════════════════════════
 */
import { createSupabaseClient, db as anonDb } from './supabase.js';

// Build a db client with a STABLE identity whose token is resolved per-request.
//   getToken() → the current access token, or null/undefined for anon.
export function createTokenBoundClient(getToken) {
  const fresh = () => createSupabaseClient(getToken());
  return {
    select: (...args) => fresh().select(...args),
    insert: (...args) => fresh().insert(...args),
    update: (...args) => fresh().update(...args),
    delete: (...args) => fresh().delete(...args),
    rpc:    (...args) => fresh().rpc(...args),
    baseUrl: anonDb.baseUrl,
    get apiKey() { return getToken() || anonDb.apiKey; },
  };
}
