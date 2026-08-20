/**
 * ════════════════════════════════════════════════
 * FILE: invoice-pdf.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Turns one UPR invoice into a printable PDF the customer can be sent, and
 *   files a copy against the job. Until now the only invoice PDF a customer ever
 *   saw was made by QuickBooks; this is UPR's own.
 *
 * WHERE IT LIVES:
 *   Route:  POST /api/invoice-pdf   body { invoice_id }
 *
 * DEPENDS ON:
 *   Packages:  pdf-lib
 *   Internal:  cors, auth, http, supabase, pdfText, worker-runs
 *   Data:      reads  → invoices, invoice_line_items, contacts, jobs, claims, payments
 *              writes → Storage (job-documents-private), job_documents, worker_runs
 *
 * NOTES / GOTCHAS:
 *   - **Every string goes through pdfSafe.** pdf-lib's StandardFonts are
 *     WinAnsi, so one emoji or newline in a customer-entered description throws
 *     mid-build and kills the whole document. A production scope sheet failed
 *     exactly this way on 2026-07-21.
 *   - Reads the tables directly rather than through an RPC: this runs on the
 *     service-role client, so a purpose-built definer function would add a
 *     migration and an owner-gated apply for no access it does not already have.
 *   - Money is read, never written. `balance_due` is GENERATED and
 *     `amount_paid` is trigger-owned; this worker only renders them.
 *   - Stored in the PRIVATE bucket. An invoice carries the claim number, the
 *     policy number and the loss address; the public bucket would make holding
 *     the path the entire access control.
 * ════════════════════════════════════════════════
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { requireRole } from '../lib/auth.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';
import { deepPdfSafe } from '../lib/pdfText.js';
import { recordWorkerRun } from '../lib/worker-runs.js';

const BILLING_ROLES = ['admin', 'office', 'project_manager'];
const BUCKET = 'job-documents-private';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
};

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

/**
 * Assemble everything the document needs.
 *
 * Deliberately several small reads rather than one clever join: the shapes are
 * trivial, and a failure here should say which lookup failed.
 */
async function loadInvoiceModel(db, invoiceId) {
  const inv = (await db.select('invoices', `id=eq.${invoiceId}&select=*&limit=1`))?.[0];
  if (!inv) return null;

  const lines = (await db.select(
    'invoice_line_items',
    `invoice_id=eq.${inv.id}&select=id,description,quantity,unit,unit_price,line_total,qbo_item_name,sort_order,created_at&order=sort_order.asc,created_at.asc`,
  )) || [];

  const payments = (await db.select(
    'payments',
    `invoice_id=eq.${inv.id}&select=id,amount,refunded_amount,payment_date,payment_method,payer_type,reference_number&order=payment_date.asc`,
  )) || [];

  const job = inv.job_id
    ? (await db.select('jobs', `id=eq.${inv.job_id}&select=id,job_number,address,city,state,zip,claim_id,primary_contact_id&limit=1`))?.[0]
    : null;

  const contactId = inv.contact_id || job?.primary_contact_id || null;
  const contact = contactId
    ? (await db.select('contacts', `id=eq.${contactId}&select=id,name,email,phone&limit=1`))?.[0]
    : null;

  const claim = job?.claim_id
    ? (await db.select('claims', `id=eq.${job.claim_id}&select=id,claim_number,insurance_carrier&limit=1`))?.[0]
    : null;

  return { inv, lines, payments, job, contact, claim };
}

/**
 * Port of the on-screen `.inv-print-doc` block in src/pages/InvoiceEditor.jsx.
 *
 * Exported so the document can be rendered and LOOKED AT without standing up a
 * worker — "produces a valid PDF" and "produces a correct invoice" are different
 * claims, and only the second one matters to a customer.
 */
