// POST /api/sync-claim-to-encircle { claim_id: "uuid" }
//
// Pushes a UPR-native claim up to Encircle as a PropertyClaim.
// Idempotent: skips if claim.encircle_claim_id is already set.
// On success, writes the returned Encircle id back to claims.encircle_claim_id
// AND to all jobs under that claim (so future UPR-side imports don't round-trip).
// On failure, records the error on claims.encircle_sync_error for retry.

import { handleOptions, jsonResponse } from '../lib/cors.js';

async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { error: 'Missing Authorization header', status: 401 };
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: 'Invalid or expired token', status: 401 };
  return { ok: true };
}

function sbHeaders(sbKey) {
  return { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`, 'Content-Type': 'application/json' };
}

function encircleHeaders(env) {
  return {
    'Authorization': `Bearer ${env.ENCIRCLE_API_KEY}`,
    'Content-Type': 'application/json',
    'X-Encircle-Attribution': 'UtahProsRestorationApp',
  };
}

function composeFullAddress({ address, city, state, zip }) {
  const parts = [address, city, [state, zip].filter(Boolean).join(' ').trim()].filter(Boolean);
  return parts.join(', ').trim() || null;
}

function mapLossTypeToEncircle(lossType) {
  if (!lossType) return null;
  const t = String(lossType).toLowerCase();
  if (t.startsWith('type_of_loss_')) return t; // already prefixed
  if (/water|sewer|flood/.test(t))  return 'type_of_loss_water';
  if (/mold/.test(t))                return 'type_of_loss_mold';
  if (/fire|smoke/.test(t))          return 'type_of_loss_fire';
  if (/wind|storm|hail/.test(t))     return 'type_of_loss_wind';
  return null;
}

async function fetchClaimWithContact(sbUrl, sbKey, claimId) {
  const res = await fetch(
    `${sbUrl}/rest/v1/claims?id=eq.${claimId}&select=*,contact:contact_id(id,name,phone,email)`,
    { headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` } }
  );
  if (!res.ok) throw new Error(`Failed to fetch claim: ${res.status}`);
  const rows = await res.json();
  return rows[0] || null;
}

