// POST /api/encircle-upload  body: { claim_id, title?, text }
// Posts a note to an Encircle property claim (v2 /notes endpoint).
// Returns { ok: true, id: <encircle_note_id> } so the frontend can persist the id.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { requireEmployee } from '../lib/auth.js';
import { resolveCredential } from '../lib/credentials.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await requireEmployee(request, env, supabase(env));
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);
  const { apiKey } = await resolveCredential(env, null, 'encircle');
  if (!apiKey) {
    return jsonResponse({ error: 'Encircle not configured' }, 500, request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const { claim_id, title, text } = body || {};
  if (!claim_id) return jsonResponse({ error: 'claim_id required' }, 400, request, env);
  if (!text)     return jsonResponse({ error: 'text required' }, 400, request, env);

  const url = `https://api.encircleapp.com/v2/property_claims/${claim_id}/notes`;
  const payload = { title: title || 'Demo Sheet', text };

  let res;
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Encircle-Attribution': 'UtahProsRestoration',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return jsonResponse({ error: `Network error: ${e.message}` }, 502, request, env);
  }

  const respText = await res.text();
  if (!res.ok) {
    console.log('encircle-upload non-2xx', res.status, respText.slice(0, 300));
    return jsonResponse(
      { error: `Encircle ${res.status}`, detail: respText.slice(0, 300) },
      502, request, env,
    );
  }

  let result = {};
  try { result = JSON.parse(respText); } catch { result = {}; }
  return jsonResponse({ ok: true, id: result.id || null }, 200, request, env);
}
