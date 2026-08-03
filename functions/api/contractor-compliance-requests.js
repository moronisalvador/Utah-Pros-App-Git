/**
 * ════════════════════════════════════════════════
 * FILE: contractor-compliance-requests.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets authorized office staff review documents and control contractor upload
 *   requests. It records a reason for sensitive changes and never exposes links.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  auth.js, supabase.js, contractor-compliance-delivery.js
 *   Data:      reads → employees
 *              writes → contractor_compliance_documents, contractor_compliance_requests, contractor_compliance_activity
 *
 * NOTES / GOTCHAS:
 *   - A resend replaces the old link instead of recovering a stored token.
 * ════════════════════════════════════════════════
 */
import { corsHeaders, handleOptions } from '../lib/cors.js';
import { requireRole } from '../lib/auth.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';
import { complianceEnabled, deterministicCapabilityToken, remindersEnabled, tokenDigest, validDocumentType, validUuid } from '../lib/contractor-compliance.js';
import { deliverClaimedComplianceRequest } from '../lib/contractor-compliance-delivery.js';

function response(body, status, cors = {}) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors } }); }
export function onRequestOptions({ request, env }) { return handleOptions(request, env); }

export async function onRequestPost({ request, env }) {
  const cors = corsHeaders(request, env);
  if (!complianceEnabled(env)) return response({ error: 'Not found' }, 404, cors);
  const db = supabase(env, fetchWithTimeout);
  const auth = await requireRole(request, env, db, ['admin', 'office'], fetchWithTimeout);
  if (auth.error) return response({ error: auth.error }, auth.status || 403, cors);
  let body;
  try { body = await request.json(); } catch { return response({ error: 'Invalid request body' }, 400, cors); }
  const action = String(body?.action || '');
  try {
    if (action === 'review') {
      if (!validUuid(body.document_id) || !['accepted', 'rejected'].includes(body.review_state)) return response({ error: 'Invalid review request' }, 400, cors);
      const result = await db.rpc('contractor_compliance_review_document', {
        p_actor_employee_id: auth.employee.id,
        p_document_id: body.document_id,
        p_review_state: body.review_state,
        p_rejection_reason: body.review_state === 'rejected' ? String(body.rejection_reason || '').slice(0, 500) : null,
      });
      return response({ document: result?.[0] || result || null }, 200, cors);
    }
    if (action === 'note') {
      if (!validUuid(body.contractor_id) || !String(body.note || '').trim()) return response({ error: 'Invalid note' }, 400, cors);
      await db.rpc('contractor_compliance_append_activity', {
        p_actor_employee_id: auth.employee.id,
        p_contractor_id: body.contractor_id,
        p_activity_type: 'note',
        p_note: String(body.note).trim().slice(0, 2000),
      });
      return response({ ok: true }, 201, cors);
    }
    if (action === 'create') {
      if (!validUuid(body.contractor_id) || !validUuid(body.operation_id) || !Array.isArray(body.document_types) || !body.document_types.length || !body.document_types.every(validDocumentType)) return response({ error: 'Invalid request' }, 400, cors);
      if (body.send_now === true && !remindersEnabled(env)) return response({ error: 'Email delivery is not enabled' }, 409, cors);
      const requestIdentity = `manual:${body.contractor_id}:${body.operation_id}`;
      const rawToken = await deterministicCapabilityToken(env.CONTRACTOR_COMPLIANCE_TOKEN_SECRET, requestIdentity);
      if (!rawToken) return response({ error: 'Secure request links are not configured' }, 503, cors);
      const digest = await tokenDigest(rawToken);
      const result = await db.rpc('contractor_compliance_create_request', {
        p_actor_employee_id: auth.employee.id,
        p_contractor_id: body.contractor_id,
        p_document_types: body.document_types,
        p_recipient_email: body.recipient_email || null,
        p_expires_in_days: Number.isInteger(body.expires_in_days) ? body.expires_in_days : 30,
        p_source: 'manual',
        p_token_digest: digest,
        p_request_identity: requestIdentity,
      });
      const created = result?.[0] || result || null;
      if (body.send_now === true) {
        const claim = await db.rpc('contractor_compliance_claim_delivery', {
          p_request_id: created?.request_id || created?.id,
          p_stage: 'manual_initial',
        });
        const claimed = Array.isArray(claim) ? claim[0] : claim;
        if (!claimed?.delivery_id) {
          return response({ request: created, sent: false, outcome: 'already_processed' }, 200, cors);
        }
        const outcome = await deliverClaimedComplianceRequest(db, env, claimed, { uploadToken: rawToken });
        if (outcome.outcome === 'sent') return response({ request: created, sent: true, outcome: 'sent', message: 'Secure request sent.' }, 201, cors);
        if (outcome.outcome === 'ambiguous') return response({ request: created, sent: false, outcome: 'ambiguous', message: 'Request saved; delivery needs reconciliation before retrying.' }, 202, cors);
        return response({ error: outcome.outcome === 'skipped' ? 'Request saved, but email is suppressed or unavailable.' : 'Request saved, but email delivery failed.', outcome: outcome.outcome }, outcome.outcome === 'skipped' ? 409 : 503, cors);
      }
      return response({ request: created }, 201, cors);
    }
    if (['pause', 'resume', 'revoke'].includes(action)) {
      if (!validUuid(body.request_id)) return response({ error: 'Invalid request' }, 400, cors);
      await db.rpc('contractor_compliance_mutate_request', {
        p_actor_employee_id: auth.employee.id,
        p_request_id: body.request_id,
        p_action: action,
        p_reason: body.reason ? String(body.reason).slice(0, 500) : null,
      });
      return response({ ok: true }, 200, cors);
    }
    if (['pause_reminders', 'resume_reminders'].includes(action)) {
      if (!validUuid(body.contractor_id)) return response({ error: 'Invalid contractor' }, 400, cors);
      if (action === 'pause_reminders' && !String(body.reason || '').trim()) return response({ error: 'A pause reason is required' }, 400, cors);
      await db.rpc('contractor_compliance_mutate_profile_requests', {
        p_actor_employee_id: auth.employee.id,
        p_contractor_id: body.contractor_id,
        p_action: action,
        p_reason: body.reason ? String(body.reason).slice(0, 500) : null,
      });
      return response({ ok: true }, 200, cors);
    }
    if (action === 'set_active') {
      if (!validUuid(body.contractor_id) || typeof body.is_active !== 'boolean' || !String(body.reason || '').trim()) {
        return response({ error: 'A contractor, active state, and reason are required' }, 400, cors);
      }
      await db.rpc('contractor_compliance_set_profile_active', {
        p_actor_employee_id: auth.employee.id,
        p_contractor_id: body.contractor_id,
        p_is_active: body.is_active,
        p_reason: String(body.reason).trim().slice(0, 500),
      });
      return response({ ok: true }, 200, cors);
    }
    if (action === 'resend') {
      if (!remindersEnabled(env)) return response({ error: 'Email delivery is not enabled' }, 409, cors);
      if (!validUuid(body.request_id) || !validUuid(body.operation_id)) return response({ error: 'A valid request and operation identity are required' }, 400, cors);
      // Existing rows retain only a digest. Resend is a deliberate rotation:
      // revoke the old capability, issue a new random capability, and never
      // attempt to reconstruct the old raw URL.
      const requestIdentity = `resend:${body.request_id}:${body.operation_id}`;
      const rawToken = await deterministicCapabilityToken(env.CONTRACTOR_COMPLIANCE_TOKEN_SECRET, requestIdentity);
      if (!rawToken) return response({ error: 'Secure request links are not configured' }, 503, cors);
      const replacement = await db.rpc('contractor_compliance_rotate_request', {
        p_actor_employee_id: auth.employee.id,
        p_old_request_id: body.request_id,
        p_token_digest: await tokenDigest(rawToken),
        p_request_identity: requestIdentity,
      });
      const rotated = Array.isArray(replacement) ? replacement[0] : replacement;
      const claim = await db.rpc('contractor_compliance_claim_delivery', {
        p_request_id: rotated?.request_id || rotated?.id,
        p_stage: 'manual_resend',
      });
      const claimed = Array.isArray(claim) ? claim[0] : claim;
      if (!claimed?.delivery_id) return response({ ok: true, outcome: 'already_processed' }, 200, cors);
      const outcome = await deliverClaimedComplianceRequest(db, env, claimed, { uploadToken: rawToken });
      if (outcome.outcome === 'sent') return response({ ok: true, outcome: 'sent', message: 'Secure request resent.' }, 200, cors);
      if (outcome.outcome === 'ambiguous') return response({ ok: false, outcome: 'ambiguous', message: 'Delivery needs reconciliation before retrying.' }, 202, cors);
      return response({ error: outcome.outcome === 'skipped' ? 'Email is suppressed or unavailable.' : 'Email delivery failed.', outcome: outcome.outcome }, outcome.outcome === 'skipped' ? 409 : 503, cors);
    }
  } catch {
    return response({ error: 'The compliance request could not be updated.' }, 503, cors);
  }
  return response({ error: 'Unsupported action' }, 400, cors);
}
