// POST /api/send-signed-copy
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Emails a customer another copy of a document they already signed, with the
//   PDF attached. Staff press a button; the customer gets the same file they
//   received the day they signed.
//
// WHY IT EXISTS:
//   Until now the ONLY copy a customer ever got was the one email sent at the
//   moment of signing (submit-esign.js). If it went to spam, was deleted, or
//   they changed address, there was no way to get it to them again — not for
//   the customer and not for staff. /api/resend-esign cannot do it: it refuses
//   a signed request with 409 "Document already signed — cannot resend",
//   because it resends the SIGNING LINK, not the finished document. Owner,
//   2026-08-19: "the clients also need a copy of their own documents that they
//   signed... and that includes every single type."
//
// DEPENDS ON:
//   Internal: lib/auth (requireEmployee), lib/supabase, lib/email (sendEmail),
//             lib/cors
//   Data:     reads  → job_documents, sign_requests, jobs, Storage
//             writes → job_notes (the audit line). No document row is changed.
//
// NOTES / GOTCHAS:
//   - IT SENDS AN ATTACHMENT, NEVER A LINK, and that is a security decision
//     rather than a style one. A link would be either a public object — exactly
//     what the 2026-08-19 privacy move removed — or a long-lived signed URL,
//     and a signed URL to a work authorization carrying claim number and policy
//     number, forwarded or sitting in an inbox, is the same exposure wearing a
//     different coat. The attachment is also the identical artifact the
//     customer already has, so it needs no explanation.
//   - IT IS BUCKET-AGNOSTIC. It reads `storage_bucket`, falling back to
//     `job-files`, exactly as the browser's bucketFor() does. That is what lets
//     it serve both the 32 documents moved to the private bucket and anything
//     signed before or after.
//   - IT WORKS FOR EVERY DOC TYPE by construction: it emails the stored PDF and
//     never branches on doc_type, so the 11 types in submit-esign's DOC_TITLES
//     — and any added later — are covered without touching this file.
//   - STAFF-TRIGGERED ONLY. There is no scheduled or automated caller and there
//     must not be one: a background job that mails signed PDFs is a bulk PII
//     egress path. This is email, not SMS, so the consent model in
//     AGENTS.md §14 does not apply — but that is precisely why it must not
//     become an automated sender by the back door.
//   - THE @noemail.local TRAP. 9 of 58 sign_requests carry a synthetic
//     `collect-<ts>@noemail.local` address invented to satisfy a not-null check
//     when a link was texted instead of emailed. It is a non-null string, so a
//     plain `!email` guard sails past it and hands Resend a bogus TLD — bounces
//     on a synthetic domain cost real sender reputation
//     (EMAIL-DELIVERABILITY.md). Same judgement as resend-esign's hasRealEmail.
//   - IT RETURNS BOTH `ok` AND `success`, on purpose. workers-standard.md §5
//     asks new workers for `{ ok: true }`; the two callers here already
//     implement the e-sign `success`/`delivered` check for the resend button
//     sitting on the same row, and giving a sibling action a different shape
//     invites exactly the mistake ESIGN-03 records. Both are emitted so neither
//     convention is broken and no caller has to special-case this endpoint.
//   - THE RESPONSE CONTRACT IS `success` PLUS `delivered`, and both are
//     load-bearing (ESIGN-03). A 200 once reported "sent" for an email nobody
//     sent, because the caller inferred success from the status code. `success`
//     means the request was handled; `delivered` is the one that answers "did
//     anything actually leave".
//   - IT NEVER RETURNS THE PDF to the browser. The bytes are read server-side
//     with the service role and go straight into the message.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { requireEmployee } from '../lib/auth.js';
import { supabase } from '../lib/supabase.js';
import { sendEmail } from '../lib/email.js';

const LEGACY_BUCKET = 'job-files';

// Mirrors submit-esign.js DOC_TITLES. Duplicated deliberately rather than
// exported across the boundary: this worker must degrade to a readable label
// for a doc_type added there tomorrow, not throw.
const DOC_TITLES = {
  coc: 'Certificate of Completion',
  work_auth: 'Work Authorization',
  direction_pay: 'Direction of Pay',
  change_order: 'Change Order',
  recon_agreement: 'Reconstruction Agreement',
  cat3_removal: 'Emergency Removal Authorization',
  emergency_demo: 'Emergency Demolition Authorization',
  coverage_unconfirmed: 'Coverage Not Confirmed Acknowledgment',
  service_declined: 'Declination of Recommended Services',
  equipment_early_removal: 'Early Equipment Removal',
  access_release: 'Property Access Authorization',
  other: 'Custom Authorization',
};

