/**
 * ════════════════════════════════════════════════
 * FILE: submit-esign.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Completes a public token-gated e-signature, renders and stores the signed
 *   PDF, writes the legal document/audit records, and sends best-effort
 *   confirmation notifications. A Work Authorization carrying the exact
 *   approved SMS disclosure also records narrow project-service SMS evidence.
 *
 * DEPENDS ON:
 *   Packages:  pdf-lib
 *   Internal:  functions/lib/cors.js, email.js, supabase.js, pdfText.js,
 *              functions/api/notify.js
 *   Data:      reads  → sign request, job and document template RPC/data
 *              writes → Storage, complete-sign RPC, notifications and job note
 *
 * NOTES / GOTCHAS:
 *   - The SMS disclosure text + SHA are deliberately version-pinned. Template
 *     drift completes the signature but records no messaging permission.
 *   - The legacy completion RPC fallback exists only for code-first rollout; it
 *     leaves messaging blocked until the additive database migration exists.
 *   - Signing never sends an SMS, retries a draft, clears suppression or flips
 *     the contact's global opt-in.
 *   - Body-text layout (bold runs, word grouping, wrapping) is the exported
 *     pure layoutWrappedRuns(); drawWrapped only measures with the real fonts
 *     and draws what it returns. Three defects reached signed customer
 *     documents while that logic was an uncallable closure covered only by
 *     tests that grepped this file — behaviour goes in the pure function so it
 *     can be executed, not described.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { sendEmail } from '../lib/email.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';
import { dispatchEvent } from './notify.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { pdfSafe } from '../lib/pdfText.js';

const WORK_AUTH_SMS_COMPLETION_RPC =
  'complete_sign_request_with_work_authorization_sms_consent';
const WORK_AUTH_SMS_DISCLOSURE_TEXT =
  'By signing this Agreement, I consent to receive text messages (SMS/MMS) from Utah Pros Restoration at the mobile number provided in connection with this Agreement. Messages may include appointment reminders, project status updates, scheduling notifications, and other communications related to my restoration project. Message and data rates may apply. Message frequency varies. Reply STOP to opt out at any time. Reply HELP for assistance. Carriers are not liable for delayed or undelivered messages.';

export const WORK_AUTH_SMS_DISCLOSURE_VERSION = 'upr_work_auth_sms_v1';
export const WORK_AUTH_SMS_DISCLOSURE_SHA256 =
  '22b2a37dc4094f683da6c0fe1d4955da989733a3a799307129b9fa83cae1265e';
export const SIGNED_DOCUMENT_BUCKET = 'job-documents-private';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* Document display names — the PDF title AND the label in both confirmation
   emails. This file used to carry TWO identical copies of this map (an inline
   one in onRequestPost for the emails, and DOC_TITLES down by buildPdf); they
   are now one. Moved to the top rather than referenced in place because
   no-use-before-define is configured with variables:true and CI runs the
   changed-files ratchet at --max-warnings 0. A pure move — the five original
   values are unchanged.

   Keep in lockstep with templateData.jsx, SignPage.jsx, JobPage.jsx,
   TechJobDocuments.jsx, send-esign.js and resend-esign.js; pinned by
   tests/qa/unit/esign-doc-type-label-parity.test.js.

   These are drawn UNWRAPPED at 18pt into a 500pt column — keep them under about
   45 characters or the PDF title runs off the page. */
const DOC_TITLES = {
  coc:                     'Certificate of Completion',
  work_auth:               'Work Authorization',
  direction_pay:           'Direction of Pay',
  change_order:            'Change Order',
  recon_agreement:         'Reconstruction Agreement',
  cat3_removal:            'Emergency Removal Authorization',
  emergency_demo:          'Emergency Demolition Authorization',
  coverage_unconfirmed:    'Coverage Not Confirmed Acknowledgment',
  service_declined:        'Declination of Recommended Services',
  equipment_early_removal: 'Early Equipment Removal',
  access_release:          'Property Access Authorization',
  // Deliberately FIXED, not the author's heading. The title is drawn by an
  // unwrapped drawText at 18pt into a 500pt column, so an 80-character heading
  // would run off the page — and it is the one string in buildPdf measured
  // without pdfSafe(), so a single pasted emoji would throw mid-build, after the
  // Storage upload and before completion. The author's heading is rendered as
  // the document's first section heading instead.
  other:                   'Custom Authorization',
};

/* Doc types that carry a company pre-authorization (countersignature) block.
   These are documents where Utah Pros is a party taking on or releasing an
   obligation, not just recording what the client acknowledged. The four
   situational types added 2026-08-07 that involve the company acting on an
   authorization or accepting a release are included; the two that only record a
   client acknowledgment (coverage_unconfirmed, access_release) are not.
   Mechanically this also selects SIG_BLOCK_H 210 vs 130. */
const CO_SIGNED_DOC_TYPES = new Set([
  'work_auth',
  'change_order',
  'recon_agreement',
  'cat3_removal',
  'emergency_demo',
  'equipment_early_removal',
  'service_declined',
]);

