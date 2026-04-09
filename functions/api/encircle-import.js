// GET  /api/encircle-import?action=search&policyholder_name=X&limit=20
// GET  /api/encircle-import?action=get&claim_id=123
// POST /api/encircle-import  { action: "patch", claim_id, contractor_identifier }
// POST /api/encircle-import  { action: "import", ... }

import { handleOptions, jsonResponse } from '../lib/cors.js';

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  if (digits.length > 0) return '+' + digits;
  return null;
}

function parseAddressParts(fullAddress) {
  if (!fullAddress) return { address: null, city: null, state: null, zip: null };
  const parts = fullAddress.split(',').map(s => s.trim());
  if (parts.length >= 3) {
    const street = parts[0];
    const city = parts[1];
    const last = parts[parts.length - 1];
    const stateZip = last.split(/\s+/);
    return { address: street, city, state: stateZip[0] || null, zip: stateZip[1] || null };
  }
  if (parts.length === 2) {
    return { address: parts[0], city: parts[1], state: null, zip: null };
  }
  return { address: fullAddress, city: null, state: null, zip: null };
}

function encircleHeaders(env) {
  return {
    'Authorization': `Bearer ${env.ENCIRCLE_API_KEY}`,
    'Content-Type': 'application/json',
    'X-Encircle-Attribution': 'UtahProsRestorationApp',
  };
}

