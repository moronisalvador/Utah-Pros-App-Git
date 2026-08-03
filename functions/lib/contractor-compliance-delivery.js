/**
 * ════════════════════════════════════════════════
 * FILE: contractor-compliance-delivery.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Sends one already-reserved contractor request through UPR's approved email
 *   door, then records a safe outcome. It never stores or returns the upload link.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  automated-send.js, contractor-compliance.js
 *   Data:      reads → contacts, email_suppressions
 *              writes → contractor_compliance_request_deliveries
 *
 * NOTES / GOTCHAS:
 *   - Database claim must happen before this helper is called.
 * ════════════════════════════════════════════════
 */
import { sendAutomatedMessage } from './automated-send.js';
import { emailHtmlForCompliance } from './contractor-compliance.js';

function uploadUrl(env, token) {
  const base = (env.PAGES_URL || 'https://utahpros.app').replace(/\/$/, '');
  // Keep the capability in the URL fragment. Fragments are not sent in HTTP
  // requests, so Cloudflare access logs never receive the raw upload token.
  return `${base}/contractor-upload#token=${encodeURIComponent(token)}`;
}

function requestLabel(documentTypes) {
  const types = new Set(Array.isArray(documentTypes) ? documentTypes : []);
  const labels = [];
  if (types.has('w9')) labels.push('current-year W-9');
  if (types.has('workers_comp') || types.has('workers_comp_waiver')) {
    labels.push('workers compensation certificate or Utah coverage waiver');
  }
  if (types.has('general_liability')) labels.push('general liability certificate');
  return labels.length ? labels.join(', ') : 'required contractor compliance document';
}

/**
 * A claim result is intentionally the only object that may include a raw upload
 * token. SQL creates it during this claim and stores only its digest. The token
 * is consumed in memory to make one email, never logged or persisted by Worker.
 */
export async function deliverClaimedComplianceRequest(db, env, claim, { uploadToken = null } = {}) {
  const rawToken = uploadToken || claim?.upload_token;
  const contactId = claim?.contact_id || claim?.contractor_id;
  if (!claim?.delivery_id || !contactId || !claim?.provider_idempotency_key || !rawToken) {
    return { outcome: 'invalid_claim', recordsProcessed: 0 };
  }
  const label = claim.requirement_label || requestLabel(claim.document_types);
  const result = await sendAutomatedMessage('email', contactId, null, {}, env, {
    subject: `Utah Pros Restoration: ${label} needed`,
    html: emailHtmlForCompliance({
      uploadUrl: uploadUrl(env, rawToken),
      requirementLabel: label,
      dueLabel: claim.due_label || null,
    }),
    idempotencyKey: claim.provider_idempotency_key,
  });
  // Finalization stores only outcome code/provider ID. It deliberately never
  // stores the email HTML, URL, raw token, or raw provider error.
  await db.rpc('contractor_compliance_finish_delivery', {
    p_delivery_id: claim.delivery_id,
    p_outcome: result.ok ? 'sent' : result.skipped ? 'suppressed' : result.ambiguous ? 'ambiguous' : 'failed',
    p_provider_message_id: result.resendId || null,
    p_skip_reason: result.skipped ? (result.reason || 'skipped') : null,
    p_ambiguous: result.ambiguous === true,
  });
  return { outcome: result.ok ? 'sent' : result.skipped ? 'skipped' : result.ambiguous ? 'ambiguous' : 'failed', recordsProcessed: 1 };
}
