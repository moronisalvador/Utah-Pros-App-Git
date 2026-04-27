// GET /api/v1/jobs/{id}
// Job detail with linked claim, primary contact, and all contacts via contact_jobs.
// Read-only. Bearer-token gated.

import { supabase } from '../../../lib/supabase.js';
import { requireApiKey, apiJson, apiError } from '../../../lib/api-auth.js';

const CLAIM_SUMMARY_FIELDS = 'id,claim_number,date_of_loss,status,insurance_carrier,policy_number';
const CONTACT_FIELDS = 'id,name,phone,email,role';

export async function onRequestGet(context) {
  const { request, env, params } = context;

  const fail = requireApiKey(request, env);
  if (fail) return fail;

  const id = params.id;
  if (!id) return apiError('Missing job id', 400);

  try {
    const db = supabase(env);
    const [job] = await db.select('jobs', `id=eq.${encodeURIComponent(id)}`);
    if (!job) return apiError('Job not found', 404);

    const [claim, primaryContact, links] = await Promise.all([
      job.claim_id
        ? db.select('claims', `id=eq.${encodeURIComponent(job.claim_id)}&select=${CLAIM_SUMMARY_FIELDS}`).then(r => r[0] || null)
        : Promise.resolve(null),
      job.primary_contact_id
        ? db.select('contacts', `id=eq.${encodeURIComponent(job.primary_contact_id)}&select=${CONTACT_FIELDS}`).then(r => r[0] || null)
        : Promise.resolve(null),
      db.select('contact_jobs', `job_id=eq.${encodeURIComponent(id)}&select=role,is_primary,contact_id`),
    ]);

    let contacts = [];
    if (links?.length) {
      const ids = [...new Set(links.map(l => l.contact_id).filter(Boolean))];
      if (ids.length) {
        const rows = await db.select('contacts', `id=in.(${ids.join(',')})&select=${CONTACT_FIELDS}`);
        const byId = Object.fromEntries(rows.map(r => [r.id, r]));
        contacts = links.map(l => ({
          ...byId[l.contact_id],
          link_role: l.role,
          is_primary: l.is_primary,
        })).filter(c => c.id);
      }
    }

    return apiJson({ data: { ...job, claim, primary_contact: primaryContact, contacts } });
  } catch (err) {
    console.error('GET /api/v1/jobs/[id]:', err);
    return apiError(err.message || 'Internal error', 500);
  }
}
