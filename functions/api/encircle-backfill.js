// GET  /api/encircle-backfill?from=YYYY-MM-DD&to=YYYY-MM-DD&date_field=date_of_loss
//                             &max=500&division_strategy=smart&divisions=water,reconstruction
//                             &skip_existing=true&repair_orphans=true&skip_no_phone=true
//   → dry-run preview: counts + per-claim action (new/repair/skip)
//
// POST /api/encircle-backfill
//   body: { from, to, date_field, max, divisions, division_strategy,
//           dry_run, skip_existing, repair_orphans, skip_no_phone, writeback_clm }
//   → executes (unless dry_run), returns counts + samples + errors
//
// Purpose-built batch importer for historical Encircle claims. Creates the full
// contact → claim → jobs chain, repairs legacy orphan jobs, dedup-safe, idempotent.

import { handleOptions, jsonResponse } from '../lib/cors.js';

// ── Auth ─────────────────────────────────────────────────────────────────────
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

// ── Shared helpers (match encircle-import.js) ─────────────────────────────────
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return '+' + digits;
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

// ── Type-of-loss + division mapping ───────────────────────────────────────────
function normalizeTypeOfLoss(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  return s.startsWith('type_of_loss_') ? s.slice(13) : s;
}

function mapTypeOfLossToDivisions(raw) {
  const t = normalizeTypeOfLoss(raw);
  if (!t) return ['water', 'reconstruction'];
  if (/water|sewer|flood|steam|pipe|leak/.test(t))   return ['water', 'reconstruction'];
  if (/mold/.test(t))                                 return ['mold'];
  if (/fire|smoke|lightning/.test(t))                 return ['fire', 'reconstruction'];
  if (/wind|storm|hail|hurricane|tornado/.test(t))    return ['reconstruction'];
  return ['water', 'reconstruction']; // safe default
}

function deriveWriteBackDecision(encircleClaim, newClmNumber, writebackFlag) {
  if (!writebackFlag) return { do: false, reason: 'writeback_flag_off' };
  if (!newClmNumber) return { do: false, reason: 'no_clm_minted' };
  const existing = encircleClaim.contractor_identifier;
  if (existing && String(existing).trim() && existing !== newClmNumber) {
    return { do: false, reason: 'encircle_has_existing_contractor_id' };
  }
  return { do: true };
}

