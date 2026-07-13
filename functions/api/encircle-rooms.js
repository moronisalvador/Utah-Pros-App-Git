// GET /api/encircle-rooms?claim_id=...
// Fetches all structures for a claim, then rooms for each in parallel.
// Returns { rooms: [{id, name, structureId, structureName}], structures: [...] }.

import { handleOptions, jsonResponse } from '../lib/cors.js';

// Verify a Supabase session before proxying Encircle. Anon key is a valid apikey
// for the GoTrue /user endpoint; we verify the caller's Bearer token. F-B
// consolidates these per-worker copies into functions/lib/auth.js.
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

  const claimId = new URL(request.url).searchParams.get('claim_id');
  if (!claimId) {
    return jsonResponse({ error: 'claim_id required' }, 400, request, env);
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-Encircle-Attribution': 'UtahProsRestoration',
  };

  try {
    const structRes = await fetch(
      `https://api.encircleapp.com/v1/property_claims/${claimId}/structures?limit=100`,
      { headers },
    );
    const structText = await structRes.text();
    if (!structRes.ok) {
      return jsonResponse(
        { error: `Encircle structures ${structRes.status}`, detail: structText.slice(0, 300) },
        502, request, env,
      );
    }
    const structures = (JSON.parse(structText).list) || [];

    const roomFetches = structures.map(s =>
      fetch(
        `https://api.encircleapp.com/v1/property_claims/${claimId}/structures/${s.id}/rooms?limit=100`,
        { headers },
      )
        .then(r => r.json())
        .then(d => ({ structure: s, rooms: d.list || [] }))
        .catch(() => ({ structure: s, rooms: [] })),
    );
    const results = await Promise.all(roomFetches);

    const multiStruct = structures.length > 1;
    const allRooms = results.flatMap(({ structure, rooms }) =>
      rooms.map(room => ({
        id: room.id,
        name: multiStruct && structure.name
          ? `${structure.name} — ${room.name}`
          : room.name,
        structureId: structure.id,
        structureName: structure.name,
      })),
    );

    return jsonResponse({ rooms: allRooms, structures }, 200, request, env);
  } catch (err) {
    return jsonResponse({ error: err.message || 'Network error' }, 500, request, env);
  }
}
