/**
 * ════════════════════════════════════════════════
 * FILE: send-invoice.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Emails a customer their invoice from UPR — the PDF attached, plus a link to
 *   a page where they can pay it. Until now every invoice email left from
 *   QuickBooks, and UPR could not see what was sent or to whom.
 *
 * WHERE IT LIVES:
 *   Route:  POST /api/send-invoice   body { invoice_id, to?, expires_days? }
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  cors, auth, http, supabase, email, worker-runs, invoice-pdf,
 *              send-signed-copy (address helpers + chunked base64)
 *   Data:      reads  → invoices, invoice_line_items, contacts, jobs, claims, payments
 *              writes → invoice_shares (through create_invoice_share), worker_runs
 *
 * NOTES / GOTCHAS:
 *   - **The PDF is ATTACHED, and the pay link is separate.** The attachment is
 *     the record the customer keeps; the link is the thing that expires. Sending
 *     only a link would mean an expired URL leaves them holding nothing.
 *   - **The @noemail.local trap.** Some contacts carry a synthetic placeholder
 *     address invented to satisfy a not-null check. A bare truthiness test sails
 *     past it and bounces on a fake TLD, costing sender reputation. Uses the
 *     shared `hasRealEmail` predicate rather than a fourth copy of the rule.
 *   - Sending SUPERSEDES any previous link for the invoice, so one invoice never
 *     has several live payment URLs.
 *   - Staff-triggered only. This must not become an automated sender without a
 *     separate review — `sendAutomatedMessage()` and its consent chokepoint
 *     exist for that, and this deliberately is not it.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { requireRole } from '../lib/auth.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';
import { sendEmail } from '../lib/email.js';
import { recordWorkerRun } from '../lib/worker-runs.js';
import { loadInvoiceModel, buildInvoicePdf } from './invoice-pdf.js';
import { toBase64, hasRealEmail, looksLikeEmail } from './send-signed-copy.js';

const BILLING_ROLES = ['admin', 'office', 'project_manager'];
const DEFAULT_EXPIRY_DAYS = 60;

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function buildEmailHtml({ customerName, invoiceNumber, balance, dueDate, payUrl }) {
  const greeting = customerName ? `Hi ${escHtml(customerName)},` : 'Hello,';
  const due = dueDate ? `<p style="margin:0 0 6px;color:#475467;font-size:14px;">Due ${escHtml(dueDate)}</p>` : '';
  return `<!-- invoice -->
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#101828;">
  <div style="font-size:17px;font-weight:700;margin-bottom:18px;">Utah Pros Restoration</div>
  <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">${greeting}</p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">
    Your invoice ${escHtml(invoiceNumber)} is attached. You can pay online using the button below,
    or reply to this email if you have any questions.
  </p>
  <div style="background:#f7f8fa;border:1px solid #eaecf0;border-radius:12px;padding:18px;margin:0 0 20px;">
    <div style="font-size:12px;font-weight:700;letter-spacing:.05em;color:#98a2b3;text-transform:uppercase;">Balance due</div>
    <div style="font-size:26px;font-weight:800;margin:4px 0 2px;">${escHtml(money(balance))}</div>
    ${due}
  </div>
  <a href="${escHtml(payUrl)}"
     style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px;">
    Pay this invoice
  </a>
  <p style="font-size:13px;line-height:1.6;color:#667085;margin:20px 0 0;">
    Or open this link: <br><a href="${escHtml(payUrl)}" style="color:#2563eb;">${escHtml(payUrl)}</a>
  </p>
  <p style="font-size:12.5px;line-height:1.6;color:#98a2b3;margin:22px 0 0;border-top:1px solid #eaecf0;padding-top:14px;">
    Utah Pros Restoration · (801) 427-0582 · restoration@utah-pros.com<br>
    Payments are processed securely by Stripe. We never see or store your card or bank details.
  </p>
</div>`;
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const startedAt = new Date().toISOString();
  const db = supabase(env, fetchWithTimeout);

  const auth = await requireRole(request, env, db, BILLING_ROLES, fetchWithTimeout);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Provide invoice_id' }, 400, request, env); }
  if (!body || typeof body.invoice_id !== 'string' || !body.invoice_id.trim()) {
    return jsonResponse({ error: 'Provide invoice_id' }, 400, request, env);
  }

  const expiresDays = Number.isSafeInteger(body.expires_days) ? body.expires_days : DEFAULT_EXPIRY_DAYS;
  if (expiresDays < 1 || expiresDays > 365) {
    return jsonResponse({ error: 'expires_days must be between 1 and 365' }, 400, request, env);
  }

  try {
    const model = await loadInvoiceModel(db, body.invoice_id);
    if (!model) return jsonResponse({ error: 'Invoice not found' }, 404, request, env);

    const { inv, contact } = model;
    const total = Number(inv.adjusted_total ?? inv.total ?? 0);
    const balance = total - Number(inv.amount_paid || 0);
    if (!(balance > 0)) {
      return jsonResponse({ error: 'This invoice has no outstanding balance.' }, 400, request, env);
    }

    // Who to send to. An explicit override wins so staff can redirect a bill to
    // an adjuster or an AP address without editing the contact.
    const recipient = String(body.to || contact?.email || '').trim();
    if (!recipient) {
      return jsonResponse({ error: 'No email address on file for this customer.' }, 400, request, env);
    }
    // The @noemail.local trap: a placeholder invented to satisfy a not-null
    // check. Sending to it bounces on a fake TLD and costs sender reputation.
    if (!hasRealEmail(recipient)) {
      return jsonResponse({
        error: 'This customer has a placeholder email address, not a real one. Add a real address first.',
      }, 400, request, env);
    }
    if (!looksLikeEmail(recipient)) {
      return jsonResponse({ error: 'That does not look like an email address.' }, 400, request, env);
    }

    // Mint the link FIRST. If the email then fails, staff still have a usable
    // URL to send by hand rather than a silent dead end — the same ordering
    // send-esign.js uses for the same reason.
    const shareRow = await db.rpc('create_invoice_share', {
      p_invoice_id: inv.id,
      p_sent_to_email: recipient,
      p_expires_days: expiresDays,
      p_created_by: auth.employee?.id || null,
    });
    const share = Array.isArray(shareRow) ? shareRow[0] : shareRow;
    if (!share?.token) throw new Error('Could not create the payment link');

    const base = (env.APP_BASE_URL || new URL(request.url).origin).replace(/\/$/, '');
    const payUrl = `${base}/pay/${share.token}`;

    const pdfBytes = await buildInvoicePdf(model);
    const docNumber = inv.qbo_doc_number || inv.invoice_number || 'invoice';

    const sent = await sendEmail(env, {
      to: recipient,
      subject: `Invoice ${docNumber} from Utah Pros Restoration — ${money(balance)} due`,
      html: buildEmailHtml({
        customerName: contact?.name,
        invoiceNumber: docNumber,
        balance,
        dueDate: inv.due_date,
        payUrl,
      }),
      attachments: [{
        filename: `Invoice ${docNumber}.pdf`,
        content: toBase64(pdfBytes),
        contentType: 'application/pdf',
      }],
      // Content-derived, never Date.now(): a retry of the same send for the same
      // link must be recognised by Resend rather than delivered twice.
      idempotencyKey: `invoice-send-${share.id}`,
    });

    if (!sent?.ok) {
      // The link exists and is usable; only delivery failed. Say exactly that,
      // and hand back the URL so it can be sent another way.
      await recordWorkerRun(db, {
        workerName: 'send-invoice', status: 'error',
        errorMessage: sent?.error || 'email delivery failed', startedAt,
        meta: { invoice_id: inv.id, share_id: share.id },
      }).catch(() => {});
      return jsonResponse({
        ok: false,
        delivered: false,
        error: 'The payment link was created but the email could not be sent.',
        pay_url: payUrl,
      }, 502, request, env);
    }

    await db.update('invoice_shares', `id=eq.${share.id}`, {
      sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).catch(() => {});

    await recordWorkerRun(db, {
      workerName: 'send-invoice', status: 'completed', recordsProcessed: 1, startedAt,
      meta: { invoice_id: inv.id, share_id: share.id, to: recipient },
    }).catch(() => {});

    return jsonResponse({
      ok: true,
      delivered: true,
      sent_to: recipient,
      pay_url: payUrl,
      expires_at: share.expires_at,
    }, 200, request, env);
  } catch (err) {
    await recordWorkerRun(db, {
      workerName: 'send-invoice', status: 'error',
      errorMessage: err?.message || String(err), startedAt,
      meta: { invoice_id: body.invoice_id },
    }).catch(() => {});
    return jsonResponse({ error: err.message || 'Could not send the invoice' }, 500, request, env);
  }
}
