// POST /api/sync-encircle
// GET  /api/sync-encircle (for easy browser testing)
// Fetches recent claims from Encircle, upserts into Supabase jobs + creates contacts.

import { handleOptions, jsonResponse } from '../lib/cors.js';

function cleanJobNumber(val) {
  if (!val) return null;
  if (val.length > 20) return null;
  if (val.includes(' ') && !/\d/.test(val)) return null;
  return val;
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  if (digits.length > 0) return '+' + digits;
  return null;
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

async function doSync(request, env) {
  const sbUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const sbKey = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  const encircleKey = env.ENCIRCLE_API_KEY;

  if (!sbUrl || !sbKey) {
    return jsonResponse({ error: 'Missing SUPABASE_URL or key in env' }, 500, request, env);
  }
  if (!encircleKey) {
    return jsonResponse({ error: 'Missing ENCIRCLE_API_KEY in env' }, 500, request, env);
  }

  // 1. Fetch claims from Encircle
  const encRes = await fetch(
    'https://api.encircleapp.com/v1/property_claims?limit=15&order=newest',
    {
      headers: {
        'Authorization': `Bearer ${encircleKey}`,
        'Content-Type': 'application/json',
        'X-Encircle-Attribution': 'UtahProsRestorationApp',
      },
    }
  );

  if (!encRes.ok) {
    const errText = await encRes.text();
    return jsonResponse({ error: `Encircle API ${encRes.status}`, detail: errText.slice(0, 300) }, 502, request, env);
  }

  const encData = await encRes.json();
  const claims = Array.isArray(encData)
    ? encData
    : encData.list || encData.property_claims || encData.results || encData.claims || encData.data || [];

  if (!claims.length) {
    return jsonResponse({ jobs: [], synced: 0, message: 'No claims found', debug_keys: Object.keys(encData) }, 200, request, env);
  }

  // 2. Map Encircle → jobs table
  const jobRows = claims.map(c => ({
    encircle_claim_id:     String(c.id),
    insured_name:          c.policyholder_name || null,
    address:               c.full_address || null,
    job_number:            cleanJobNumber(c.contractor_identifier),
    client_email:          c.policyholder_email_address || null,
    client_phone:          c.policyholder_phone_number || null,
    insurance_company:     c.insurance_company_name || null,
    policy_number:         c.policy_number || null,
    date_of_loss:          c.date_of_loss || null,
    carrier_identifier:    c.carrier_identifier || null,
    assignment_identifier: c.assignment_identifier || null,
    type_of_loss:          c.type_of_loss || null,
    adjuster:              c.adjuster || null,
    project_manager:       c.project_manager || null,
    broker_agent:          c.broker_agent || null,
    encircle_summary:      c.summary || null,
    division:              'reconstruction',
    encircle_created_at:   c.created_at || null,
  }));

  // 3. Upsert jobs
  const upsertRes = await fetch(
    `${sbUrl}/rest/v1/jobs?on_conflict=encircle_claim_id`,
    {
      method: 'POST',
      headers: {
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(jobRows),
    }
  );

  if (!upsertRes.ok) {
    const err = await upsertRes.text();
    return jsonResponse({ error: 'Supabase upsert failed', detail: err.slice(0, 300) }, 500, request, env);
  }

  const upsertedJobs = await upsertRes.json();

  // 4. Create contacts for each job with a name + phone or email
  let contactsCreated = 0;
  for (const job of upsertedJobs) {
    if (!job.insured_name) continue;
    const phone = normalizePhone(job.client_phone);

    // Skip if no identifying info at all
    if (!phone && !job.client_email) continue;

    // If we have a phone, check for existing contact to avoid duplicates
    if (phone) {
      const checkRes = await fetch(
        `${sbUrl}/rest/v1/contacts?phone=eq.${encodeURIComponent(phone)}&limit=1`,
        { headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` } }
      );
      const existing = checkRes.ok ? await checkRes.json() : [];
      if (existing.length > 0) continue;
    }

    // Bug fix: contacts table has no 'address' column — addresses go in contact_addresses.
    // Bug fix: never use 'no-phone' as a phone value — it has a unique constraint.
    //          If no phone, only create if there's an email to identify the contact.
    if (!phone && !job.client_email) continue;

    const contactRes = await fetch(`${sbUrl}/rest/v1/contacts`, {
      method: 'POST',
      headers: {
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        name: job.insured_name,
        phone: phone || null,          // null if no phone — never 'no-phone'
        email: job.client_email || null,
        role: 'homeowner',
        // address intentionally omitted — not a column on contacts
      }),
    });

    if (contactRes.ok) {
      const [newContact] = await contactRes.json();
      contactsCreated++;

      // Insert address into contact_addresses if the job has one
      if (newContact?.id && job.address) {
        await fetch(`${sbUrl}/rest/v1/contact_addresses`, {
          method: 'POST',
          headers: {
            'apikey': sbKey,
            'Authorization': `Bearer ${sbKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({
            contact_id: newContact.id,
            label: 'service',
            address: job.address,
            city: job.city || null,
            state: job.state || null,
            zip: job.zip || null,
            is_billing: true,
          }),
        });
      }
    }
  }

  return jsonResponse({
    synced: upsertedJobs.length,
    contacts_created: contactsCreated,
    jobs: upsertedJobs.map(j => ({
      id: j.id,
      insured_name: j.insured_name,
      address: j.address,
      division: j.division,
      job_number: j.job_number,
    })),
  }, 200, request, env);
}

// Support both POST and GET for easy testing
export async function onRequestPost(context) {
  try {
    return await doSync(context.request, context.env);
  } catch (e) {
    return jsonResponse({ error: e.message, stack: e.stack?.slice(0, 300) }, 500, context.request, context.env);
  }
}

export async function onRequestGet(context) {
  try {
    return await doSync(context.request, context.env);
  } catch (e) {
    return jsonResponse({ error: e.message, stack: e.stack?.slice(0, 300) }, 500, context.request, context.env);
  }
}