export async function buildInvoicePdf(rawModel) {
  // Sanitize up front so neither drawText nor widthOfTextAtSize ever sees a
  // character WinAnsi cannot encode.
  const model = deepPdfSafe(rawModel);
  const { inv, lines, payments, job, contact, claim } = model;

  const pdfDoc = await PDFDocument.create();
  const fBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const PW = 612;
  const PH = 792;
  const M = 48;
  const FOOTER_H = 40;
  const MIN_Y = FOOTER_H + 20;

  const black = rgb(0.05, 0.05, 0.05);
  const gray = rgb(0.40, 0.40, 0.40);
  const faint = rgb(0.58, 0.58, 0.58);
  const lgray = rgb(0.85, 0.85, 0.85);
  const navy = rgb(0.118, 0.161, 0.231);
  const white = rgb(1, 1, 1);

  let curPage = null;
  let curY = 0;

  function drawText(str, x, y, { font = fReg, size = 10, color = black } = {}) {
    if (str == null || str === '') return;
    curPage.drawText(String(str), { x, y, font, size, color });
  }
  const drawLine = (x1, y, x2, opts = {}) => {
    curPage.drawLine({
      start: { x: x1, y }, end: { x: x2, y },
      thickness: opts.thickness || 0.5, color: opts.color || lgray,
    });
  };
  const fit = (str, font, size, maxW) => {
    let s = String(str ?? '');
    if (font.widthOfTextAtSize(s, size) <= maxW) return s;
    while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > maxW) s = s.slice(0, -1);
    return `${s}…`;
  };
  const right = (str, rightEdge, y, opts = {}) => {
    const font = opts.font || fReg;
    const size = opts.size || 10;
    drawText(str, rightEdge - font.widthOfTextAtSize(String(str ?? ''), size), y, opts);
  };

  const docNumber = inv.qbo_doc_number || inv.invoice_number || '';

  const drawHeader = () => {
    curPage.drawRectangle({ x: 0, y: PH - 56, width: PW, height: 56, color: navy });
    drawText('Utah Pros Restoration', M, PH - 26, { font: fBold, size: 13, color: white });
    drawText('Licensed · Insured · Utah · (801) 427-0582', M, PH - 41, {
      font: fReg, size: 8, color: rgb(0.62, 0.68, 0.76),
    });
    right('INVOICE', PW - M, PH - 26, { font: fBold, size: 13, color: white });
    if (docNumber) {
      right(`#${docNumber}`, PW - M, PH - 41, { font: fReg, size: 9, color: rgb(0.62, 0.68, 0.76) });
    }
    curY = PH - 56 - 26;
  };
  const newPage = () => { curPage = pdfDoc.addPage([PW, PH]); drawHeader(); };
  const needY = (needed) => { if (curY - needed < MIN_Y) newPage(); };

  newPage();

  // ── Bill to / dates ──
  const rightColX = PW - M - 170;
  drawText('BILL TO', M, curY, { font: fBold, size: 8.5, color: faint });
  drawText('INVOICE DATE', rightColX, curY, { font: fBold, size: 8.5, color: faint });
  curY -= 14;

  drawText(contact?.name || '—', M, curY, { font: fBold, size: 11.5 });
  drawText(shortDate(inv.invoice_date), rightColX, curY, { size: 10 });
  curY -= 13;

  if (contact?.email) { drawText(fit(contact.email, fReg, 9.5, 260), M, curY, { size: 9.5, color: gray }); }
  drawText('DUE', rightColX, curY + 2, { font: fBold, size: 8.5, color: faint });
  curY -= 13;
  drawText(shortDate(inv.due_date), rightColX, curY + 4, { size: 10 });

  if (job?.address) {
    drawText(fit([job.address, job.city, job.state].filter(Boolean).join(', '), fReg, 9.5, 260), M, curY, { size: 9.5, color: gray });
    curY -= 13;
  }
  if (claim?.claim_number) {
    const carrier = claim.insurance_carrier ? ` · ${claim.insurance_carrier}` : '';
    drawText(fit(`Claim ${claim.claim_number}${carrier}`, fReg, 9.5, 260), M, curY, { size: 9.5, color: gray });
    curY -= 13;
  }
  if (job?.job_number) {
    drawText(`Job ${job.job_number}`, M, curY, { size: 9.5, color: gray });
    curY -= 13;
  }

  curY -= 12;

  // ── Line items ──
  const colQty = PW - M - 230;
  const colRate = PW - M - 150;
  const colAmt = PW - M;

  const drawTableHead = () => {
    drawText('DESCRIPTION', M, curY, { font: fBold, size: 8.5, color: faint });
    right('QTY', colQty + 40, curY, { font: fBold, size: 8.5, color: faint });
    right('RATE', colRate + 60, curY, { font: fBold, size: 8.5, color: faint });
    right('AMOUNT', colAmt, curY, { font: fBold, size: 8.5, color: faint });
    curY -= 6;
    drawLine(M, curY, PW - M, { thickness: 1, color: lgray });
    curY -= 14;
  };
  drawTableHead();

  if (!lines.length) {
    drawText('No line items.', M, curY, { size: 10, color: faint });
    curY -= 18;
  }

  for (const line of lines) {
    needY(30);
    if (curY === PH - 56 - 26) drawTableHead();

    const label = [line.qbo_item_name, line.description].filter(Boolean).join(' — ');
    drawText(fit(label, fReg, 9.5, colQty - M - 10), M, curY, { size: 9.5 });
    right(String(Number(line.quantity ?? 0)), colQty + 40, curY, { size: 9.5 });
    right(money(line.unit_price), colRate + 60, curY, { size: 9.5 });
    right(money(line.line_total), colAmt, curY, { font: fBold, size: 9.5 });
    curY -= 9;
    drawLine(M, curY, PW - M, { color: rgb(0.93, 0.93, 0.93) });
    curY -= 13;
  }

  // ── Totals ──
  needY(110);
  curY -= 8;
  const totalsX = PW - M - 210;
  const total = Number(inv.adjusted_total ?? inv.total ?? 0);
  const collected = Number(inv.amount_paid || 0);
  const balance = total - collected;

  const totalRow = (label, value, strong = false) => {
    drawText(label, totalsX, curY, { font: strong ? fBold : fReg, size: strong ? 10.5 : 10, color: strong ? black : gray });
    right(value, colAmt, curY, { font: strong ? fBold : fReg, size: strong ? 10.5 : 10 });
    curY -= 15;
  };

  totalRow('Subtotal', money(inv.subtotal));
  if (Number(inv.tax || 0) > 0) totalRow('Tax', money(inv.tax));
  drawLine(totalsX, curY + 6, PW - M);
  curY -= 4;
  totalRow('Total', money(total), true);
  if (collected > 0) {
    totalRow('Paid', `-${money(collected)}`);
    drawLine(totalsX, curY + 6, PW - M);
    curY -= 4;
    totalRow('Balance due', money(balance), true);
  }

  // ── Payment history ──
  const realPayments = (payments || []).filter((p) => Number(p.amount || 0) > 0);
  if (realPayments.length) {
    needY(40 + realPayments.length * 14);
    curY -= 14;
    drawText('PAYMENTS RECEIVED', M, curY, { font: fBold, size: 8.5, color: faint });
    curY -= 6;
    drawLine(M, curY, PW - M);
    curY -= 14;
    for (const p of realPayments) {
      const net = Number(p.amount || 0) - Number(p.refunded_amount || 0);
      const method = (p.payment_method || '').replace(/_/g, ' ');
      drawText(shortDate(p.payment_date), M, curY, { size: 9.5, color: gray });
      drawText(fit(method, fReg, 9.5, 120), M + 90, curY, { size: 9.5, color: gray });
      right(money(net), colAmt, curY, { size: 9.5 });
      curY -= 14;
    }
  }

  // ── Footer on every page ──
  const pages = pdfDoc.getPages();
  pages.forEach((page, i) => {
    page.drawLine({
      start: { x: M, y: FOOTER_H + 8 }, end: { x: PW - M, y: FOOTER_H + 8 },
      thickness: 0.5, color: lgray,
    });
    page.drawText('Thank you for your business. Please remit payment by the due date above.', {
      x: M, y: FOOTER_H - 6, font: fReg, size: 8, color: faint,
    });
    const stamp = `Page ${i + 1} of ${pages.length}`;
    page.drawText(stamp, {
      x: PW - M - fReg.widthOfTextAtSize(stamp, 8), y: FOOTER_H - 6, font: fReg, size: 8, color: faint,
    });
  });

  return pdfDoc.save();
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

  try {
    const model = await loadInvoiceModel(db, body.invoice_id);
    if (!model) return jsonResponse({ error: 'Invoice not found' }, 404, request, env);

    const bytes = await buildInvoicePdf(model);
    const docNumber = model.inv.qbo_doc_number || model.inv.invoice_number || model.inv.id;
    const jobId = model.inv.job_id;
    // A job is required to file the document; an invoice without one can still
    // be rendered, it just cannot be attached.
    const storagePath = `${jobId || 'unfiled'}/invoices/invoice-${docNumber}-${Date.now()}.pdf`;

    await db.uploadStorage(BUCKET, storagePath, bytes, 'application/pdf');

    let jobDocumentId = null;
    if (jobId) {
      const doc = await db.rpc('insert_job_document', {
        p_job_id: jobId,
        p_name: `Invoice ${docNumber}.pdf`,
        p_file_path: storagePath,
        p_mime_type: 'application/pdf',
        p_category: 'invoice',
        p_uploaded_by: auth.employee?.id || null,
        p_description: `UPR invoice ${docNumber}`,
      });
      jobDocumentId = (Array.isArray(doc) ? doc[0] : doc)?.id || null;
    }

    await recordWorkerRun(db, {
      workerName: 'invoice-pdf',
      status: 'completed',
      recordsProcessed: 1,
      startedAt,
      meta: { invoice_id: model.inv.id, job_document_id: jobDocumentId },
    }).catch(() => {});

    return jsonResponse({
      ok: true,
      invoice_id: model.inv.id,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      job_document_id: jobDocumentId,
    }, 200, request, env);
  } catch (err) {
    await recordWorkerRun(db, {
      workerName: 'invoice-pdf',
      status: 'error',
      errorMessage: err?.message || String(err),
      startedAt,
      meta: { invoice_id: body.invoice_id },
    }).catch(() => {});
    return jsonResponse({ error: err.message || 'Could not build the invoice PDF' }, 500, request, env);
  }
}
