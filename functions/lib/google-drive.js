/**
 * ════════════════════════════════════════════════
 * FILE: functions/lib/google-drive.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets each staff member connect their own personal Google Drive to the app.
 *   It talks to Google to swap a login for long-lived "keys" (tokens), keeps
 *   those keys fresh automatically, figures out which staff member a web request
 *   belongs to, and downloads the actual file bytes when someone picks a file
 *   from their Drive. The secret refresh key is stored server-side only and never
 *   sent to the browser.
 *
 * WHERE IT LIVES:
 *   Worker library — imported by functions/api/google-drive-*.js. Not a route.
 *
 * DEPENDS ON:
 *   Packages:  none (pure fetch, runs in Cloudflare V8 isolates)
 *   Internal:  ./supabase.js (service-role REST client)
 *   Data:      reads  → user_google_accounts, employees
 *              writes → user_google_accounts (upsert tokens)
 *   External:  accounts.google.com / oauth2.googleapis.com (OAuth),
 *              www.googleapis.com (Drive + userinfo), Supabase auth/v1/user
 *
 * NOTES / GOTCHAS:
 *   - Keyed by employee_id (one row per employee), NOT a single provider row like
 *     QuickBooks. Each employee has independent tokens.
 *   - Google's refresh response OMITS refresh_token — saveTokens preserves the
 *     existing one so a refresh never wipes the connection.
 *   - Native Google types (Docs/Sheets/Slides) can't be downloaded raw; they are
 *     EXPORTED (Docs/Slides → PDF, Sheets → XLSX) and the file name/extension is
 *     adjusted to match.
 *   - Uses the non-restricted drive.file scope: only files the user explicitly
 *     picks become app-accessible (avoids Google's restricted-scope CASA review).
 * ════════════════════════════════════════════════
 */

import { supabase } from './supabase.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL     = 'https://oauth2.googleapis.com/token';
const USERINFO_URL  = 'https://www.googleapis.com/oauth2/v3/userinfo';
const DRIVE_FILES   = 'https://www.googleapis.com/drive/v3/files';
// One consent grants BOTH features per employee:
//   drive.file      — per-file access granted via the Picker (non-restricted).
//   calendar.events — manage events on the user's own calendars (appointment sync).
// Both are non-restricted; with an Internal Workspace app neither needs Google
// app verification. include_granted_scopes makes this incremental for anyone who
// previously connected with Drive only (they re-consent once to add Calendar).
const SCOPE         = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events openid email';

// Native Google types must be exported, not downloaded raw. Map → export MIME.
const GOOGLE_EXPORTS = {
  'application/vnd.google-apps.document':     { mime: 'application/pdf',                                                          ext: 'pdf'  },
  'application/vnd.google-apps.spreadsheet':  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        ext: 'xlsx' },
  'application/vnd.google-apps.presentation': { mime: 'application/pdf',                                                          ext: 'pdf'  },
  'application/vnd.google-apps.drawing':      { mime: 'application/pdf',                                                          ext: 'pdf'  },
};

// ─── SECTION: OAuth ──────────────
export function buildAuthorizeUrl(env, state) {
  const params = new URLSearchParams({
    client_id:              env.GOOGLE_CLIENT_ID,
    response_type:          'code',
    scope:                  SCOPE,
    redirect_uri:           env.GOOGLE_REDIRECT_URI,
    access_type:            'offline',        // ask for a refresh token
    prompt:                 'consent',        // force consent so a refresh token is always returned
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function postToken(env, params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams({
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      ...params,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Google token endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

export function exchangeCodeForTokens(env, code) {
  return postToken(env, {
    grant_type:   'authorization_code',
    code,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
  });
}

export function refreshTokens(env, refreshToken) {
  return postToken(env, {
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
  });
}

export async function fetchUserEmail(accessToken) {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const info = await res.json();
  return info.email || null;
}

// ─── SECTION: Connection persistence (per employee) ──────────────
export async function getConnection(env, employeeId) {
  const db = supabase(env);
  const rows = await db.select('user_google_accounts', `employee_id=eq.${employeeId}&limit=1`);
  return rows && rows[0] ? rows[0] : null;
}

export async function saveTokens(env, employeeId, tokens, extra = {}) {
  const db = supabase(env);
  const now = Date.now();
  const ttlMs = (tokens.expires_in ? Number(tokens.expires_in) : 3600) * 1000;
  const row = {
    employee_id:      employeeId,
    access_token:     tokens.access_token,
    token_expires_at: new Date(now + ttlMs).toISOString(),
    updated_at:       new Date(now).toISOString(),
    // Refresh responses omit refresh_token — only overwrite when Google returns one,
    // otherwise we'd null out the stored token and break the connection.
    ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    ...(tokens.scope ? { scopes: tokens.scope } : {}),
    ...extra,
  };
  await db.upsert('user_google_accounts', row);
  return row;
}

// Returns a valid access token for an employee, refreshing first if it expires
// within 5 minutes (same guard as the QuickBooks helper).
export async function getValidAccessToken(env, employeeId) {
  let conn = await getConnection(env, employeeId);
  if (!conn || !conn.refresh_token) throw new Error('Google Drive not connected');

  const expMs = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (Date.now() > expMs - 5 * 60 * 1000) {
    const tokens = await refreshTokens(env, conn.refresh_token);
    conn = await saveTokens(env, employeeId, tokens);
  }
  return { accessToken: conn.access_token, expiresAt: conn.token_expires_at };
}

// ─── SECTION: Drive download ──────────────
// Downloads (or exports) a single Drive file's bytes for the given employee.
// Returns { bytes: ArrayBuffer, mimeType, name }.
export async function downloadFile(env, employeeId, { id, mimeType, name }) {
  const { accessToken } = await getValidAccessToken(env, employeeId);

  const exportAs = mimeType ? GOOGLE_EXPORTS[mimeType] : null;
  let url, outMime, outName = name || id;

  if (exportAs) {
    url = `${DRIVE_FILES}/${id}/export?mimeType=${encodeURIComponent(exportAs.mime)}`;
    outMime = exportAs.mime;
    if (!/\.[a-z0-9]+$/i.test(outName)) outName = `${outName}.${exportAs.ext}`;
  } else {
    url = `${DRIVE_FILES}/${id}?alt=media`;
    outMime = mimeType || 'application/octet-stream';
  }

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`Drive download ${id} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return { bytes: await res.arrayBuffer(), mimeType: outMime, name: outName };
}

// ─── SECTION: Auth — resolve request → employee ──────────────
// Validates the Supabase Bearer token and maps the auth user to their employee
// row. Mirrors the getAuthUser + employees lookup repeated across QBO workers.
export async function getActorEmployee(request, env, db) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user?.id) return null;

  const emp = await db.select('employees', `auth_user_id=eq.${user.id}&select=id,full_name,email&limit=1`);
  return emp?.[0] || null;
}