async function updateClaimSync(sbUrl, sbKey, claimId, patch) {
  await fetch(`${sbUrl}/rest/v1/claims?id=eq.${claimId}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(sbKey), 'Prefer': 'return=minimal' },
    body: JSON.stringify(patch),
  });
}

async function linkJobsToEncircleId(sbUrl, sbKey, claimId, encircleId) {
  await fetch(
    `${sbUrl}/rest/v1/jobs?claim_id=eq.${claimId}&encircle_claim_id=is.null`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders(sbKey), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ encircle_claim_id: encircleId }),
    }
  );
}

async function logWorkerRun(sbUrl, sbKey, status, records, errorMessage) {
  try {
    await fetch(`${sbUrl}/rest/v1/worker_runs`, {
      method: 'POST',
      headers: { ...sbHeaders(sbKey), 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        worker_name: 'sync-claim-to-encircle',
        status,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        records_processed: records || 0,
        error_message: errorMessage || null,
      }),
    });
  } catch {}
}

async function doSync(request, env) {
  const sbUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const sbKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY
             || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey) return jsonResponse({ error: 'Missing Supabase env vars' }, 500, request, env);
  if (!env.ENCIRCLE_API_KEY) return jsonResponse({ error: 'Missing ENCIRCLE_API_KEY' }, 500, request, env);

  const body = await request.json().catch(() => ({}));
  const claimId = body.claim_id;
  if (!claimId) return jsonResponse({ error: 'Missing claim_id' }, 400, request, env);

  const claim = await fetchClaimWithContact(sbUrl, sbKey, claimId);
  if (!claim) return jsonResponse({ error: 'Claim not found', claim_id: claimId }, 404, request, env);

  // Idempotency: skip if already linked
  if (claim.encircle_claim_id) {
    return jsonResponse({
      ok: true,
      skipped: 'already_synced',
      claim_id: claimId,
      encircle_claim_id: claim.encircle_claim_id,
    }, 200, request, env);
  }

  const contact = claim.contact || {};

  // Build the Encircle payload
  const fullAddress = composeFullAddress({
    address: claim.loss_address, city: claim.loss_city,
    state: claim.loss_state, zip: claim.loss_zip,
  });

  const payload = {
    policyholder_name:          contact.name || null,
    policyholder_phone_number:  contact.phone || null,
    policyholder_email_address: contact.email || null,
    full_address:               fullAddress,
    insurance_company_name:     claim.insurance_carrier || null,
    policy_number:              claim.policy_number || null,
    insurer_identifier:         claim.insurance_claim_number || null,
    date_of_loss:               claim.date_of_loss || null,
    type_of_loss:               mapLossTypeToEncircle(claim.loss_type),
    contractor_identifier:      claim.claim_number || null, // write our CLM up-front
    locale:                     'en',
  };

  // Strip nulls — Encircle treats missing fields better than explicit null on create
  const cleanPayload = Object.fromEntries(Object.entries(payload).filter(([_, v]) => v !== null && v !== ''));

  // Encircle requires policyholder_name; fail fast with a clear message if missing
  if (!cleanPayload.policyholder_name) {
    const errMsg = 'Contact has no name — cannot create in Encircle (policyholder_name is required)';
    await updateClaimSync(sbUrl, sbKey, claimId, { encircle_sync_error: errMsg });
    await logWorkerRun(sbUrl, sbKey, 'error', 0, `${claimId}: ${errMsg}`);
    return jsonResponse({ error: errMsg, claim_id: claimId }, 400, request, env);
  }

  // POST to Encircle
  let encircleRes;
  try {
    encircleRes = await fetch('https://api.encircleapp.com/v1/property_claims', {
      method: 'POST',
      headers: {
        ...encircleHeaders(env),
        'X-Encircle-Request': `upr-claim-${claimId}`, // idempotency key
      },
      body: JSON.stringify(cleanPayload),
    });
  } catch (e) {
    const errMsg = `Network error: ${e.message}`;
    await updateClaimSync(sbUrl, sbKey, claimId, { encircle_sync_error: errMsg });
    await logWorkerRun(sbUrl, sbKey, 'error', 0, `${claimId}: ${errMsg}`);
    return jsonResponse({ error: errMsg, claim_id: claimId }, 502, request, env);
  }

  if (!encircleRes.ok) {
    const detail = (await encircleRes.text()).slice(0, 400);
    const errMsg = `Encircle ${encircleRes.status}: ${detail}`;
    await updateClaimSync(sbUrl, sbKey, claimId, { encircle_sync_error: errMsg });
    await logWorkerRun(sbUrl, sbKey, 'error', 0, `${claimId}: ${errMsg}`);
    return jsonResponse({ error: 'Encircle API error', status: encircleRes.status, detail, claim_id: claimId }, 502, request, env);
  }

  const encircleClaim = await encircleRes.json();
  const encircleId = String(encircleClaim.id);

  // Link back
  await updateClaimSync(sbUrl, sbKey, claimId, {
    encircle_claim_id:    encircleId,
    encircle_synced_at:   new Date().toISOString(),
    encircle_sync_error:  null,
  });
  await linkJobsToEncircleId(sbUrl, sbKey, claimId, encircleId);
  await logWorkerRun(sbUrl, sbKey, 'completed', 1, null);

  return jsonResponse({
    ok: true,
    claim_id: claimId,
    claim_number: claim.claim_number,
    encircle_claim_id: encircleId,
    encircle_permalink: encircleClaim.permalink_url || null,
  }, 200, request, env);
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const auth = await requireAuth(context.request, context.env);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, context.request, context.env);
  try {
    return await doSync(context.request, context.env);
  } catch (e) {
    console.error('sync-claim-to-encircle error:', e);
    return jsonResponse({ error: e.message }, 500, context.request, context.env);
  }
}
