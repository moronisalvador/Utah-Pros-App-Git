/**
 * ════════════════════════════════════════════════
 * FILE: contractor-compliance/api.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives the compliance screens one safe place to ask the server to upload, review, request, or
 *   open a contractor document. It keeps file paths and storage access out of browser code.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  src/lib/realtime.js
 *   Data:      reads  → Contractor Compliance Worker responses
 *              writes → Contractor Compliance Worker requests
 *
 * NOTES / GOTCHAS:
 *   - A signed link is opened only after the server has performed its role check.
 * ════════════════════════════════════════════════
 */
import { getAuthHeader } from '@/lib/realtime';

async function responseBody(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Contractor compliance request failed (${response.status})`);
  return body;
}

export async function complianceAction(action, payload = {}) {
  const headers = await getAuthHeader();
  const names = {
    review_document: 'review', add_note: 'note', create_request: 'create',
    pause_request: 'pause', resume_request: 'resume', revoke_request: 'revoke', send_request: 'resend',
  };
  const body = { action: names[action] || action, ...payload };
  if (action === 'review_document') body.review_state = payload.state;
  if (action === 'create_request') body.document_types = payload.requested_types;
  if (action === 'pause_reminders') body.reason = payload.pause_reason;
  const response = await fetch('/api/contractor-compliance-requests', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return responseBody(response);
}

export async function uploadInternalDocument({ contractorId, documentType, file, effectiveDate, expirationDate, taxYear }) {
  const headers = await getAuthHeader();
  const form = new FormData();
  form.set('contractor_id', contractorId);
  form.set('document_type', documentType);
  if (effectiveDate) form.set('effective_date', effectiveDate);
  if (expirationDate) form.set('expiration_date', expirationDate);
  if (taxYear) form.set('tax_year', taxYear);
  form.set('file', file);
  const response = await fetch('/api/contractor-compliance-upload', {
    method: 'POST', headers, body: form,
  });
  return responseBody(response);
}

export async function openDocument(documentId, disposition = 'inline') {
  const headers = await getAuthHeader();
  const response = await fetch('/api/contractor-compliance-file', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ document_id: documentId, disposition }),
  });
  const body = await responseBody(response);
  if (!body.url) throw new Error('A secure file link was not returned.');
  window.open(body.url, '_blank', 'noopener,noreferrer');
}

export async function getPublicRequest(token) {
  const response = await fetch('/api/contractor-compliance-public', {
    headers: { Accept: 'application/json', 'X-Contractor-Upload-Token': token }, referrerPolicy: 'no-referrer',
  });
  const body = await responseBody(response);
  return { ...body, requested_types: body.requested_types || body.requested_document_types || [] };
}

export async function uploadPublicDocument({ token, documentType, file, effectiveDate, expirationDate, taxYear }) {
  const form = new FormData();
  form.set('document_type', documentType);
  if (effectiveDate) form.set('effective_date', effectiveDate);
  if (expirationDate) form.set('expiration_date', expirationDate);
  if (taxYear) form.set('tax_year', taxYear);
  form.set('file', file);
  const response = await fetch('/api/contractor-compliance-public', {
    method: 'POST', headers: { 'X-Contractor-Upload-Token': token }, body: form, referrerPolicy: 'no-referrer',
  });
  return responseBody(response);
}