function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function normalizeDisclosure(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function getApprovedWorkAuthSmsDisclosure(templateSections) {
  const smsSection = (templateSections || []).find(
    (section) => normalizeDisclosure(section?.heading).toUpperCase() === 'SMS COMMUNICATIONS',
  );
  const renderedText = normalizeDisclosure((smsSection?.blocks || []).join(' '));
  if (renderedText !== WORK_AUTH_SMS_DISCLOSURE_TEXT) return null;
  return {
    version: WORK_AUTH_SMS_DISCLOSURE_VERSION,
    sha256: WORK_AUTH_SMS_DISCLOSURE_SHA256,
  };
}

export function getTrustedSignerIp(request) {
  return String(
    request?.headers?.get('CF-Connecting-IP') || '',
  ).trim() || null;
}

function isMissingWorkAuthConsentRpc(error) {
  const message = String(error?.message || error || '');
  return message.includes(WORK_AUTH_SMS_COMPLETION_RPC)
    && (
      message.includes('PGRST202')
      || /could not find the function/i.test(message)
      || /schema cache/i.test(message)
    );
}

export async function completeSignRequest({
  rpc,
  params,
  smsDisclosure = null,
}) {
  try {
    const result = await rpc(WORK_AUTH_SMS_COMPLETION_RPC, {
      ...params,
      p_sms_disclosure_version: smsDisclosure?.version || null,
      p_sms_disclosure_sha256: smsDisclosure?.sha256 || null,
    });
    return { result, bridgeAvailable: true };
  } catch (error) {
    if (!isMissingWorkAuthConsentRpc(error)) throw error;
    return {
      result: await rpc('complete_sign_request', params),
      bridgeAvailable: false,
    };
  }
}

export async function markSignedDocumentBucket(db, jobDocumentId) {
  if (!jobDocumentId) throw new Error('Signed document id is missing');
  const rows = await db.update(
    'job_documents',
    `id=eq.${encodeURIComponent(jobDocumentId)}`,
    { storage_bucket: SIGNED_DOCUMENT_BUCKET },
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error('Failed to assign signed document storage bucket');
  }
  return rows[0];
}

// ── esign.signed notification hook (Notification Center, Session B) ──
// Additive + fire-and-forget: replaces the old global create_notification
// ('esign_signed') bell with a per-recipient, prefs-driven esign.signed event
// (audience = admins, resolved inside notify.js). INERT until the catalog type is
// enabled; a notify failure never fails a signing (the document is already stored).
export async function notifyEsignSigned({ db, env, job, docLabel, docType, signerName, jobDocumentId, dispatchImpl = dispatchEvent }) {
  try {
    const propertyStr = [job?.address, job?.city, job?.state].filter(Boolean).join(', ') || 'Unknown property';
    const title = `${signerName} signed the ${docLabel}`;
    const body  = [job?.job_number ? `Job ${job.job_number}` : null, propertyStr].filter(Boolean).join(' · ');
    await dispatchImpl({
      db, env,
      typeKey: 'esign.signed',
      body: {
        notification_event_id: jobDocumentId || null,
        title, body,
        link:        `/jobs/${job?.id}`,
        entity_type: 'job',
        entity_id:   job?.id || null,
        job_id:      job?.id || null,
        payload:     { doc_type: docType, signer_name: signerName, job_document_id: jobDocumentId || null },
        presentation_context: {
          signer_name: signerName,
          document_name: docLabel,
          job_number: job?.job_number || '',
        },
        data:        { route: `/jobs/${job?.id}` },
      },
    });
  } catch (e) { console.error('esign.signed dispatch failed:', e?.message); }
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

// public: a secret signing token is the narrow customer capability; pending
// status and expiry are checked before Storage, completion, consent or notify writes.
export async function onRequestPost(context) {
  const { request, env } = context;

  const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  // Base URL for the "open the job" link in the internal notification email.
  const SITE_URL = env.APP_BASE_URL || 'https://utahpros.app';

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return jsonResponse({ error: 'Signing service is unavailable' }, 503, request, env);
  }

  const db = supabase({
    ...env,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SUPABASE_KEY,
  }, fetchWithTimeout);
  const rpc = (fn, params) => db.rpc(fn, params);
  const select = (table, query) => db.select(table, query);

  try {
    const {
      token, signer_name, signature_png,
      // Recon agreement: four separately-attested consents. Ignored for other doc types.
      consent_terms, consent_commitment, consent_esign, consent_authority,
    } = await request.json();

    if (!token)         return jsonResponse({ error: 'token is required' },         400, request, env);
    if (!UUID_RE.test(token)) return jsonResponse({ error: 'token is invalid' },     400, request, env);
    if (!signer_name)   return jsonResponse({ error: 'signer_name is required' },   400, request, env);
    if (!signature_png) return jsonResponse({ error: 'signature_png is required' }, 400, request, env);

    // ── 1. Fetch sign request + job ──
    const signReq = await rpc('get_sign_request_by_token', { p_token: token });
    if (!signReq)                                  return jsonResponse({ error: 'Signing link not found' },          404, request, env);
    if (signReq.status === 'signed')               return jsonResponse({ error: 'Document already signed' },         409, request, env);
    if (signReq.status !== 'pending')              return jsonResponse({ error: 'Signing link is no longer valid' }, 410, request, env);
    if (new Date(signReq.expires_at) < new Date()) return jsonResponse({ error: 'Signing link has expired' },       410, request, env);

    // Recon agreement: all 4 consents must be true
    if (signReq.doc_type === 'recon_agreement') {
      if (!(consent_terms && consent_commitment && consent_esign && consent_authority)) {
        return jsonResponse({ error: 'All four acknowledgments are required for reconstruction agreements.' }, 400, request, env);
      }
    }

    const job      = signReq.job;
    const signedAt = new Date();
    const divisions = (Array.isArray(signReq.divisions) && signReq.divisions.length > 0)
      ? signReq.divisions
      : (job.division ? [job.division] : []);

    // ── 2. Fetch template from DB for non-CoC docs ──
    //   - recon_agreement: one DB row per section (heading + plain body). Map each
    //     row to { heading, blocks } where blocks are paragraphs split on blank lines.
    //   - Other doc types (work_auth, direction_pay, change_order): single DB row
    //     with inline ## headings — parseMarkdownSections splits into sections.
    let templateSections = null;
    if (signReq.doc_type === 'other') {
      // ── Custom Authorization: the text is the per-request snapshot, full stop ──
      // Read straight from the row with the service-role client rather than
      // through get_sign_request_custom_text: that RPC is scoped to
      // status='pending' for the anonymous signing page, and this runs in the
      // moment before the request stops being pending.
      //
      // The snapshot is used UNCONDITIONALLY for doc_type='other' and is never
      // merged with document_templates. If anyone ever inserted a row with
      // doc_type='other' through upsert_document_template it would otherwise
      // apply to EVERY custom document ever sent.
      const rows = await select(
        'sign_requests',
        `token=eq.${encodeURIComponent(token)}&select=custom_heading,custom_body&limit=1`,
      );
      const heading = String(rows?.[0]?.custom_heading || '').trim();
      const body    = String(rows?.[0]?.custom_body    || '').trim();

      // HARD REFUSAL, never a fallback. With templateSections left null, buildPdf
      // falls through to `templateSections || buildCocSections(divisions)` and
      // stamps a CERTIFICATE OF COMPLETION — "the work is 100% complete and I
      // have no outstanding complaints" — into a signed, stored, emailed PDF
      // filed as a contract. On a document the client opened to authorize
      // emergency demolition. Refusing to sign is the only safe answer.
      if (!body) {
        console.error(`submit-esign: custom authorization ${signReq.id} has no stored text; refusing to complete.`);
        return jsonResponse({
          error: 'This document is missing its text and cannot be signed. Please contact us for a new link.',
          code: 'ESIGN_CUSTOM_TEXT_MISSING',
        }, 409, request, env);
      }

      const substituted = substituteVars(body, job, signedAt);
      const sections = parseMarkdownSections(substituted);
      // The author's title becomes the first section heading. It is NOT used as
      // the PDF title: that is drawn by an unwrapped 18pt drawText into a 500pt
      // column, so a long heading would run off the page — and it is the one
      // string in buildPdf measured without pdfSafe(), so a pasted emoji would
      // throw mid-build, after the storage upload and before completion.
      if (!heading) {
        templateSections = sections;
      } else if (sections.length > 0 && !sections[0].heading) {
        // Body opens with plain text — hang the title on that first block rather
        // than emitting a heading with nothing under it.
        templateSections = [{ ...sections[0], heading }, ...sections.slice(1)];
      } else {
        templateSections = [{ heading, blocks: [] }, ...sections];
      }
    } else if (signReq.doc_type !== 'coc') {
      const templates = await select(
        'document_templates',
        `doc_type=eq.${encodeURIComponent(signReq.doc_type)}&order=sort_order.asc`
      );
      if (templates.length > 0) {
        if (signReq.doc_type === 'recon_agreement') {
          templateSections = templates.map(t => ({
            heading: t.heading || null,
            blocks:  substituteVars(t.body || '', job, signedAt)
              .split(/\n\s*\n/)
              .map(s => s.trim())
              .filter(Boolean),
          }));
        } else {
          const body = substituteVars(templates[0].body, job, signedAt);
          templateSections = parseMarkdownSections(body);
        }
      }
    }
    // Server-side twin of the SignPage guard. buildPdf does
    // `templateSections || buildCocSections(divisions)`, so a doc type whose
    // document_templates row is missing would stamp a CERTIFICATE OF COMPLETION
    // — "the work is 100% complete and I have no outstanding complaints" — into
    // a signed PDF that is uploaded to job-files, emailed to the customer, and
    // filed as job_documents.category='contract'. That is the exact shape of a
    // fabricated document, and it is reachable any time a new doc type ships
    // before its seed migration is applied. coc is the one type that legitimately
    // builds its sections from divisions rather than a row.
    if (signReq.doc_type !== 'coc' && !templateSections) {
      console.error(`submit-esign: no template for doc_type=${signReq.doc_type}; refusing to complete ${signReq.id}.`);
      return jsonResponse({
        error: 'This document is not available to sign yet. Please contact us for a new link.',
        code: 'ESIGN_TEMPLATE_MISSING',
      }, 409, request, env);
    }

    const smsDisclosure = signReq.doc_type === 'work_auth'
      ? getApprovedWorkAuthSmsDisclosure(templateSections)
      : null;
    if (signReq.doc_type === 'work_auth' && !smsDisclosure) {
      console.warn('Work Authorization SMS disclosure is not the approved version; consent remains blocked.');
    }

    // ── 3. Generate PDF ──
    // Only Cloudflare's connection header is trusted as consent evidence. A
    // browser-supplied/fallback forwarding header must never satisfy this gate.
    const signerIp = getTrustedSignerIp(request);
    const pdfBytes = await buildPdf({
      job, signer_name, signature_png,
      signed_at: signedAt,
      doc_type:  signReq.doc_type,
      divisions,
      templateSections,
      signer_ip: signerIp,
      // Only populated for recon_agreement — rendered as attestations after the signature block
      consents: signReq.doc_type === 'recon_agreement'
        ? { terms: !!consent_terms, commitment: !!consent_commitment, esign: !!consent_esign, authority: !!consent_authority }
        : null,
    });

    // ── 4. Upload to Supabase Storage ──
    const storagePath = `${job.id}/esign/${signReq.doc_type}-signed-${Date.now()}.pdf`;
    await db.uploadStorage(SIGNED_DOCUMENT_BUCKET, storagePath, pdfBytes, 'application/pdf');

    // ── 5. Complete sign request ──
    const completionParams = {
      p_token:              token,
      p_signer_name:        signer_name,
      p_signer_ip:          signerIp,
      p_signed_file_path:   storagePath,
      // Recon-agreement consents — NULL for other doc types, persisted verbatim
      p_consent_terms:      signReq.doc_type === 'recon_agreement' ? !!consent_terms      : null,
      p_consent_commitment: signReq.doc_type === 'recon_agreement' ? !!consent_commitment : null,
      p_consent_esign:      signReq.doc_type === 'recon_agreement' ? !!consent_esign      : null,
      p_consent_authority:  signReq.doc_type === 'recon_agreement' ? !!consent_authority  : null,
    };
    const { result, bridgeAvailable } = await completeSignRequest({
      rpc,
      params: completionParams,
      smsDisclosure,
    });
    if (!result || result.error) throw new Error(result?.error || 'Failed to complete sign request');
    // complete_sign_request creates the job_documents row. Mark it before any
    // email or notification so every newly-created row resolves from the same
    // private bucket that received the PDF. The migration must deploy first.
    await markSignedDocumentBucket(db, result.job_document_id);
    if (signReq.doc_type === 'work_auth' && !bridgeAvailable) {
      console.warn('Work Authorization SMS consent bridge is not deployed; consent remains blocked.');
    } else if (signReq.doc_type === 'work_auth' && result.sms_consent_recorded === false) {
      console.warn(`Work Authorization signed without SMS consent evidence: ${result.sms_consent_reason || 'unknown'}`);
    }

    // ── 6. Send confirmation email with PDF attached ──
    const docLabel = DOC_TITLES[signReq.doc_type] || 'Signed Document';

    const firstName = escHtml(signer_name.split(' ')[0]);
    // Chunk-encode to avoid V8 call stack overflow on large PDFs (btoa spread crashes at ~100KB+)
    const pdfB64 = (() => {
      const bytes = new Uint8Array(pdfBytes);
      let b64 = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        b64 += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      return btoa(b64);
    })();
    const fileName  = `${signReq.doc_type}-signed-${signedAt.toISOString().slice(0,10)}.pdf`;

    await sendEmail(env, {
      to:      { email: signReq.signer_email, name: signer_name },
      subject: `Your signed ${docLabel} – Utah Pros Restoration`,
      text:    `Hi ${firstName},\n\nThank you for signing. Your ${docLabel} is attached to this email for your records.\n\nDocument: ${docLabel}\nProperty: ${[job.address, job.city, job.state].filter(Boolean).join(', ')}\nSigned: ${signedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}\n\nIf you have any questions, reply to this email or call us at (801) 427-0582.\n\n— Utah Pros Restoration`,
      html:    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;"><tr><td align="center"><table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);"><tr><td style="background:#1e293b;padding:28px 32px;text-align:center;"><p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">Utah Pros Restoration</p><p style="margin:4px 0 0;font-size:13px;color:#94a3b8;">Licensed &amp; Insured &middot; Utah</p></td></tr><tr><td style="padding:32px;"><p style="margin:0 0 20px;font-size:16px;color:#0f172a;">Hi ${firstName},</p><p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.6;">Thank you for signing. Your <strong>${escHtml(docLabel)}</strong> is attached to this email for your records.</p><table cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;"><tr><td style="padding:16px 20px;"><p style="margin:0 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8;">Document Details</p><table cellpadding="0" cellspacing="0"><tr><td style="font-size:13px;color:#64748b;padding:3px 0;width:100px;">Document</td><td style="font-size:13px;color:#0f172a;font-weight:500;padding:3px 0;">${escHtml(docLabel)}</td></tr><tr><td style="font-size:13px;color:#64748b;padding:3px 0;">Property</td><td style="font-size:13px;color:#0f172a;font-weight:500;padding:3px 0;">${[job.address, job.city, job.state].filter(Boolean).join(', ')}</td></tr><tr><td style="font-size:13px;color:#64748b;padding:3px 0;">Signed</td><td style="font-size:13px;color:#0f172a;font-weight:500;padding:3px 0;">${signedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</td></tr></table></td></tr></table><p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;">The signed PDF is attached. Please save it for your records.</p></td></tr><tr><td style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;"><p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">Questions? Reply to this email or call <strong>(801) 427-0582</strong>.</p></td></tr></table></td></tr></table></body></html>`,
      attachments: [{
        content:     pdfB64,
        filename:    fileName,
        contentType: 'application/pdf',
      }],
    }).catch(e => console.error('Confirmation email failed:', e.message));
    // Non-fatal — don't throw if email fails, the document is already signed and stored

    // ── 7. Notify the office that the client signed ──
    //   (a) esign.signed notification → per-recipient bell + push + email via the
    //       shared prefs-driven dispatcher (Notification Center, Session B rewire —
    //       replaces the old global create_notification('esign_signed') bell call),
    //   (b) job activity-timeline entry (system-authored job_note),
    //   (c) internal email to restoration@utah-pros.com with the signed PDF.
    // All best-effort and non-fatal — the document is already signed and stored.
    const propertyStr = [job.address, job.city, job.state].filter(Boolean).join(', ') || 'Unknown property';
    const jobUrl      = `${SITE_URL}/jobs/${job.id}`;
    const signedDate  = signedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    await notifyEsignSigned({
      db, env, job, docLabel,
      docType: signReq.doc_type, signerName: signer_name, jobDocumentId: result.job_document_id,
    });

    await db.insert('job_notes', {
      job_id: job.id,
      author_name: 'E-Signature',
      body: `✍️ ${signer_name} signed the ${docLabel}.`,
    }).catch(e => console.error('job_note activity insert failed:', e.message));

    await sendEmail(env, {
      to:      { email: 'restoration@utah-pros.com', name: 'Utah Pros Restoration' },
      subject: `✅ ${signer_name} signed the ${docLabel}`,
      text:    `${signer_name} just signed the ${docLabel}.\n\nDocument: ${docLabel}\nJob: ${job.job_number || '—'}\nProperty: ${propertyStr}\nSigned: ${signedDate}\n\nOpen the job: ${jobUrl}\n\nThe signed PDF is attached.`,
      html:    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;"><tr><td align="center"><table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);"><tr><td style="background:#166534;padding:24px 32px;"><p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">✅ Document signed</p></td></tr><tr><td style="padding:28px 32px;"><p style="margin:0 0 16px;font-size:15px;color:#0f172a;line-height:1.6;"><strong>${escHtml(signer_name)}</strong> just signed the <strong>${escHtml(docLabel)}</strong>.</p><table cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;"><tr><td style="padding:16px 20px;"><table cellpadding="0" cellspacing="0"><tr><td style="font-size:13px;color:#64748b;padding:3px 0;width:90px;">Document</td><td style="font-size:13px;color:#0f172a;font-weight:500;padding:3px 0;">${escHtml(docLabel)}</td></tr><tr><td style="font-size:13px;color:#64748b;padding:3px 0;">Job</td><td style="font-size:13px;color:#0f172a;font-weight:500;padding:3px 0;">${escHtml(job.job_number || '—')}</td></tr><tr><td style="font-size:13px;color:#64748b;padding:3px 0;">Property</td><td style="font-size:13px;color:#0f172a;font-weight:500;padding:3px 0;">${escHtml(propertyStr)}</td></tr><tr><td style="font-size:13px;color:#64748b;padding:3px 0;">Signed</td><td style="font-size:13px;color:#0f172a;font-weight:500;padding:3px 0;">${signedDate}</td></tr></table></td></tr></table><a href="${jobUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:8px;">Open the job in UPR</a><p style="margin:20px 0 0;font-size:13px;color:#64748b;line-height:1.6;">The signed PDF is attached for your records.</p></td></tr></table></td></tr></table></body></html>`,
      attachments: [{ content: pdfB64, filename: fileName, contentType: 'application/pdf' }],
    }).catch(e => console.error('Internal esign notification email failed:', e.message));

    return jsonResponse({
      success:         true,
      job_document_id: result.job_document_id,
      job_id:          result.job_id,
      signed_at:       signedAt.toISOString(),
    }, 200, request, env);

  } catch (err) {
    const reference = crypto.randomUUID();
    console.error('submit-esign failed', {
      reference,
      error_type: err instanceof Error ? err.name : 'UnknownError',
    });
    return jsonResponse({
      error: 'Unable to complete signing request',
      reference,
    }, 500, request, env);
  }
}

/* Build the property address from the parts that actually exist.

   Jobs are not consistent about where the address lives: some carry the whole
   thing in `address` with `city` empty. Every template writes the group out as
   `{{address}}, {{city}}, {{state}} {{zip}}`, so those jobs render
   "1234 Example Rd, United States, , UT" — a doubled comma on a document a
   customer signs. Joining only non-empty parts is the fix.

   `state` keeps the same 'UT' default the individual token has, so this changes
   nothing for a job whose fields are all populated. Verified against
   W-2607-003, which renders identically before and after.

   DUPLICATED in src/pages/SignPage.jsx — separate bundles, no shared import;
   tests/qa/unit/esign-property-address-parity.test.js pins the two together. */
export function formatPropertyAddress(job = {}, { includeZip = true } = {}) {
  const clean  = (v) => String(v ?? '').trim();
  const street = [clean(job.address), clean(job.city)].filter(Boolean).join(', ');
  const region = [clean(job.state) || 'UT', includeZip ? clean(job.zip) : ''].filter(Boolean).join(' ');
  return [street, region].filter(Boolean).join(', ');
}

/* Rewrite the literal address GROUP before the individual tokens are replaced.

   Doing it here rather than adding `{{property_address}}` to the six new
   templates is deliberate: the group is also written this way in the live
   work_auth, direction_pay and change_order rows, which carry legally reviewed
   wording. This repairs those too, without a migration that edits what a
   customer signs — the only visible change is that an empty part stops
   producing a stray comma.

   Authors of NEW wording should use {{property_address}} instead; it is
   substituted below and needs no pattern matching. */
const ADDRESS_GROUP_RE = /\{\{address\}\},\s*\{\{city\}\},\s*\{\{state\}\}(\s*\{\{zip\}\})?/g;

export function collapseAddressGroups(body, job) {
  return String(body ?? '').replace(
    ADDRESS_GROUP_RE,
    (_match, zipPart) => formatPropertyAddress(job, { includeZip: Boolean(zipPart) }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  VARIABLE SUBSTITUTION
// ─────────────────────────────────────────────────────────────────────────────
// `signedAt` is defaulted so both existing call sites keep working unchanged.
// It exists because {{date}} was silently broken: SignPage.jsx resolved it but
// this function had no branch for it, so a template using {{date}} rendered the
// real date on screen and the literal string "{{date}}" in the signed PDF — the
// client read one document and signed another. Pass the real signing timestamp
// so the substituted date matches sign_requests.signed_at rather than drifting
// by however long the PDF build takes.
function substituteVars(body, job, signedAt = new Date()) {
  const hasInsurance = !!job.insurance_company;
  const dolFormatted = job.date_of_loss
    ? new Date(job.date_of_loss).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  const insuranceSection = hasInsurance
    ? `DIRECTION OF PAYMENT\n\nI hereby direct ${job.insurance_company} to pay Utah Pros Restoration directly for all restoration services performed at the above property under Claim No. ${job.claim_number || '[Pending]'}. I authorize Utah Pros Restoration to negotiate, supplement, and finalize my claim on my behalf.`
    : `PRIVATE PAY & CONDITIONAL ASSIGNMENT OF BENEFITS\n\nI acknowledge that no insurance claim has been filed as of the date of this Agreement. Should I subsequently file an insurance claim for damage addressed by this Agreement, I hereby IRREVOCABLY PRE-ASSIGN to Utah Pros Restoration all insurance proceeds attributable to the work performed hereunder. This pre-assignment is retroactive to the date of this Agreement. I will notify Utah Pros Restoration within 3 business days of filing any claim and will immediately execute a Direction to Pay/Assignment of Benefits upon request. My payment obligation is unconditional and not contingent on any insurance filing, approval, or payment.`;

  // The group rewrite must run BEFORE the individual tokens — once {{city}} has
  // been replaced with '' there is no group left to recognise.
  return collapseAddressGroups(body, job)
    .replace(/\{\{property_address\}\}/g,  formatPropertyAddress(job))
    .replace(/\{\{client_name\}\}/g,       job.insured_name      || '')
    .replace(/\{\{company_name\}\}/g,      'Utah Pros Restoration')
    .replace(/\{\{address\}\}/g,           job.address           || '')
    .replace(/\{\{city\}\}/g,              job.city              || '')
    .replace(/\{\{state\}\}/g,             job.state             || 'UT')
    .replace(/\{\{zip\}\}/g,               job.zip               || '')
    .replace(/\{\{job_number\}\}/g,        job.job_number        || '')
    .replace(/\{\{insurance_company\}\}/g, job.insurance_company || '')
    .replace(/\{\{policy_number\}\}/g,     job.policy_number     || '')
    .replace(/\{\{claim_number\}\}/g,      job.claim_number      || '')
    .replace(/\{\{date_of_loss\}\}/g,      dolFormatted)
    .replace(/\{\{adjuster_name\}\}/g,     job.adjuster_name     || '')
    .replace(/\{\{date\}\}/g,              signedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))
    .replace(/\{\{insurance_section\}\}/g, insuranceSection);
}

/* Split a line into {text, bold} runs.

   THE EXPRESSION IS COPIED, DELIBERATELY, from SignPage.jsx's renderMarkdown —
   `/(\*\*[^*]+\*\*)/g` there, newline-excluded here only because the worker
   joins wrapped source lines into one block while the screen splits on '\n'
   first, so excluding \n is what makes the two agree rather than diverge.
   src/ and functions/ are separate bundles and cannot import each other;
   tests/qa/unit/esign-bold-run-parity.test.js pins them together.

   Unbalanced or nested markers match nothing and survive as literal text —
   the same thing the screen does with them. */
export function parseBoldRuns(str) {
  if (!str) return [];
  return String(str)
    .split(/(\*\*[^*\n]+\*\*)/g)
    .filter(Boolean)
    .map(part => (part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? { text: part.slice(2, -2), bold: true }
      : { text: part, bold: false }));
}

/* Headings are already drawn in the bold font, so a `**` inside one carries no
   extra meaning — it would only print as punctuation on a signed document. */
export function stripBoldMarkers(str) {
  return parseBoldRuns(str).map(r => r.text).join('');
}

/* Tokenize a body line into words and wrap it to `maxWidth` — the whole of the
   PDF body layout, with pdf-lib removed.

   WHY THIS IS A PURE, EXPORTED FUNCTION AND NOT A CLOSURE.
   It used to live inside buildPdf's `drawWrapped`, where nothing could call it,
   so every test covering it read this file as TEXT and grepped for the guards
   below. Three defects reached signed customer legal documents through that
   green — literal `**` on the page, `delay ,` with a space before the comma,
   and then `hasnot been confirmedby`, which the fix for the second one
   introduced and which was live in production for hours. Each was found by a
   human rendering a PDF and reading it. Source-contract assertions pin what the
   code SAYS; only running it pins what it PRODUCES.

   `measure(text, bold, size) → width` is injected, so the caller owns the fonts
   and a test can wrap deterministically with something like
   `(t) => t.length * 5`. Returns one entry per drawn line:

     [{ text: 'has not been confirmed by',
        words: [{ pieces: [{ text, bold }], gapAfter }] }]

   `text` is the line as it reads on the page. `words`/`pieces` carry what the
   caller needs to draw it: pieces of one word are drawn back to back with NO
   gap, and `gapAfter` is the inter-word space (0 on the last word of a line). */
export function layoutWrappedRuns(str, { measure, maxWidth, size } = {}) {
  if (!str?.trim()) return [];

  // Tokenize into WORDS, where a word may span more than one font run.
  //
  // That nuance is the whole point. In "disposed of **without delay**, both",
  // the bold run ends immediately before the comma, so the comma opens the
  // next run. Splitting each run on ' ' independently made that comma its own
  // word and put a space in front of it — a real signed PDF read
  // "without delay , both" (found 2026-08-08 by rendering one). A space
  // belongs between two words only where the SOURCE had whitespace.
  //
  // pdfSafe() still runs before every measurement, not just the final
  // drawText, which is why it is applied per run.
  //
  // ⚠️ pdfSafe() TRIMS (pdfText.js: `.replace(/^\s+|\s+$/g, '')`), and that trim
  // destroys the one signal this loop depends on. For "has **not confirmed**"
  // the regular run is "has " — pdfSafe returns "has", the trailing space is
  // gone, so the split yields no empty tail, `current` still points at "has",
  // and the bold run's first piece is appended to it: "hasnot". A real signed
  // PDF read "hasnot been confirmedby any insurance carrier" (found 2026-08-08
  // by reading one the owner had just signed). The first version of this fix
  // traded "delay ," for that, because it only ever ended a word on an INTERNAL
  // split point and never on a run's own edge.
  //
  // So capture the edges from the RAW run text, before pdfSafe can eat them.
  const words = [];          // each word: [{ text, bold }, …]
  let current = null;
  for (const run of parseBoldRuns(str)) {
    const bold = Boolean(run.bold);
    const raw  = String(run.text ?? '');
    const safe = pdfSafe(raw);

    // Whitespace immediately BEFORE this run ends the previous word, even
    // though the split below can no longer see it.
    if (/^\s/.test(raw)) current = null;

    safe.split(' ').forEach((piece, i) => {
      // Any split point after the first came from real whitespace, so it ends
      // the word in progress. A run boundary on its own does not.
      if (i > 0) current = null;
      if (!piece) return;
      if (!current) { current = []; words.push(current); }
      current.push({ text: piece, bold });
    });

    // …and whitespace immediately AFTER it ends the word this run just built.
    if (/\s$/.test(raw)) current = null;
  }
  if (words.length === 0) return [];

  const wordWidth = (word) =>
    word.reduce((sum, p) => sum + measure(p.text, p.bold, size), 0);
  // The space after a word takes that word's LAST font, matching how the line
  // width is accumulated below — otherwise the drawn line drifts from the
  // measured one and a bold run can overrun the right margin.
  const spaceAfter = (word) => measure(' ', word[word.length - 1].bold, size);

  const lines = [];
  let line  = [];
  let lineW = 0;

  const flushLine = () => {
    if (line.length === 0) return;
    const drawn = line.map((word, i) => ({
      pieces:   word.map(p => ({ text: p.text, bold: p.bold })),
      gapAfter: i < line.length - 1 ? spaceAfter(word) : 0,
    }));
    lines.push({
      text:  drawn.map(w => w.pieces.map(p => p.text).join('')).join(' '),
      words: drawn,
    });
    line  = [];
    lineW = 0;
  };

  for (const word of words) {
    const wordW = wordWidth(word);
    const gapW  = line.length ? spaceAfter(line[line.length - 1]) : 0;
    if (line.length && lineW + gapW + wordW > maxWidth) {
      flushLine();
      line  = [word];
      lineW = wordW;
    } else {
      line.push(word);
      lineW += gapW + wordW;
    }
  }
  flushLine();

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
//  MARKDOWN SECTION PARSER
//  Splits on ## headings → [{heading, body}]
// ─────────────────────────────────────────────────────────────────────────────
function parseMarkdownSections(body) {
  const lines = body.split('\n');
  const sections = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current);
      current = { heading: line.slice(3).trim(), paragraphs: [] };
    } else {
      if (!current) current = { heading: null, paragraphs: [] };
      // Accumulate lines into paragraphs (blank line = paragraph break)
      if (line.trim() === '') {
        if (current.paragraphs.length > 0 && current.paragraphs[current.paragraphs.length - 1] !== null) {
          current.paragraphs.push(null); // null = paragraph separator
        }
      } else {
        current.paragraphs.push(line);
      }
    }
  }
  if (current) sections.push(current);

  // Convert paragraphs array to text blocks
  return sections
    .map(s => {
      const blocks = [];
      let block = [];
      for (const p of (s.paragraphs || [])) {
        if (p === null) {
          if (block.length) { blocks.push(block.join(' ')); block = []; }
        } else {
          block.push(p.trim());
        }
      }
      if (block.length) blocks.push(block.join(' '));
      return { heading: s.heading, blocks };
    })
    .filter(s => s.heading || s.blocks.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PDF BUILDER — clean cursor-based approach, no shared mutable state issues
// ─────────────────────────────────────────────────────────────────────────────
async function buildPdf({ job, signer_name, signature_png, signed_at, doc_type, divisions, templateSections, signer_ip, consents }) {
  const pdfDoc = await PDFDocument.create();
  const fBold  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fReg   = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const PW = 612, PH = 792, M = 56, CW = PW - M * 2;
  // Company pre-authorization block — see CO_SIGNED_DOC_TYPES at the top.
  const needsCoSig   = CO_SIGNED_DOC_TYPES.has(doc_type);
  // Recon agreement also renders a 4-line attestations block below the signature
  const ATTEST_H     = consents ? 120 : 0;
  const SIG_BLOCK_H  = (needsCoSig ? 210 : 130) + ATTEST_H;
  const FOOTER_H     = 60;
  const MIN_Y        = SIG_BLOCK_H + FOOTER_H;

  const black = rgb(0.05, 0.05, 0.05);
  const gray  = rgb(0.40, 0.40, 0.40);
  const lgray = rgb(0.85, 0.85, 0.85);
  const blue  = rgb(0.145, 0.388, 0.922);
  const white = rgb(1, 1, 1);

  // ── Cursor: single source of truth for current page and Y ──
  let curPage = null;
  let curY    = 0;

  const newPage = () => {
    curPage = pdfDoc.addPage([PW, PH]);
    curY    = PH - 40;
  };

  // Ensure there's at least `needed` px before adding a new page
  const needY = (needed) => {
    if (curY < needed) newPage();
  };

  // ── Draw helpers (all use curPage / curY) ──
  // pdfSafe() here is the single choke point for this file — see
  // ../lib/pdfText.js for why (a real production PDF crash, 2026-07-21, on
  // the sibling demo-sheet-pdf.js worker). This file signs real customer
  // consent/authorization documents — signer_name is customer-typed and
  // was previously drawn with zero sanitization at all.
  const drawText = (str, x, y, { font = fReg, size = 10, color = black } = {}) => {
    if (!str) return;
    curPage.drawText(pdfSafe(str), { x, y, font, size, color });
  };

  const drawLine = (x1, y, x2, opts = {}) => {
    curPage.drawLine({
      start: { x: x1, y },
      end:   { x: x2, y },
      thickness: opts.thickness || 0.5,
      color:     opts.color     || lgray,
    });
  };

  // Wrap and draw a single line of text (no embedded newlines).
  // Returns new curY after drawing.
  //
  // BOLD RUNS. The template bodies use `**emphasis**`, and SignPage's
  // renderMarkdown draws it bold on the screen the customer actually reads.
  // This renderer used to draw every body paragraph in fReg with no parsing at
  // all, so the SIGNED PDF printed the literal asterisks — verified 2026-08-08
  // on a real stored cat3_removal PDF, which read "**Category 3 — grossly
  // contaminated**". The screen and the signed legal document disagreeing about
  // emphasis is the defect; the split parseBoldRuns uses is deliberately the
  // SAME expression SignPage uses, so neither can drift from the other. An
  // unbalanced or multi-line `**` matches nothing and falls through as literal
  // text on both sides, which is also what the screen does.
  //
  // ALL of the tokenizing and wrapping lives in the exported, pure
  // layoutWrappedRuns() above — this is only the pdf-lib half: measure with the
  // real embedded fonts, then draw what came back. Keep it that way. While the
  // layout was a closure in here nothing could call it, so its only cover was
  // tests that read this file as text, and three defects reached signed
  // customer documents through a fully green suite.
  const drawWrapped = (str, x, maxW, { font = fReg, boldFont = fBold, size = 9.5, color = black, lh = 14 } = {}) => {
    const fontFor = (bold) => (bold ? boldFont : font);
    const lines = layoutWrappedRuns(str, {
      measure:  (text, bold) => fontFor(bold).widthOfTextAtSize(text, size),
      maxWidth: maxW,
      size,
    });

    for (const wrapped of lines) {
      needY(MIN_Y);
      let cx = x;
      for (const word of wrapped.words) {
        // Pieces of one word are drawn back to back with NO gap — that is what
        // keeps the comma tight against "delay" when the bold run ends first.
        for (const piece of word.pieces) {
          drawText(piece.text, cx, curY, { font: fontFor(piece.bold), size, color });
          cx += fontFor(piece.bold).widthOfTextAtSize(piece.text, size);
        }
        cx += word.gapAfter;
      }
      curY -= lh;
    }

    return curY;
  };

  // Draw a multi-paragraph block (paragraphs separated by blank line).
  // Each paragraph is a single string (pre-joined lines).
  const drawParagraphs = (paragraphs, x, maxW, opts = {}) => {
    const { paraGap = 8, ...textOpts } = opts;
    for (const para of paragraphs) {
      if (!para?.trim()) { curY -= paraGap; continue; }
      drawWrapped(para, x, maxW, textOpts);
      curY -= paraGap;
    }
  };

  // ── PAGE 1: header ──
  newPage();
  curY = PH - 48;

  // Header bar
  curPage.drawRectangle({ x: 0, y: PH - 80, width: PW, height: 80, color: rgb(0.118, 0.161, 0.231) });
  drawText('Utah Pros Restoration',                        M, PH - 32, { font: fBold, size: 18, color: white });
  drawText('Licensed · Insured · Utah',                    M, PH - 50, { font: fReg,  size: 10, color: rgb(0.58, 0.65, 0.75) });
  drawText('(801) 427-0582  ·  restoration@utah-pros.com', M, PH - 65, { font: fReg,  size: 9,  color: rgb(0.58, 0.65, 0.75) });
  curY = PH - 80 - 28;

  // Title
  const titleLabel = DOC_TITLES[doc_type] || 'Document';
  const titleW = fBold.widthOfTextAtSize(titleLabel, 18);
  drawText(titleLabel, (PW - titleW) / 2, curY, { font: fBold, size: 18 });
  curY -= 8;
  curPage.drawLine({
    start: { x: (PW - 160) / 2, y: curY }, end: { x: (PW + 160) / 2, y: curY },
    thickness: 2, color: blue,
  });
  curY -= 24;

  // Job info grid
  const c1 = M, c2 = M + 260;
  const infoRow = (label, val, col, y) => {
    drawText(label,     col, y,      { font: fBold, size: 9,  color: gray });
    drawText(val || '—', col, y - 13, { font: fReg,  size: 10, color: black });
  };
  const addr = [job.address, job.city, job.state].filter(Boolean).join(', ');
  const dolStr = job.date_of_loss
    ? new Date(job.date_of_loss).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  infoRow('CLIENT NAME',       job.insured_name,      c1, curY);
  infoRow('JOB NUMBER',        job.job_number,        c2, curY); curY -= 32;
  infoRow('PROPERTY ADDRESS',  addr,                  c1, curY);
  infoRow('DATE OF LOSS',      dolStr,                c2, curY); curY -= 32;
  infoRow('INSURANCE COMPANY', job.insurance_company, c1, curY);
  infoRow('CLAIM NUMBER',      job.claim_number,      c2, curY); curY -= 22;
  drawLine(M, curY, PW - M); curY -= 20;

  // ── DOCUMENT BODY ──
  const sections = templateSections || buildCocSections(divisions);

  for (const s of sections) {
    if (s.heading) {
      needY(MIN_Y + 50);
      drawText(stripBoldMarkers(s.heading), M, curY, { font: fBold, size: 11 });
      curY -= 18;
    }

    // CoC uses {heading, body} string; template sections use {heading, blocks} array
    if (s.body) {
      // Single body string (CoC) — treat as one paragraph
      drawParagraphs([s.body], M, CW, { font: fReg, size: 9.5, color: black, lh: 14, paraGap: 6 });
      curY -= 4;
    } else if (s.blocks?.length) {
      // Template sections — array of paragraph strings
      drawParagraphs(s.blocks, M, CW, { font: fReg, size: 9.5, color: black, lh: 14, paraGap: 8 });
    }

    curY -= 4;
  }

  drawLine(M, curY + 4, PW - M); curY -= 18;

  // ── AUTHORIZATION TEXT ──
  needY(MIN_Y + 60);
  drawParagraphs(
    ['By signing below, I confirm that I am authorized to sign on behalf of the property owner and all responsible parties, and that the information above is accurate to the best of my knowledge. I authorize Utah Pros Restoration to receive payment directly for all work performed under this agreement.'],
    M, CW, { font: fReg, size: 9.5, color: gray, lh: 14, paraGap: 0 }
  );
  curY -= 22;

  // ── SIGNATURE BLOCK — always on enough space ──
  needY(SIG_BLOCK_H + FOOTER_H + 20);
  curPage.drawRectangle({
    x: M - 8, y: curY - 90,
    width: PW - (M - 8) * 2, height: 100,
    color: rgb(0.975, 0.978, 0.984),
    borderColor: lgray, borderWidth: 0.5,
  });

  try {
    const b64   = signature_png.replace(/^data:image\/png;base64,/, '');
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const img   = await pdfDoc.embedPng(bytes);
    const dims  = img.scale(1);
    const scale = Math.min(220 / dims.width, 70 / dims.height, 1);
    curPage.drawImage(img, {
      x: M, y: curY - 76,
      width: dims.width * scale, height: dims.height * scale,
      opacity: 0.9,
    });
  } catch (e) { console.warn('Sig embed failed:', e.message); }

  const rx = M + CW / 2 + 12;
  drawText('PRINTED NAME',  rx, curY - 8,  { font: fBold, size: 8, color: gray });
  drawText(signer_name,     rx, curY - 22, { font: fBold, size: 11 });
  drawText('DATE SIGNED',   rx, curY - 44, { font: fBold, size: 8, color: gray });
  drawText(
    signed_at.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    rx, curY - 58, { font: fReg, size: 10 }
  );
  drawLine(M, curY - 82, M + 240, { thickness: 0.75, color: rgb(0.6, 0.6, 0.6) });
  drawText('Authorized Signature', M, curY - 94, { font: fReg, size: 8, color: gray });

  // ── COMPANY PRE-AUTHORIZATION BLOCK (Work Auth, Change Order, Recon Agreement) ──
  if (needsCoSig) {
    const cy = curY - 110; // start below client sig box
    drawLine(M, cy + 8, PW - M, { thickness: 0.5, color: lgray });
    curPage.drawRectangle({
      x: M - 8, y: cy - 64,
      width: PW - (M - 8) * 2, height: 72,
      color: rgb(0.965, 0.972, 0.984),
      borderColor: lgray, borderWidth: 0.5,
    });
    // Left: company info
    drawText('AUTHORIZED BY UTAH PROS RESTORATION', M, cy - 6,  { font: fBold, size: 8, color: gray });
    drawText('Moroni Salvador',                       M, cy - 20, { font: fBold, size: 11, color: black });
    drawText('Director of Operations',                M, cy - 34, { font: fReg,  size: 9,  color: gray });
    drawLine(M, cy - 46, M + 200, { thickness: 0.75, color: rgb(0.7, 0.7, 0.7) });
    drawText('Authorized Company Representative',     M, cy - 58, { font: fReg, size: 8, color: gray });
    // Right: date pre-authorized
    drawText('DATE PRE-AUTHORIZED', rx, cy - 6,  { font: fBold, size: 8, color: gray });
    drawText(
      signed_at.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      rx, cy - 20, { font: fReg, size: 10 }
    );
    drawText('Electronically pre-signed on behalf', rx, cy - 36, { font: fReg, size: 8, color: gray });
    drawText('of Utah Pros Restoration',             rx, cy - 48, { font: fReg, size: 8, color: gray });
  }

  // ── ACKNOWLEDGMENTS BLOCK (recon_agreement only) ──
  // Audit-defensible record of the four separately-attested consents. Drawn below
  // the signature (and optional co-sig) block so it reads as "these are what was
  // affirmatively acknowledged at sign time".
  if (consents) {
    // Move cursor to below whatever was drawn in the sig/cosig blocks
    curY = curY - (needsCoSig ? 190 : 110);
    needY(ATTEST_H + FOOTER_H);

    drawText('ACKNOWLEDGMENTS — ATTESTED AT SIGNING', M, curY, { font: fBold, size: 8, color: gray });
    curY -= 16;

    const amber = rgb(0.96, 0.62, 0.04);
    const attestRows = [
      { ok: !!consents.terms,      text: 'I have read and agree to the Terms & Conditions attached to this Agreement.' },
      { ok: !!consents.commitment, text: 'I am committing to use Utah Pros for reconstruction; cancellation after estimate preparation is subject to the fees in Section 1.' },
      { ok: !!consents.esign,      text: 'I consent to electronic signature under the Utah UETA and federal E-SIGN Act.' },
      { ok: !!consents.authority,  text: 'I am the property owner or authorized representative with authority to authorize reconstruction and payment terms.' },
    ];

    for (const r of attestRows) {
      const lineY = curY;
      // Checkbox square — filled amber if attested, empty otherwise
      curPage.drawRectangle({
        x: M, y: lineY - 1, width: 9, height: 9,
        color:        r.ok ? amber : white,
        borderColor:  r.ok ? amber : rgb(0.5, 0.5, 0.5),
        borderWidth:  0.5,
      });
      if (r.ok) {
        // White check mark inside filled box
        curPage.drawLine({ start: { x: M + 1.5, y: lineY + 3 }, end: { x: M + 3.5, y: lineY + 1 }, thickness: 1.1, color: white });
        curPage.drawLine({ start: { x: M + 3.5, y: lineY + 1 }, end: { x: M + 7.5, y: lineY + 6 }, thickness: 1.1, color: white });
      }
      // Attestation text (wraps if needed; drawWrapped advances curY)
      drawWrapped(r.text, M + 16, CW - 16, { font: fReg, size: 9, color: black, lh: 12 });
      curY -= 4;
    }
  }

  // ── FOOTER on every page ──
  const footerParts = [
    `Electronically signed · ${signed_at.toISOString()}`,
    signer_ip ? `IP: ${signer_ip}` : null,
    'Utah Pros Restoration · utah-pros.com',
  ].filter(Boolean).join(' · ');
  for (const p of pdfDoc.getPages()) {
    p.drawLine({ start: { x: M, y: 50 }, end: { x: PW - M, y: 50 }, thickness: 0.5, color: lgray });
    p.drawText(footerParts, { x: M, y: 36, font: fReg, size: 7.5, color: rgb(0.6, 0.6, 0.6) });
  }

  return pdfDoc.save();
}

// ─────────────────────────────────────────────────────────────────────────────
//  CoC — hardcoded per-division completion text
// ─────────────────────────────────────────────────────────────────────────────
function buildCocSections(divisions) {
  const map = {
    water:          { heading: 'Water Damage Mitigation',   body: 'I confirm that all water mitigation services performed by Utah Pros Restoration at the above property have been completed to my satisfaction. The work was performed in a professional manner consistent with IICRC S500 standards and is 100% complete. I have no outstanding complaints or concerns.' },
    mold:           { heading: 'Mold Remediation',          body: 'I confirm that all mold remediation services performed by Utah Pros Restoration have been completed to my satisfaction. The affected areas have been properly contained, treated, and cleared in accordance with IICRC S520 standards. The work is 100% complete and I have no outstanding complaints or concerns.' },
    reconstruction: { heading: 'Repairs & Reconstruction',  body: 'I confirm that all repairs and reconstruction performed by Utah Pros Restoration have been completed to my satisfaction. The repaired portions of the property are in equal or better condition than prior to the loss. The work is 100% complete and I have no outstanding complaints or concerns.' },
    fire:           { heading: 'Fire & Smoke Restoration',  body: 'I confirm that all fire and smoke restoration services performed by Utah Pros Restoration have been completed to my satisfaction. The work was performed in a professional manner and is 100% complete. I have no outstanding complaints or concerns.' },
    contents:       { heading: 'Contents Restoration',      body: 'I confirm that Utah Pros Restoration has returned all salvageable contents items in satisfactory condition. I have had the opportunity to inspect the returned items. The work is 100% complete and I have no outstanding complaints or concerns.' },
  };
  const ORDER  = ['water', 'mold', 'reconstruction', 'fire', 'contents'];
  const divArr = Array.isArray(divisions) ? divisions : (divisions ? [divisions] : []);
  const sorted = [...divArr].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const result = sorted.map(d => map[d]).filter(Boolean);
  return result.length ? result : [{
    heading: 'Work Completed',
    body:    'I confirm that all restoration services performed by Utah Pros Restoration have been completed to my satisfaction. The work was performed in a professional manner and is 100% complete. I have no outstanding complaints or concerns.',
  }];
}

// DOC_TITLES moved to the top of this file (see the note there) so the
// confirmation emails and the PDF share one map instead of two copies.