function sbHeaders(sbKey) {
  return {
    'apikey': sbKey,
    'Authorization': `Bearer ${sbKey}`,
    'Content-Type': 'application/json',
  };
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

// ── GET handlers ──────────────────────────────────────────────────────────────

async function handleSearch(url, request, env) {
  const params = new URLSearchParams();
  const pName = url.searchParams.get('policyholder_name');
  const cId = url.searchParams.get('contractor_identifier');
  const aId = url.searchParams.get('assignment_identifier');
  const limit = url.searchParams.get('limit') || '20';

  if (pName) params.set('policyholder_name', pName);
  if (cId) params.set('contractor_identifier', cId);
  if (aId) params.set('assignment_identifier', aId);
  params.set('limit', limit);
  params.set('order', 'newest');

  const res = await fetch(
    `https://api.encircleapp.com/v1/property_claims?${params.toString()}`,
    { headers: encircleHeaders(env) }
  );

  if (!res.ok) {
    const errText = await res.text();
    return jsonResponse({ error: `Encircle API ${res.status}`, detail: errText.slice(0, 300) }, 502, request, env);
  }

  const data = await res.json();
  const list = Array.isArray(data) ? data : data.list || data.property_claims || data.results || data.data || [];
  return jsonResponse({ list }, 200, request, env);
}

async function handleGet(url, request, env) {
  const claimId = url.searchParams.get('claim_id');
  if (!claimId) return jsonResponse({ error: 'Missing claim_id' }, 400, request, env);

  const res = await fetch(
    `https://api.encircleapp.com/v1/property_claims/${claimId}`,
    { headers: encircleHeaders(env) }
  );

  if (!res.ok) {
    const errText = await res.text();
    return jsonResponse({ error: `Encircle API ${res.status}`, detail: errText.slice(0, 300) }, 502, request, env);
  }

  const data = await res.json();
  return jsonResponse(data, 200, request, env);
}

// ── POST handlers ─────────────────────────────────────────────────────────────

async function handlePatch(body, request, env) {
  const { claim_id, contractor_identifier } = body;
  if (!claim_id || !contractor_identifier) {
    return jsonResponse({ error: 'Missing claim_id or contractor_identifier' }, 400, request, env);
  }

  const res = await fetch(
    `https://api.encircleapp.com/v1/property_claims/${claim_id}`,
    {
      method: 'PATCH',
      headers: encircleHeaders(env),
      body: JSON.stringify({ contractor_identifier }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    return jsonResponse({ error: `Encircle PATCH ${res.status}`, detail: errText.slice(0, 300) }, 502, request, env);
  }

  return jsonResponse({ ok: true }, 200, request, env);
}

async function handleImport(body, request, env) {
  const sbUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const sbKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!sbUrl || !sbKey) return jsonResponse({ error: 'Missing Supabase env vars' }, 500, request, env);

  const {
    encircle_claim_id, name, phone, email,
    address, city, state, zip,
    insurance_company, insurance_claim_number, policy_number,
    adjuster_name, date_of_loss, type_of_loss, cat_code,
    broker_agent, project_manager, encircle_summary,
    carrier_identifier, assignment_identifier,
    divisions,
  } = body;

  if (!encircle_claim_id) return jsonResponse({ error: 'Missing encircle_claim_id' }, 400, request, env);
  if (!phone) return jsonResponse({ error: 'Phone is required' }, 400, request, env);
  if (!divisions || !divisions.length) return jsonResponse({ error: 'At least one division required' }, 400, request, env);

  const normalizedPhone = normalizePhone(phone);
  const hdrs = sbHeaders(sbKey);

  // Step 1: Upsert contact
  let contactId;
  if (normalizedPhone) {
    const checkRes = await fetch(
      `${sbUrl}/rest/v1/contacts?phone=eq.${encodeURIComponent(normalizedPhone)}&limit=1`,
      { headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` } }
    );
    const existing = checkRes.ok ? await checkRes.json() : [];
    if (existing.length > 0) {
      contactId = existing[0].id;
    }
  }

  if (!contactId) {
    const contactRes = await fetch(`${sbUrl}/rest/v1/contacts`, {
      method: 'POST',
      headers: { ...hdrs, 'Prefer': 'return=representation' },
      body: JSON.stringify({
        name: name || null,
        phone: normalizedPhone,
        email: email || null,
        role: 'homeowner',
      }),
    });
    if (!contactRes.ok) {
      const err = await contactRes.text();
      return jsonResponse({ error: 'Failed to create contact', detail: err.slice(0, 300) }, 500, request, env);
    }
    const [newContact] = await contactRes.json();
    contactId = newContact.id;

    // Insert address
    if (address) {
      await fetch(`${sbUrl}/rest/v1/contact_addresses`, {
        method: 'POST',
        headers: { ...hdrs, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          contact_id: contactId,
          label: 'service',
          address: address || null,
          city: city || null,
          state: state || null,
          zip: zip || null,
          is_billing: true,
        }),
      });
    }
  }

  // Step 2: Create claim
  const claimRes = await fetch(`${sbUrl}/rest/v1/claims`, {
    method: 'POST',
    headers: { ...hdrs, 'Prefer': 'return=representation' },
    body: JSON.stringify({
      contact_id: contactId,
      insurance_carrier: insurance_company || null,
      insurance_claim_number: insurance_claim_number || null,
      policy_number: policy_number || null,
      date_of_loss: date_of_loss || null,
      loss_address: address || null,
      loss_city: city || null,
      loss_state: state || null,
      loss_zip: zip || null,
      loss_type: type_of_loss || null,
    }),
  });

  if (!claimRes.ok) {
    const err = await claimRes.text();
    return jsonResponse({ error: 'Failed to create claim', detail: err.slice(0, 300) }, 500, request, env);
  }

  const [claim] = await claimRes.json();
  const claimId = claim.id;
  const clmNumber = claim.claim_number;

  // Step 3: Create jobs — one per division
  const jobs = [];
  for (const division of divisions) {
    const jobRes = await fetch(`${sbUrl}/rest/v1/jobs`, {
      method: 'POST',
      headers: { ...hdrs, 'Prefer': 'return=representation' },
      body: JSON.stringify({
        claim_id: claimId,
        division,
        insured_name: name || null,
        address: address || null,
        city: city || null,
        state: state || null,
        zip: zip || null,
        client_email: email || null,
        client_phone: normalizedPhone,
        insurance_company: insurance_company || null,
        claim_number: insurance_claim_number || null,
        adjuster_name: adjuster_name || null,
        policy_number: policy_number || null,
        date_of_loss: date_of_loss || null,
        type_of_loss: type_of_loss || null,
        cat_code: cat_code || null,
        broker_agent: broker_agent || null,
        project_manager: project_manager || null,
        encircle_summary: encircle_summary || null,
        carrier_identifier: carrier_identifier || null,
        assignment_identifier: assignment_identifier || null,
        encircle_claim_id: String(encircle_claim_id),
        primary_contact_id: contactId,
        phase: 'lead',
        source: 'insurance',
      }),
    });

    if (!jobRes.ok) {
      const err = await jobRes.text();
      return jsonResponse({
        error: `Failed to create ${division} job`,
        detail: err.slice(0, 300),
        partial: { claim_id: claimId, claim_number: clmNumber, contact_id: contactId, jobs },
      }, 500, request, env);
    }

    const [job] = await jobRes.json();
    jobs.push({ id: job.id, job_number: job.job_number, division: job.division });
  }

  // Step 4: Write-back CLM number to Encircle
  let encircleWriteback = false;
  if (clmNumber) {
    const patchRes = await fetch(
      `https://api.encircleapp.com/v1/property_claims/${encircle_claim_id}`,
      {
        method: 'PATCH',
        headers: encircleHeaders(env),
        body: JSON.stringify({ contractor_identifier: clmNumber }),
      }
    );
    encircleWriteback = patchRes.ok;
  }

  return jsonResponse({
    ok: true,
    claim_id: claimId,
    claim_number: clmNumber,
    contact_id: contactId,
    jobs,
    encircle_writeback: encircleWriteback,
  }, 200, request, env);
}

// ── Request handlers ──────────────────────────────────────────────────────────

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const action = url.searchParams.get('action');

    if (action === 'search') return await handleSearch(url, context.request, context.env);
    if (action === 'get') return await handleGet(url, context.request, context.env);

    return jsonResponse({ error: 'Unknown action. Use action=search or action=get' }, 400, context.request, context.env);
  } catch (e) {
    console.error('encircle-import GET error:', e);
    return jsonResponse({ error: e.message }, 500, context.request, context.env);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const action = body.action;

    if (action === 'patch') return await handlePatch(body, context.request, context.env);
    if (action === 'import') return await handleImport(body, context.request, context.env);

    return jsonResponse({ error: 'Unknown action. Use action=patch or action=import' }, 400, context.request, context.env);
  } catch (e) {
    console.error('encircle-import POST error:', e);
    return jsonResponse({ error: e.message }, 500, context.request, context.env);
  }
}
