// GET /api/encircle-search?policyholder_name=... | contractor_identifier=... | assignment_identifier=...
// Searches Encircle property claims for the demo-sheet job picker.
// Cloudflare Pages Function port of the legacy Netlify encircle-search function.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { requireEmployee } from '../lib/auth.js';
import { resolveCredential } from '../lib/credentials.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireEmployee(request, env, supabase(env));
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);
  const { apiKey } = await resolveCredential(env, null, 'encircle');
  if (!apiKey) {
    return jsonResponse({ error: 'Encircle not configured' }, 500, request, env);
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
    const res = await fetchWithTimeout(`https://api.encircleapp.com/v1/property_claims?${query.toString()}`, {
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
