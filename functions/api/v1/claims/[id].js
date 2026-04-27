// GET /api/v1/claims/{id}
// Claim detail with linked jobs and primary contact. Read-only. Bearer-token gated.

import { supabase } from '../../../lib/supabase.js';
import { requireApiKey, apiJson, apiError } from '../../../lib/api-auth.js';

const CLAIM_FIELDS = [
  'id', 'claim_number', 'contact_id', 'date_of_loss', 'status',
  'insurance_carrier', 'policy_number', 'adjuster_name', 'adjuster_phone',
  'adjuster_email', 'type_of_loss', 'loss_address', 'loss_city',
  'loss_state', 'loss_zip', 'created_at', 'updated_at',
].join(',');

const JOB_SUMMARY_FIELDS = [
  'id', 'job_number', 'insured_name', 'division', 'phase', 'status',
  'address', 'city', 'state', 'zip', 'date_of_loss', 'estimated_value',
  'approved_value', 'created_at',
].join(',');

const CONTACT_FIELDS = 'id,name,phone,email,role';

export async function onRequestGet(context) {
  const { request, env, params } = context;

  const fail = requireApiKey(request, env);
  if (fail) return fail;

  const id = params.id;
  if (!id) return apiError('Missing claim id', 400);

  try {
    const db = supabase(env);
    const [claim] = await db.select('claims', `id=eq.${encodeURIComponent(id)}&select=${CLAIM_FIELDS}`);
    if (!claim) return apiError('Claim not found', 404);

    const [jobs, contact] = await Promise.all([
      db.select('jobs', `claim_id=eq.${encodeURIComponent(id)}&status=neq.deleted&order=created_at.desc&select=${JOB_SUMMARY_FIELDS}`),
      claim.contact_id
        ? db.select('contacts', `id=eq.${encodeURIComponent(claim.contact_id)}&select=${CONTACT_FIELDS}`).then(r => r[0] || null)
        : Promise.resolve(null),
    ]);

    return apiJson({ data: { ...claim, contact, jobs } });
  } catch (err) {
    console.error('GET /api/v1/claims/[id]:', err);
    return apiError(err.message || 'Internal error', 500);
  }
}