const titleFor = (docType) =>
  DOC_TITLES[docType] ||
  String(docType || 'document').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * See the @noemail.local note in the header. Third copy of the rule in
 * src/lib/signerEmail.js, and it must stay BYTE-EQUIVALENT to that one —
 * tests/qa/unit/esign-resend-truthfulness.test.js pins all three.
 *
 * It asks ONE question: is this a placeholder rather than a real address. It
 * deliberately does NOT validate format; folding that in here made this copy a
 * different predicate from the other two, which the parity test caught.
 */
export function hasRealEmail(address) {
  const v = String(address || '').trim().toLowerCase();
  return Boolean(v) && !v.endsWith('@noemail.local');
}

/**
 * Separate from hasRealEmail on purpose (see above). Deliberately permissive —
 * Resend is the real validator; this only rejects what is obviously not an
 * address, so a staff typo produces a 400 here instead of a silent non-delivery.
 */
export function looksLikeEmail(address) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(address || '').trim());
}

const escHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * btoa(String.fromCharCode(...bytes)) blows the V8 call stack somewhere north
 * of ~100KB. Chunked, exactly as submit-esign does it — a signed PDF with photo
 * evidence attached is well past that line.
 */
export function toBase64(bytes) {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 8192) {
    binary += String.fromCharCode(...view.subarray(i, i + 8192));
  }
  return btoa(binary);
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);

  // Authorization, server-side, not inherited from the UI (AGENTS.md §16).
  // The predicate is deliberately the SAME one the private bucket's own RLS
  // policy uses — active AND internal — because the question "may you read this
  // object" and "may you mail it to someone" should not have two answers.
  // requireEmployee covers active; is_external is checked here because it does
  // not.
  const auth = await requireEmployee(request, env, db);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);
  if (auth.employee.is_external) {
    return jsonResponse({ error: 'External accounts cannot send customer documents' }, 403, request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const jobDocumentId = body?.job_document_id;
  const emailOverride = body?.email ? String(body.email).trim() : null;
  if (!jobDocumentId) {
    return jsonResponse({ error: 'job_document_id is required' }, 400, request, env);
  }
  if (emailOverride && !(hasRealEmail(emailOverride) && looksLikeEmail(emailOverride))) {
    return jsonResponse({ error: 'That does not look like a valid email address' }, 400, request, env);
  }

  try {
    const docs = await db.select(
      'job_documents',
      `id=eq.${jobDocumentId}` +
        '&select=id,job_id,name,file_path,storage_bucket,sign_request_id' +
        '&limit=1',
    );
    const doc = docs?.[0];
    if (!doc) return jsonResponse({ error: 'Document not found' }, 404, request, env);

    // Scope: this endpoint exists for SIGNED documents. A job photo is not a
    // customer's countersigned authorization and must not be mailable from here.
    if (!doc.sign_request_id) {
      return jsonResponse({ error: 'That document is not a signed document' }, 400, request, env);
    }

    const signs = await db.select(
      'sign_requests',
      `id=eq.${doc.sign_request_id}` +
        '&select=id,doc_type,status,signer_name,signer_email,signed_at,job:jobs(id,job_number,address,city,state)' +
        '&limit=1',
    );
    const sr = signs?.[0];
    if (!sr) return jsonResponse({ error: 'Signing record not found' }, 404, request, env);
    if (sr.status !== 'signed') {
      // Sending an unsigned draft to a customer as "your signed copy" would be
      // a false record. resend-esign is the right tool while it is pending.
      return jsonResponse(
        { error: 'That document has not been signed yet — send a reminder instead' },
        409, request, env,
      );
    }

    const recipient = emailOverride || sr.signer_email;
    if (!hasRealEmail(recipient) || !looksLikeEmail(recipient)) {
      return jsonResponse(
        { ok: true, success: true, delivered: false, reason: 'no_email_on_file' },
        200, request, env,
      );
    }

    const bucket = doc.storage_bucket || LEGACY_BUCKET;
    const key = String(doc.file_path || '').replace(/^job-files\//, '');
    if (!key) return jsonResponse({ error: 'Document has no stored file' }, 422, request, env);

    let pdfBytes;
    try {
      // downloadStorage returns { bytes, contentType } — not the bytes. Reading
      // it as raw bytes yields an object, and toBase64 would happily encode
      // "[object Object]" into a 15-byte "PDF" the customer cannot open.
      ({ bytes: pdfBytes } = await db.downloadStorage(bucket, key));
    } catch (error) {
      console.error(`send-signed-copy: download ${bucket}/${key} failed: ${error.message}`);
      return jsonResponse({ error: 'Could not read the stored document' }, 502, request, env);
    }
    if (!pdfBytes?.byteLength) {
      return jsonResponse({ error: 'The stored document is empty' }, 502, request, env);
    }

    const job = sr.job || {};
    const docLabel = titleFor(sr.doc_type);
    const signedAt = sr.signed_at ? new Date(sr.signed_at) : null;
    const signedStr = signedAt
      ? signedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : null;
    const propertyStr = [job.address, job.city, job.state].filter(Boolean).join(', ');
    const firstName = String(sr.signer_name || '').trim().split(' ')[0] || 'there';
    const fileName = `${sr.doc_type}-signed${signedAt ? `-${signedAt.toISOString().slice(0, 10)}` : ''}.pdf`;

    const sent = await sendEmail(env, {
      to: { email: recipient, name: sr.signer_name || undefined },
      subject: `Your signed ${docLabel} – Utah Pros Restoration`,
      text:
        `Hi ${firstName},\n\nHere is another copy of your ${docLabel}, attached to this email for your records.` +
        `\n\nDocument: ${docLabel}` +
        (propertyStr ? `\nProperty: ${propertyStr}` : '') +
        (signedStr ? `\nSigned: ${signedStr}` : '') +
        `\n\nIf you have any questions, reply to this email or call us at (801) 427-0582.\n\n— Utah Pros Restoration`,
      html:
        `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
        `<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">` +
        `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;"><tr><td align="center">` +
        `<table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">` +
        `<tr><td style="background:#1e293b;padding:28px 32px;text-align:center;">` +
        `<p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">Utah Pros Restoration</p>` +
        `<p style="margin:4px 0 0;font-size:13px;color:#94a3b8;">Licensed &amp; Insured &middot; Utah</p></td></tr>` +
        `<tr><td style="padding:32px;">` +
        `<p style="margin:0 0 20px;font-size:16px;color:#0f172a;">Hi ${escHtml(firstName)},</p>` +
        `<p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.6;">Here is another copy of your <strong>${escHtml(docLabel)}</strong>, attached to this email for your records.</p>` +
        `<table cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;"><tr><td style="padding:16px 20px;">` +
        `<p style="margin:0 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8;">Document Details</p>` +
        `<table cellpadding="0" cellspacing="0">` +
        `<tr><td style="font-size:13px;color:#64748b;padding:3px 0;width:100px;">Document</td><td style="font-size:13px;color:#0f172a;font-weight:500;padding:3px 0;">${escHtml(docLabel)}</td></tr>` +
        (propertyStr ? `<tr><td style="font-size:13px;color:#64748b;padding:3px 0;">Property</td><td style="font-size:13px;color:#0f172a;font-weight:500;padding:3px 0;">${escHtml(propertyStr)}</td></tr>` : '') +
        (signedStr ? `<tr><td style="font-size:13px;color:#64748b;padding:3px 0;">Signed</td><td style="font-size:13px;color:#0f172a;font-weight:500;padding:3px 0;">${escHtml(signedStr)}</td></tr>` : '') +
        `</table></td></tr></table>` +
        `<p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;">The signed PDF is attached. Please save it for your records.</p>` +
        `</td></tr>` +
        `<tr><td style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;">` +
        `<p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">Questions? Reply to this email or call <strong>(801) 427-0582</strong>.</p>` +
        `</td></tr></table></td></tr></table></body></html>`,
      attachments: [{ content: toBase64(pdfBytes), filename: fileName, contentType: 'application/pdf' }],
    });

    if (!sent?.ok) {
      return jsonResponse(
        { ok: true, success: true, delivered: false, reason: 'send_failed', detail: sent?.error || null },
        200, request, env,
      );
    }

    // Audit line on the job timeline. Not decoration: this endpoint can mail a
    // customer's countersigned authorization to a typed address, so WHO sent
    // WHAT to WHERE has to be visible afterwards to someone who was not there.
    // Best-effort — the email is already gone and failing the request now would
    // report a send that did happen as a failure.
    await db.insert('job_notes', {
      job_id: doc.job_id,
      author_name: 'E-Signature',
      body:
        `📧 ${auth.employee.full_name || 'A UPR employee'} emailed a copy of the ${docLabel} to ${recipient}` +
        (emailOverride ? ' (address typed by staff, not the one on file).' : '.'),
    }).catch((e) => console.error('send-signed-copy: job_note insert failed:', e.message));

    return jsonResponse({ ok: true, success: true, delivered: true, to: recipient }, 200, request, env);
  } catch (error) {
    console.error('send-signed-copy failed:', error.message);
    return jsonResponse({ error: 'Could not send the document' }, 500, request, env);
  }
}
