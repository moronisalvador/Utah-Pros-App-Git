// GET /api/v1/claims
// List insurance claims. Read-only. Bearer-token gated.
//
// Query params (all optional):
//   status     — filter by claim status (exact match)
//   q          — fuzzy match against claim_number or insurance_carrier
//   limit      — default 25, max 100
//   offset     — default 0
//   since      — ISO date; only claims with date_of_loss >= since
//   until      — ISO date; only claims with date_of_loss <= until

import { supabase } from '../../lib/supabase.js';
import { requireApiKey, apiJson, apiError } from '../../lib/api-auth.js';

const CLAIM_FIELDS = [
  'id', 'claim_number', 'contact_id', 'date_of_loss', 'status',
  'insurance_carrier', 'policy_number', 'adjuster_name', 'adjuster_phone',
  'adjuster_email', 'type_of_loss', 'loss_address', 'loss_city',
  'loss_state', 'loss_zip', 'created_at', 'updated_at',
].join(',');

export async function onRequestGet(context) {
  const { request, env } = context;

  const fail = requireApiKey(request, env);
  if (fail) return fail;

  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const q = url.searchParams.get('q');
    const since = url.searchParams.get('since');
    const until = url.searchParams.get('until');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '25', 10) || 25, 100);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;

    const parts = [`select=${CLAIM_FIELDS}`, 'order=created_at.desc', `limit=${limit}`, `offset=${offset}`];
    if (status) parts.push(`status=eq.${encodeURIComponent(status)}`);
    if (since)  parts.push(`date_of_loss=gte.${encodeURIComponent(since)}`);
    if (until)  parts.push(`date_of_loss=lte.${encodeURIComponent(until)}`);
    if (q) {
      const safe = q.replace(/[(),]/g, '');
      parts.push(`or=(claim_number.ilike.*${encodeURIComponent(safe)}*,insurance_carrier.ilike.*${encodeURIComponent(safe)}*)`);
    }

    const db = supabase(env);
    const rows = await db.select('claims', parts.join('&'));

    return apiJson({ data: rows, limit, offset, count: rows.length });
  } catch (err) {
    console.error('GET /api/v1/claims:', err);
    return apiError(err.message || 'Internal error', 500);
  }
}