// ── Encircle pagination ───────────────────────────────────────────────────────
async function fetchEncircleWindow({ env, fromISO, toISO, dateField, max }) {
  const claims = [];
  let pagesFetched = 0;
  let hitMax = false;
  let earliestSeen = null;
  let after = null;

  while (true) {
    const params = new URLSearchParams({ limit: '100', order: 'newest' });
    if (after) params.set('after', after);
    const res = await fetch(
      `https://api.encircleapp.com/v1/property_claims?${params.toString()}`,
      { headers: encircleHeaders(env) }
    );
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Encircle API ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    pagesFetched++;
    const page = Array.isArray(data)
      ? data
      : data.list || data.property_claims || data.results || data.claims || data.data || [];
    if (page.length === 0) break;

    let anyInRange = false;
    let lastDateInPage = null;
    for (const c of page) {
      const dateStr = c[dateField] || c.created_at || null;
      lastDateInPage = dateStr;
      if (dateStr && dateStr >= fromISO && dateStr <= toISO) {
        claims.push(c);
        anyInRange = true;
        if (!earliestSeen || dateStr < earliestSeen) earliestSeen = dateStr;
        if (claims.length >= max) { hitMax = true; break; }
      }
    }

    if (hitMax) break;
    // Stop if the oldest entry on this page is already before the window
    if (lastDateInPage && lastDateInPage < fromISO) break;
    // Stop if nothing on the page was in range AND last entry is below window
    if (!anyInRange && lastDateInPage && lastDateInPage < fromISO) break;

    after = data.cursor?.after || null;
    if (!after) break;

    // Polite delay between pages
    await new Promise(r => setTimeout(r, 250));
  }

  return { claims, pagesFetched, hitMax, earliestSeen };
}

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function fetchJobsForEncircleIds(sbUrl, sbKey, ids) {
  if (!ids.length) return new Map();
  const res = await fetch(
    `${sbUrl}/rest/v1/jobs?encircle_claim_id=in.(${ids.join(',')})&select=id,encircle_claim_id,claim_id,primary_contact_id,division`,
    { headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` } }
  );
  if (!res.ok) throw new Error(`Failed to fetch existing jobs: ${res.status}`);
  const rows = await res.json();
  const map = new Map();
  for (const r of rows) {
    const key = String(r.encircle_claim_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return map;
}

async function findContactByPhone(sbUrl, sbKey, phone) {
  const res = await fetch(
    `${sbUrl}/rest/v1/contacts?phone=eq.${encodeURIComponent(phone)}&limit=1&select=id,name,email,phone`,
    { headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

async function findContactByEmail(sbUrl, sbKey, email) {
  const res = await fetch(
    `${sbUrl}/rest/v1/contacts?email=eq.${encodeURIComponent(email)}&phone=is.null&limit=1&select=id,name,email,phone`,
    { headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

async function insertContact(sbUrl, sbKey, { name, phone, email }) {
  const res = await fetch(`${sbUrl}/rest/v1/contacts`, {
    method: 'POST',
    headers: { ...sbHeaders(sbKey), 'Prefer': 'return=representation' },
    body: JSON.stringify({ name: name || null, phone, email: email || null, role: 'homeowner' }),
  });
  if (!res.ok) throw new Error(`Insert contact failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const [row] = await res.json();
  return row.id;
}

async function insertContactAddress(sbUrl, sbKey, contactId, parsed) {
  if (!parsed.address) return;
  await fetch(`${sbUrl}/rest/v1/contact_addresses`, {
    method: 'POST',
    headers: { ...sbHeaders(sbKey), 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      contact_id: contactId,
      label: 'service',
      address: parsed.address,
      city: parsed.city || null,
      state: parsed.state || null,
      zip: parsed.zip || null,
      is_billing: true,
    }),
  });
}

async function insertClaim(sbUrl, sbKey, payload) {
  const res = await fetch(`${sbUrl}/rest/v1/claims`, {
    method: 'POST',
    headers: { ...sbHeaders(sbKey), 'Prefer': 'return=representation' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Insert claim failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const [row] = await res.json();
  return { id: row.id, claim_number: row.claim_number };
}

async function upsertJobsBatch(sbUrl, sbKey, jobRows) {
  if (!jobRows.length) return [];
  const res = await fetch(
    `${sbUrl}/rest/v1/jobs?on_conflict=encircle_claim_id,division`,
    {
      method: 'POST',
      headers: { ...sbHeaders(sbKey), 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(jobRows),
    }
  );
  if (!res.ok) throw new Error(`Upsert jobs failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function upsertContactJobPivotBatch(sbUrl, sbKey, pivotRows) {
  if (!pivotRows.length) return;
  await fetch(
    `${sbUrl}/rest/v1/contact_jobs?on_conflict=contact_id,job_id,role`,
    {
      method: 'POST',
      headers: { ...sbHeaders(sbKey), 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(pivotRows),
    }
  );
}

async function patchEncircleContractorId(env, encircleClaimId, clm) {
  try {
    const res = await fetch(
      `https://api.encircleapp.com/v1/property_claims/${encircleClaimId}`,
      { method: 'PATCH', headers: encircleHeaders(env), body: JSON.stringify({ contractor_identifier: clm }) }
    );
    if (!res.ok) return { ok: false, error: `Encircle PATCH ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function logWorkerRunStart(sbUrl, sbKey) {
  const res = await fetch(`${sbUrl}/rest/v1/worker_runs`, {
    method: 'POST',
    headers: { ...sbHeaders(sbKey), 'Prefer': 'return=representation' },
    body: JSON.stringify({
      worker_name: 'encircle-backfill',
      status: 'started',
      started_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) return null;
  const [row] = await res.json();
  return row?.id || null;
}

async function logWorkerRunFinish(sbUrl, sbKey, runId, patch) {
  if (!runId) return;
  await fetch(`${sbUrl}/rest/v1/worker_runs?id=eq.${runId}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(sbKey), 'Prefer': 'return=minimal' },
    body: JSON.stringify(patch),
  });
}

async function checkConcurrentRun(sbUrl, sbKey) {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const res = await fetch(
    `${sbUrl}/rest/v1/worker_runs?worker_name=eq.encircle-backfill&status=eq.started&started_at=gte.${encodeURIComponent(cutoff)}&limit=1&select=id,started_at`,
    { headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

async function bustPostgrestCache(sbUrl, sbKey) {
  try {
    await fetch(`${sbUrl}/rest/v1/rpc/bust_postgrest_cache`, {
      method: 'POST',
      headers: sbHeaders(sbKey),
      body: '{}',
    });
  } catch { /* non-fatal */ }
}

// ── Core per-claim processor ──────────────────────────────────────────────────
async function processClaim(ctx, claim, opts) {
  const encId = String(claim.id);
  const existingRows = ctx.existingJobsMap.get(encId) || [];
  const existing = {
    claim_id:           existingRows.find(r => r.claim_id)?.claim_id || null,
    primary_contact_id: existingRows.find(r => r.primary_contact_id)?.primary_contact_id || null,
    divisions_present:  [...new Set(existingRows.map(r => r.division))],
    count:              existingRows.length,
  };
  const isFullyImported = existing.count > 0
    && existingRows.every(r => r.claim_id && r.primary_contact_id);
  const isOrphan = existing.count > 0
    && existingRows.some(r => !r.claim_id || !r.primary_contact_id);

  // Step A — skip already-imported
  if (isFullyImported && opts.skipExisting) {
    return { encircle_claim_id: encId, action: 'skip', reason: 'already_imported',
             divisions_already_present: existing.divisions_present };
  }
  if (isOrphan && !opts.repairOrphans) {
    return { encircle_claim_id: encId, action: 'skip', reason: 'orphan_repair_disabled',
             divisions_already_present: existing.divisions_present };
  }

  // Step B — contact
  const phone = normalizePhone(claim.policyholder_phone_number);
  if (!phone) {
    if (opts.skipNoPhone) {
      return { encircle_claim_id: encId, action: 'skip', reason: 'no_phone',
               policyholder_name: claim.policyholder_name };
    }
    return { encircle_claim_id: encId, action: 'error',
             error_message: 'phone required (contacts.phone NOT NULL)', step: 'contact' };
  }

  let contactId = existing.primary_contact_id;
  let contactCreated = false;
  let contactReusedFromDifferentName = false;

  if (!contactId) {
    const hitPhone = await findContactByPhone(ctx.sbUrl, ctx.sbKey, phone);
    if (hitPhone) {
      contactId = hitPhone.id;
      if (hitPhone.name && claim.policyholder_name
          && hitPhone.name.trim().toLowerCase() !== claim.policyholder_name.trim().toLowerCase()) {
        contactReusedFromDifferentName = true;
      }
    } else if (claim.policyholder_email_address) {
      const hitEmail = await findContactByEmail(ctx.sbUrl, ctx.sbKey, claim.policyholder_email_address);
      if (hitEmail) contactId = hitEmail.id;
    }
    if (!contactId) {
      if (ctx.dryRun) {
        contactId = '<dry-run-new-contact>';
        contactCreated = true;
      } else {
        contactId = await insertContact(ctx.sbUrl, ctx.sbKey, {
          name: claim.policyholder_name,
          phone,
          email: claim.policyholder_email_address,
        });
        contactCreated = true;
        const parsed = parseAddressParts(claim.full_address);
        if (parsed.address) await insertContactAddress(ctx.sbUrl, ctx.sbKey, contactId, parsed);
      }
    }
  }

  // Step C — claim
  const parsed = parseAddressParts(claim.full_address);
  let claimId = existing.claim_id;
  let clmNumber = null;
  let claimCreated = false;

  if (!claimId) {
    if (ctx.dryRun) {
      claimId = '<dry-run-new-claim>';
      clmNumber = '<dry-run-CLM>';
      claimCreated = true;
    } else {
      const row = await insertClaim(ctx.sbUrl, ctx.sbKey, {
        contact_id: contactId,
        insurance_carrier:      claim.insurance_company_name || null,
        insurance_claim_number: claim.insurer_identifier      || null,
        policy_number:          claim.policy_number           || null,
        date_of_loss:           claim.date_of_loss            || null,
        loss_address:           parsed.address                || null,
        loss_city:              parsed.city                   || null,
        loss_state:             parsed.state                  || 'UT',
        loss_zip:               parsed.zip                    || null,
        loss_type:              normalizeTypeOfLoss(claim.type_of_loss) || 'water',
      });
      claimId = row.id;
      clmNumber = row.claim_number;
      claimCreated = true;
    }
  }

  // Step D — divisions
  const targetDivisions = opts.divisionStrategy === 'smart'
    ? mapTypeOfLossToDivisions(claim.type_of_loss)
    : (opts.divisions && opts.divisions.length ? opts.divisions : ['water', 'reconstruction']);

  // Union with already-present so orphan repair patches existing rows with claim_id + primary_contact_id
  const divisionsToUpsert = [...new Set([...targetDivisions, ...existing.divisions_present])];

  // Step E — upsert jobs
  const jobRows = divisionsToUpsert.map(division => ({
    claim_id:              claimId,
    primary_contact_id:    contactId,
    encircle_claim_id:     encId,
    division,
    insured_name:          claim.policyholder_name          || null,
    address:               parsed.address                   || null,
    city:                  parsed.city                      || null,
    state:                 parsed.state                     || 'UT',
    zip:                   parsed.zip                       || null,
    client_email:          claim.policyholder_email_address || null,
    client_phone:          phone,
    insurance_company:     claim.insurance_company_name     || null,
    claim_number:          claim.insurer_identifier         || null, // insurance claim #, not CLM
    adjuster_name:         claim.adjuster_name              || null,
    policy_number:         claim.policy_number              || null,
    date_of_loss:          claim.date_of_loss               || null,
    type_of_loss:          claim.type_of_loss               || null,
    cat_code:              claim.cat_code                   || null,
    broker_agent:          claim.broker_or_agent_name       || null,
    project_manager:       claim.project_manager_name       || null,
    encircle_summary:      claim.loss_details || claim.summary || null,
    carrier_identifier:    claim.carrier_identifier         || null,
    assignment_identifier: claim.assignment_identifier      || null,
    encircle_created_at:   claim.created_at                 || null,
    phase:                 'lead',
    source:                'insurance',
  }));

  let upsertedJobs = [];
  if (!ctx.dryRun) {
    upsertedJobs = await upsertJobsBatch(ctx.sbUrl, ctx.sbKey, jobRows);

    // Pivot rows
    if (upsertedJobs.length) {
      const pivotRows = upsertedJobs.map(j => ({
        contact_id: contactId,
        job_id:     j.id,
        role:       'primary_client',
        is_primary: true,
      }));
      await upsertContactJobPivotBatch(ctx.sbUrl, ctx.sbKey, pivotRows);
    }
  }

  // Step F — writeback CLM
  let writeback = { attempted: false, ok: false };
  if (claimCreated && clmNumber && !ctx.dryRun) {
    const decide = deriveWriteBackDecision(claim, clmNumber, opts.writebackClm);
    if (decide.do) {
      writeback.attempted = true;
      const r = await patchEncircleContractorId(ctx.env, encId, clmNumber);
      writeback.ok = r.ok;
      if (!r.ok) writeback.error = r.error;
    } else {
      writeback.skipped_reason = decide.reason;
    }
  }

  const action = isOrphan ? 'repair' : (existing.count > 0 ? 'update' : 'new');

  return {
    encircle_claim_id: encId,
    action,
    policyholder_name: claim.policyholder_name,
    date_of_loss:      claim.date_of_loss,
    type_of_loss:      claim.type_of_loss,
    contact_id:        contactId,
    contact_created:   contactCreated,
    contact_reused_different_name: contactReusedFromDifferentName,
    claim_id:          claimId,
    claim_number:      clmNumber || (existing.claim_id ? '<existing>' : null),
    claim_created:     claimCreated,
    divisions_to_create:      targetDivisions,
    divisions_already_present: existing.divisions_present,
    jobs:             upsertedJobs.map(j => ({ id: j.id, job_number: j.job_number, division: j.division })),
    writeback,
    phone_ok:         !!phone,
    contractor_identifier_in_encircle: claim.contractor_identifier || null,
  };
}

// ── Main handler (shared by GET and POST) ─────────────────────────────────────
async function runBackfill(request, env, { method }) {
  const sbUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const sbKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY
             || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey) return jsonResponse({ error: 'Missing Supabase env vars' }, 500, request, env);
  if (!env.ENCIRCLE_API_KEY) return jsonResponse({ error: 'Missing ENCIRCLE_API_KEY' }, 500, request, env);

  // Parse options from query (GET) or body (POST)
  let opts;
  if (method === 'GET') {
    const url = new URL(request.url);
    const q = url.searchParams;
    opts = {
      from:             q.get('from')             || defaultFromISO(),
      to:               q.get('to')               || new Date().toISOString().slice(0, 10),
      dateField:        q.get('date_field')       || 'date_of_loss',
      max:              parseInt(q.get('max')     || '500', 10),
      divisions:        (q.get('divisions')       || 'water,reconstruction').split(',').map(s => s.trim()).filter(Boolean),
      divisionStrategy: q.get('division_strategy') || 'smart',
      dryRun:           true, // GET is always dry-run
      skipExisting:     q.get('skip_existing')    !== 'false',
      repairOrphans:    q.get('repair_orphans')   !== 'false',
      skipNoPhone:      q.get('skip_no_phone')    !== 'false',
      writebackClm:     false, // no writeback on preview
    };
  } else {
    const body = await request.json();
    opts = {
      from:             body.from              || defaultFromISO(),
      to:               body.to                || new Date().toISOString().slice(0, 10),
      dateField:        body.date_field        || 'date_of_loss',
      max:              parseInt(body.max      || 500, 10),
      divisions:        body.divisions         || ['water', 'reconstruction'],
      divisionStrategy: body.division_strategy || 'smart',
      dryRun:           body.dry_run           === true,
      skipExisting:     body.skip_existing     !== false,
      repairOrphans:    body.repair_orphans    !== false,
      skipNoPhone:      body.skip_no_phone     !== false,
      writebackClm:     body.writeback_clm     !== false,
    };
  }

  // Concurrency guard (skip for dry-run)
  if (!opts.dryRun) {
    const active = await checkConcurrentRun(sbUrl, sbKey);
    if (active) {
      return jsonResponse({
        error: 'Another encircle-backfill run is in progress',
        active_run_id: active.id,
        started_at:    active.started_at,
      }, 409, request, env);
    }
  }

  const runStartMs = Date.now();
  const workerRunId = opts.dryRun ? null : await logWorkerRunStart(sbUrl, sbKey);

  try {
    // 1. Pull claims from Encircle window
    const { claims, pagesFetched, hitMax, earliestSeen } = await fetchEncircleWindow({
      env, fromISO: opts.from, toISO: opts.to, dateField: opts.dateField, max: opts.max,
    });

    // 2. Batch-load existing jobs for these encircle_claim_ids
    const ids = claims.map(c => String(c.id));
    const existingJobsMap = await fetchJobsForEncircleIds(sbUrl, sbKey, ids);

    // 3. Process each claim (try/catch per claim)
    const ctx = { sbUrl, sbKey, env, existingJobsMap, dryRun: opts.dryRun };
    const results = [];
    const errors = [];
    for (const claim of claims) {
      try {
        const r = await processClaim(ctx, claim, opts);
        results.push(r);
      } catch (e) {
        errors.push({ encircle_claim_id: String(claim.id), step: 'process', error_message: e.message });
      }
    }

    // 4. Aggregate counts
    const counts = aggregateCounts(results);
    counts.errors = errors.length;

    // 5. Bust cache after real writes
    if (!opts.dryRun && (counts.imported > 0 || counts.repaired > 0)) {
      await bustPostgrestCache(sbUrl, sbKey);
    }

    const durationMs = Date.now() - runStartMs;

    // 6. Log completion
    if (workerRunId) {
      await logWorkerRunFinish(sbUrl, sbKey, workerRunId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        records_processed: results.length,
      });
    }

    // 7. Build response
    if (opts.dryRun) {
      return jsonResponse({
        dry_run: true,
        window: { from: opts.from, to: opts.to, date_field: opts.dateField },
        cursor: { pages_fetched: pagesFetched, hit_max: hitMax, earliest_claim_date: earliestSeen },
        totals: {
          total_in_window:           results.length,
          already_fully_imported:    counts.skipped_already_imported,
          orphans_to_repair:         counts.repaired,
          new_imports:               counts.imported,
          skipped_no_phone:          counts.skipped_no_phone,
          estimated_contacts_new:    counts.contacts_created,
          estimated_contacts_reused: counts.contacts_reused,
          estimated_claims_new:      counts.claims_created,
          estimated_claims_reused:   counts.claims_reused,
          estimated_jobs_new:        counts.jobs_divisions_requested,
        },
        claims: results,
      }, 200, request, env);
    }

    // Non-dry-run: include 5 random samples for spot-checking
    const processedWithJobs = results.filter(r => r.jobs && r.jobs.length > 0);
    const samples = pickRandom(processedWithJobs, 5);

    return jsonResponse({
      dry_run: false,
      worker_run_id: workerRunId,
      window: { from: opts.from, to: opts.to, date_field: opts.dateField },
      cursor: { pages_fetched: pagesFetched, hit_max: hitMax, earliest_claim_date: earliestSeen },
      duration_ms: durationMs,
      counts,
      samples,
      errors,
    }, 200, request, env);

  } catch (e) {
    if (workerRunId) {
      await logWorkerRunFinish(sbUrl, sbKey, workerRunId, {
        status: 'error',
        completed_at: new Date().toISOString(),
        error_message: e.message?.slice(0, 1000) || 'unknown',
      });
    }
    console.error('encircle-backfill error:', e);
    return jsonResponse({ error: e.message }, 500, request, env);
  }
}

function aggregateCounts(results) {
  const c = {
    total_processed:            results.length,
    imported:                   0,
    repaired:                   0,
    skipped:                    0,
    skipped_no_phone:           0,
    skipped_already_imported:   0,
    skipped_other:              0,
    contacts_created:           0,
    contacts_reused:            0,
    contacts_reused_different_name: 0,
    claims_created:             0,
    claims_reused:              0,
    jobs_divisions_requested:   0,
    writebacks_attempted:       0,
    writebacks_ok:              0,
    writebacks_skipped_existing_cid: 0,
  };
  for (const r of results) {
    if (r.action === 'skip') {
      c.skipped++;
      if (r.reason === 'no_phone') c.skipped_no_phone++;
      else if (r.reason === 'already_imported') c.skipped_already_imported++;
      else c.skipped_other++;
      continue;
    }
    if (r.action === 'new')    c.imported++;
    if (r.action === 'repair') c.repaired++;
    if (r.action === 'update') c.imported++; // existing rows getting new divisions
    if (r.contact_created)     c.contacts_created++;
    else                       c.contacts_reused++;
    if (r.contact_reused_different_name) c.contacts_reused_different_name++;
    if (r.claim_created)       c.claims_created++;
    else                       c.claims_reused++;
    c.jobs_divisions_requested += (r.divisions_to_create?.length || 0);
    if (r.writeback?.attempted) c.writebacks_attempted++;
    if (r.writeback?.ok)        c.writebacks_ok++;
    if (r.writeback?.skipped_reason === 'encircle_has_existing_contractor_id') {
      c.writebacks_skipped_existing_cid++;
    }
  }
  return c;
}

function pickRandom(arr, n) {
  if (arr.length <= n) return arr;
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function defaultFromISO() {
  return new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10);
}

// ── Request handlers ──────────────────────────────────────────────────────────
export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const auth = await requireAuth(context.request, context.env);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, context.request, context.env);
  return runBackfill(context.request, context.env, { method: 'GET' });
}

export async function onRequestPost(context) {
  const auth = await requireAuth(context.request, context.env);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, context.request, context.env);
  return runBackfill(context.request, context.env, { method: 'POST' });
}
