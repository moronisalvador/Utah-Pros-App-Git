/**
 * ════════════════════════════════════════════════
 * FILE: endedSessionGuard.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Remembers which sign-ins the user has explicitly ended on this device so
 *   the app can refuse them if they ever come back on their own. Supabase's
 *   library has a known race: a slow token renewal that is still running when
 *   the user signs out can quietly re-save the signed-out session a little
 *   later, and the next app open walks straight back into the account. This
 *   file gives the login brain (AuthContext) the memory it needs to catch and
 *   remove that revived session instead of re-entering it.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./pwaDiagnostics.js (breadcrumb when the guard cannot arm)
 *   Data:      reads  → none (browser storage only)
 *              writes → none (browser storage only)
 *
 * NOTES / GOTCHAS:
 *   - The registry stores ONLY server session ids (opaque UUIDs from the
 *     JWT `session_id` claim) — no user id, employee id, email, token
 *     material, or timestamps. A session id is meaningless without server
 *     access and can never belong to a future login, so keeping it after
 *     sign-out is safe by construction.
 *   - `upr:auth-ended-sessions:v1` DELIBERATELY SURVIVES sign-out — that is
 *     the whole point (the revival it guards against happens after
 *     sign-out). It must never be added to clearOwnedDrafts' swept prefixes
 *     in resumeRestore.js or any other logout sweep.
 *   - session_id is stable across token refreshes of the same server-side
 *     session but is never reused by a new login, so matching on it can only
 *     ever refuse a session the user already ended — a fresh login (this tab
 *     or another tab) is structurally unaffected.
 *   - Everything here fails OPEN (undecodable token, blocked storage →
 *     no-op) because the guard is a belt over the supabase-js defect, not an
 *     authorization boundary; failing closed could brick login on a token
 *     format change. The fail-open is made observable via console.warn plus
 *     a pwaDiagnostics breadcrumb (security review 2026-07-29, finding 4).
 *   - readPersistedSessionDescriptor is a SIDE-EFFECT-FREE storage read on
 *     purpose. Never replace it with auth.getSession(): getSession refreshes
 *     a near-expiry session, which would extend the life of the very zombie
 *     being purged (security review 2026-07-29, finding 2).
 * ════════════════════════════════════════════════
 */
import { recordPwaDiagnostic } from './pwaDiagnostics.js';

export const ENDED_SESSIONS_KEY = 'upr:auth-ended-sessions:v1';
export const ENDED_SESSIONS_LIMIT = 8;

const CANONICAL_UUID_PATTERN = (
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
);
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

function isCanonicalSessionId(value) {
  return typeof value === 'string'
    && value !== NIL_UUID
    && CANONICAL_UUID_PATTERN.test(value);
}

function decodeBase64UrlJson(segment) {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized
    + '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(globalThis.atob(padded));
}

/**
 * The stable server-side session identity carried by every Supabase access
 * token, or null when it cannot be derived. Decoded locally without signature
 * verification on purpose: this is our own stored token, and the only decision
 * it feeds is REFUSING re-entry — never granting anything.
 */
export function sessionIdFromAccessToken(accessToken) {
  try {
    if (typeof accessToken !== 'string') return null;
    const segments = accessToken.split('.');
    if (segments.length !== 3) return null;
    const payload = decodeBase64UrlJson(segments[1]);
    const sessionId = typeof payload?.session_id === 'string'
      ? payload.session_id.toLowerCase()
      : null;
    return isCanonicalSessionId(sessionId) ? sessionId : null;
  } catch {
    return null;
  }
}

export function readEndedSessionIds() {
  try {
    const raw = globalThis.localStorage?.getItem(ENDED_SESSIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCanonicalSessionId);
  } catch {
    return [];
  }
}

/**
 * Records a confirmed-ended session id. Returns true when the guard is armed
 * for that session; false means the guard is inert for this sign-out (the
 * pre-fix revival behavior remains possible), which is warned and
 * breadcrumbed so the fail-open is never silent.
 */
export function recordEndedSessionId(sessionId) {
  if (!isCanonicalSessionId(sessionId)) {
    console.warn(
      '[auth] Ended-session guard could not read a session id for this '
      + 'sign-out; a late token-refresh revival of it cannot be refused.',
    );
    recordPwaDiagnostic('account-state', {
      section: 'ended-session-id-unavailable',
    });
    return false;
  }
  try {
    const next = [
      sessionId,
      ...readEndedSessionIds().filter((id) => id !== sessionId),
    ].slice(0, ENDED_SESSIONS_LIMIT);
    globalThis.localStorage.setItem(
      ENDED_SESSIONS_KEY,
      JSON.stringify(next),
    );
    return true;
  } catch {
    console.warn(
      '[auth] Ended-session guard could not persist its registry; a late '
      + 'token-refresh revival of this sign-out cannot be refused.',
    );
    recordPwaDiagnostic('account-state', {
      section: 'ended-session-store-failed',
    });
    return false;
  }
}

export function isSessionEnded(sessionId) {
  return isCanonicalSessionId(sessionId)
    && readEndedSessionIds().includes(sessionId);
}

/**
 * Side-effect-free description of the session supabase-js currently has
 * persisted (same derivation as SupabaseClient's default storageKey):
 *   { status: 'none' }                 — storage holds no session
 *   { status: 'session', sessionId }   — storage holds this session
 *   { status: 'unknown', sessionId: null } — cannot be determined (missing
 *     URL, blocked storage, undecodable payload); callers must stay
 *     conservative around any live published session.
 */
export function readPersistedSessionDescriptor({
  supabaseUrl = import.meta.env?.VITE_SUPABASE_URL,
} = {}) {
  try {
    if (!supabaseUrl) return { status: 'unknown', sessionId: null };
    const storageKey = `sb-${
      new URL(supabaseUrl).hostname.split('.')[0]
    }-auth-token`;
    const raw = globalThis.localStorage?.getItem(storageKey);
    if (raw === null || raw === undefined) {
      return { status: 'none', sessionId: null };
    }
    const sessionId = sessionIdFromAccessToken(
      JSON.parse(raw)?.access_token,
    );
    return sessionId
      ? { status: 'session', sessionId }
      : { status: 'unknown', sessionId: null };
  } catch {
    return { status: 'unknown', sessionId: null };
  }
}
