/**
 * ════════════════════════════════════════════════
 * FILE: contractor-compliance-reminders.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Runs the daily contractor renewal check only when its two owner-controlled
 *   switches are on. It reserves each email before attempting a send.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  auth.js, worker-runs.js, contractor-compliance-delivery.js
 *   Data:      reads → contractor_compliance_profiles, contractor_compliance_documents
 *              writes → contractor_compliance_requests, contractor_compliance_request_deliveries, worker_runs
 *
 * NOTES / GOTCHAS:
 *   - A token is derived from a secret and stable identity, never stored raw.
 * ════════════════════════════════════════════════
 */
import { checkCronSecret } from '../lib/auth.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';
import { withRunRecording } from '../lib/worker-runs.js';
import { deterministicCapabilityToken, remindersEnabled, tokenDigest } from '../lib/contractor-compliance.js';
import { deliverClaimedComplianceRequest } from '../lib/contractor-compliance-delivery.js';

export const WORKER_NAME = 'contractor-compliance-reminders';
const MAX_CANDIDATES = 100;
function response(body, status) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }

export async function runContractorComplianceReminders(env, db) {
  if (String(env.CONTRACTOR_COMPLIANCE_TOKEN_SECRET || '').length < 32) {
    throw new Error('Contractor compliance token secret is not configured');
  }
  // Denver calendar-year rollover is durable and idempotent; do it before
  // evaluating annual W-9 candidates so a January run never uses last year's rule.
  await db.rpc('contractor_compliance_advance_w9_year');
  const candidates = await db.rpc('contractor_compliance_reminder_candidates', { p_limit: MAX_CANDIDATES });
  let processed = 0;
  const counts = { sent: 0, skipped: 0, failed: 0, ambiguous: 0 };
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    let claim;
    try {
      // A raw capability exists only in this request's memory. The database gets
      // its digest when it creates the per-delivery request; it cannot recover it.
      const rawToken = await deterministicCapabilityToken(
        env.CONTRACTOR_COMPLIANCE_TOKEN_SECRET,
        candidate.request_identity,
      );
      if (!rawToken) throw new Error('Invalid contractor compliance reminder identity');
      const created = await db.rpc('contractor_compliance_create_request', {
        p_actor_employee_id: null,
        p_contractor_id: candidate.contractor_id,
        p_document_types: candidate.document_types,
        p_recipient_email: candidate.recipient_email || null,
        p_expires_in_days: 30,
        p_source: 'automated_reminder',
        p_token_digest: await tokenDigest(rawToken),
        p_request_identity: candidate.request_identity,
      });
      const createdRequest = Array.isArray(created) ? created[0] : created;
      claim = await db.rpc('contractor_compliance_claim_delivery', {
        p_request_id: createdRequest?.request_id || createdRequest?.id,
        p_stage: candidate.stage,
      });
      const claimed = Array.isArray(claim) ? claim[0] : claim;
      // A duplicate or an ambiguous earlier attempt returns no fresh claim.
      // Never call the provider in that state.
      if (!claimed?.delivery_id) continue;
      const result = await deliverClaimedComplianceRequest(
        db,
        env,
        { ...claimed, requirement_label: candidate.requirement_label, due_label: candidate.due_label },
        { uploadToken: rawToken },
      );
      if (result.recordsProcessed) processed += result.recordsProcessed;
      if (Object.hasOwn(counts, result.outcome)) counts[result.outcome] += 1;
    } catch {
      // Do not retry inside this run. A subsequent claim determines whether the
      // provider outcome is safe to retry or requires reconciliation.
      counts.failed += 1;
    }
  }
  return { recordsProcessed: processed, meta: counts };
}

export async function onRequestPost({ request, env }) {
  if (!remindersEnabled(env)) return response({ error: 'Not found' }, 404);
  const db = supabase(env, fetchWithTimeout);
  if (!(await checkCronSecret(request, db))) return response({ error: 'Unauthorized' }, 401);
  try {
    const result = await withRunRecording(db, WORKER_NAME, () => runContractorComplianceReminders(env, db));
    return response({ ok: true, processed: result.recordsProcessed }, 200);
  } catch {
    return response({ error: 'Reminder processing failed' }, 503);
  }
}
