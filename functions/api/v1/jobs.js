// GET /api/v1/jobs
// List jobs. Read-only. Bearer-token gated.
//
// Query params (all optional):
//   status     — filter by job status (exact, defaults to excluding deleted)
//   phase      — filter by phase key (exact)
//   division   — filter by division (exact)
//   q          — fuzzy match on job_number or insured_name
//   claim_id   — only jobs linked to a given claim
//   limit      — default 25, max 100
//   offset     — default 0

import { supabase } from '../../lib/supabase.js';
import { requireApiKey, apiJson, apiError } from '../../lib/api-auth.js';

const JOB_LIST_FIELDS = [
  'id', 'job_number', 'insured_name', 'division', 'phase', 'status',
  'address', 'city', 'state', 'zip', 'claim_id', 'claim_number',
  'insurance_company', 'date_of_loss', 'received_date',
  'target_completion', 'actual_completion', 'estimated_value',
  'approved_value', 'invoiced_value', 'priority', 'created_at',
  'updated_at',
].join(',');

export async function onRequestGet(context) {
  const { request, env } = context;

  const fail = requireApiKey(request, env);
  if (fail) return fail;

  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const phase = url.searchParams.get('phase');
    const division = url.searchParams.get('division');
    const claimId = url.searchParams.get('claim_id');
    const q = url.searchParams.get('q');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '25', 10) || 25, 100);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;

    const parts = [`select=${JOB_LIST_FIELDS}`, 'order=created_at.desc', `limit=${limit}`, `offset=${offset}`];

    if (status) {
      parts.push(`status=eq.${encodeURIComponent(status)}`);
    } else {
      parts.push('status=neq.deleted');
    }
    if (phase)    parts.push(`phase=eq.${encodeURIComponent(phase)}`);
    if (division) parts.push(`division=eq.${encodeURIComponent(division)}`);
    if (claimId)  parts.push(`claim_id=eq.${encodeURIComponent(claimId)}`);
    if (q) {
      const safe = q.replace(/[(),]/g, '');
      parts.push(`or=(job_number.ilike.*${encodeURIComponent(safe)}*,insured_name.ilike.*${encodeURIComponent(safe)}*)`);
    }

    const db = supabase(env);
    const rows = await db.select('jobs', parts.join('&'));

    return apiJson({ data: rows, limit, offset, count: rows.length });
  } catch (err) {
    console.error('GET /api/v1/jobs:', err);
    return apiError(err.message || 'Internal error', 500);
  }
}
