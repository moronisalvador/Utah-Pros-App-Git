// GET /api/encircle-search?policyholder_name=... | contractor_identifier=... | assignment_identifier=...
// Searches Encircle property claims for the demo-sheet job picker.
// Cloudflare Pages Function port of the legacy Netlify encircle-search function.

import { handleOptions, jsonResponse } from '../lib/cors.js';

// Verify a Supabase session before proxying Encircle (this exposes claim /
// policyholder data). The anon project key is a valid `apikey` for the GoTrue
// /user endpoint; verification is of the caller's Bearer token, not the apikey.
// F-B consolidates these per-worker copies into functions/lib/auth.js.
async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { error: 'Missing Authorization header', status: 401 };
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { 'apikey': anonKey, 'Authorization': `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: 'Invalid or expired token', status: 401 };
  return { ok: true };
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);
  const apiKey = env.ENCIRCLE_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: 'ENCIRCLE_API_KEY not configured' }, 500, request, env);
  }

  const url = new URL(request.url);
  const sp = url.searchParams;

  const query = new URLSearchParams();
  for (const k of ['policyholder_name', 'contractor_identifier', 'assignment_identifier']) {
    const v = sp.get(k);
    if (v) query.set(k, v);
  }
  query.set('limit', '20');
  query.set('order', 'newest');

  try {
    const res = await fetch(`https://api.encircleapp.com/v1/property_claims?${query.toString()}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Encircle-Attribution': 'UtahProsRestoration',
      },
    });
    const text = await res.text();
    if (!res.ok) {
      return jsonResponse({ error: `Encircle ${res.status}`, detail: text.slice(0, 300) }, 502, request, env);
    }
    let data;
    try { data = JSON.parse(text); } catch { data = { list: [] }; }
    return jsonResponse(data, 200, request, env);
  } catch (err) {
    return jsonResponse({ error: err.message || 'Network error' }, 500, request, env);
  }
}
