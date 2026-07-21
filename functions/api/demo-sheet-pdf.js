// POST /api/demo-sheet-pdf
// Renders a submitted Demo (Demolition) Sheet as a PDF, uploads it to Supabase
// Storage, and records it in job_documents so it shows up under the job's Files
// tab — and, by extension, the customer page Files section.
//
// Body: {
//   p_job_id?:    UUID    — preferred way to resolve the job
//   job_number?:  string  — fallback used to resolve the job when p_job_id is absent
//   sheet_id?:    UUID     — demo_sheets.id (informational, stored in name)
//   requested_by?:UUID     — employee id for job_documents.uploaded_by
//   model:        { ...structured demo-sheet render model, see buildDemoPdf }
// }
//
// Reference implementation for pdf-lib usage in this repo:
// functions/api/generate-water-loss-report.js + functions/api/submit-esign.js.
// Those files are siblings — do NOT modify them.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { requireUser } from '../lib/auth.js';
import { supabase } from '../lib/supabase.js';
import { recordWorkerRun } from '../lib/worker-runs.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Encodings } from '@pdf-lib/standard-fonts';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const startedAt = new Date().toISOString();

  const auth = await requireUser(request, env);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);

  // Shared service-role client (functions/lib/supabase.js) replaces the old
  // hand-rolled fetch that fell back to the anon key when the service-role
  // key was missing. That silent downgrade is exactly how one submitted
  // scope sheet's PDF went missing without anyone noticing: storage upload /
  // insert_job_document would fail under RLS with nothing surfaced beyond
  // this request's own response. uploadStorage() below throws loudly instead
  // if the key isn't configured, and every outcome is now logged to
  // worker_runs (see recordWorkerRun calls) so a failure is queryable even
  // when nobody's watching the tech's screen at submit time.
  const db = supabase(env);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }
  const { p_job_id, job_number, sheet_id, requested_by, model } = body || {};

  if (!model || typeof model !== 'object') {
    return jsonResponse({ error: 'model is required' }, 400, request, env);
  }

  try {
    // ── 1. Resolve the job ──
    //   Prefer the explicit p_job_id; otherwise try to match a job by its
    //   job_number. A demo sheet started from an Encircle search may not be
    //   linked to a UPR job — in that case we return a non-error "not attached"
    //   response so the client can show "skipped" rather than a failure.
    let jobId = p_job_id || null;
    if (!jobId && job_number) {
      try {
        const rows = await db.select('jobs', `job_number=eq.${encodeURIComponent(job_number)}&select=id&limit=1`);
        if (Array.isArray(rows) && rows[0]?.id) jobId = rows[0].id;
      } catch { /* fall through — handled below */ }
    }
    if (!jobId) {
      await recordWorkerRun(db, {
        workerName: 'demo-sheet-pdf', status: 'completed', recordsProcessed: 0,
        startedAt, meta: { skipped: true, reason: 'no_matching_job', sheet_id: sheet_id || null },
      });
      return jsonResponse({ success: true, attached: false, reason: 'no_matching_job' }, 200, request, env);
    }

    // ── 2. Build PDF ──
    const pdfBytes = await buildDemoPdf(model);

    // ── 3. Upload to Supabase Storage ──
    const storagePath = `${jobId}/demo-sheets/demo-sheet-${Date.now()}.pdf`;
    await db.uploadStorage('job-files', storagePath, pdfBytes, 'application/pdf');

    // ── 4. Record in job_documents ──
    const dateLabel = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const docName = `Demo Sheet — ${model?.jobInfo?.jobNumber ? `${model.jobInfo.jobNumber} · ` : ''}${dateLabel}`;
    const docResult = await db.rpc('insert_job_document', {
      p_job_id:      jobId,
      p_name:        docName,
      p_file_path:   storagePath,
      p_mime_type:   'application/pdf',
      p_category:    'demo_sheet',
      p_uploaded_by: requested_by || null,
    });
    const jobDocumentId = Array.isArray(docResult) ? docResult[0]?.id : (docResult?.id || docResult);

    await recordWorkerRun(db, {
      workerName: 'demo-sheet-pdf', status: 'completed', recordsProcessed: 1,
      startedAt, meta: { job_id: jobId, sheet_id: sheet_id || null, job_document_id: jobDocumentId },
    });

    return jsonResponse({
      success:         true,
      attached:        true,
      job_id:          jobId,
      sheet_id:        sheet_id || null,
      storage_path:    storagePath,
      job_document_id: jobDocumentId,
    }, 200, request, env);

  } catch (err) {
    console.error('demo-sheet-pdf error:', err);
    await recordWorkerRun(db, {
      workerName: 'demo-sheet-pdf', status: 'error',
      errorMessage: err?.message || String(err), startedAt,
      meta: { sheet_id: sheet_id || null, p_job_id: p_job_id || null, job_number: job_number || null },
    });
    return jsonResponse({ error: err.message || 'Internal server error' }, 500, request, env);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PDF BUILDER
//
//  Expected model shape (built client-side from the active schema so all the
//  schema-walking logic stays in one place — see TechDemoSheet.buildPdfModel):
//  {
//    jobInfo: { date, techName, jobNumber, address, insuredName },
//    floorPlan: string,
//    jobSections: [ { label, entries: [ {kind, label, value} ] } ],  // job-level
//    rooms: [
//      { index, name, dim, sections: [ { label, entries: [ {kind, label, value} ] } ] }
//    ],
//    totals: [ { label, value } ],
//  }
// ─────────────────────────────────────────────────────────────────────────────
// pdf-lib's StandardFonts use WinAnsi (CP1252) encoding, which throws on emoji
// / pictographs (e.g. the section icons 💧🛡️, or an emoji a tech types into a
// note). Strip those ranges from every string before drawing/measuring, while
// keeping WinAnsi-safe typography (em/en dashes, curly quotes, ×, ·, …).
// Definitive per-character backstop: ask pdf-lib's own WinAnsi table whether
// a code point is encodable, rather than guessing at Unicode ranges (that
// guesswork is exactly how one real submission crashed PDF generation —
// 2026-07-21, WinAnsi cannot encode an embedded newline). Anything the font
// genuinely can't render is swapped for '?' so a future unknown character
// (an unusual symbol, a script outside Latin-1) degrades one glyph instead
// of taking down the whole document. Iterates by code point, not UTF-16
// unit, so surrogate-pair characters (most emoji) are checked correctly.
function winAnsiSafe(s) {
  let out = '';
  for (const ch of String(s)) {
    out += Encodings.WinAnsi.canEncodeUnicodeCodePoint(ch.codePointAt(0)) ? ch : '?';
  }
  return out;
}
function pdfSafe(s) {
  return winAnsiSafe(
    String(s == null ? '' : s)
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '')
      // drawText renders one line at a time — an embedded newline/tab/CR (e.g. a
      // tech pressing Enter inside a Notes textarea) throws a WinAnsi encode
      // error deep in font.widthOfTextAtSize, not a display glitch. Confirmed
      // root cause of a real production failure (2026-07-21): flatten to a
      // single space rather than attempt mid-value wrapping/pagination.
      .replace(/[\t\n\r\v\f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '')
  );
}
function deepPdfSafe(v) {
  if (typeof v === 'string') return pdfSafe(v);
  if (Array.isArray(v)) return v.map(deepPdfSafe);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = deepPdfSafe(v[k]);
    return out;
  }
  return v;
}

async function buildDemoPdf(rawModel) {
  // Sanitize all strings up front so neither drawText nor widthOfTextAtSize
  // ever sees a character WinAnsi can't encode.
  const model = deepPdfSafe(rawModel);
  const pdfDoc = await PDFDocument.create();
  const fBold  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fReg   = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const PW = 612, PH = 792, M = 48, CW = PW - M * 2;
  const FOOTER_H = 40;
  const MIN_Y    = FOOTER_H + 20;

  const black  = rgb(0.05, 0.05, 0.05);
  const gray   = rgb(0.40, 0.40, 0.40);
  const lgray  = rgb(0.85, 0.85, 0.85);
  const xlgray = rgb(0.94, 0.94, 0.94);
  const blue   = rgb(0.145, 0.388, 0.922);
  const navy   = rgb(0.118, 0.161, 0.231);
  const white  = rgb(1, 1, 1);

  let curPage = null;
  let curY    = 0;

  // Small colored accent square before each section label — a print-safe substitute
  // for the on-screen emoji icons (WinAnsi can't encode emoji). Color cycles by the
  // section's index so a given position is consistent across rooms.
  const dotPalette = [
    blue,
    rgb(0.086, 0.639, 0.290), // green
    rgb(0.851, 0.467, 0.024), // amber
    rgb(0.486, 0.227, 0.929), // purple
    rgb(0.020, 0.522, 0.620), // cyan
    rgb(0.863, 0.149, 0.149), // red
  ];
  const drawSectionLabel = (label, idx) => {
    curPage.drawRectangle({ x: M, y: curY - 1, width: 6, height: 6, color: dotPalette[idx % dotPalette.length] });
    drawText(String(label || '').toUpperCase(), M + 11, curY, { font: fBold, size: 8.5, color: blue });
  };

  const jobInfo = model.jobInfo || {};
  const jobNumLabel = jobInfo.jobNumber || '';

  const drawHeader = () => {
    curPage.drawRectangle({ x: 0, y: PH - 48, width: PW, height: 48, color: navy });
    drawText('Utah Pros Restoration', M, PH - 22, { font: fBold, size: 12, color: white });
    drawText('Licensed · Insured · Utah · (801) 427-0582', M, PH - 36, { font: fReg, size: 8, color: rgb(0.62, 0.68, 0.76) });
    const rightLabel = 'SCOPE SHEET';
    const rlW = fBold.widthOfTextAtSize(rightLabel, 10);
    drawText(rightLabel, PW - M - rlW, PH - 22, { font: fBold, size: 10, color: white });
    if (jobNumLabel) {
      const jl = `Job ${jobNumLabel}`;
      const jlW = fReg.widthOfTextAtSize(jl, 8);
      drawText(jl, PW - M - jlW, PH - 36, { font: fReg, size: 8, color: rgb(0.62, 0.68, 0.76) });
    }
    curY = PH - 48 - 20;
  };

  const newPage = () => { curPage = pdfDoc.addPage([PW, PH]); curY = PH - 40; };
  const pageWithHeader = () => { newPage(); drawHeader(); };
  const needY = (needed) => { if (curY - needed < MIN_Y) pageWithHeader(); };

  function drawText(str, x, y, { font = fReg, size = 10, color = black } = {}) {
    if (str == null || str === '') return;
    curPage.drawText(String(str), { x, y, font, size, color });
  }
  const drawLine = (x1, y, x2, opts = {}) => {
    curPage.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: opts.thickness || 0.5, color: opts.color || lgray });
  };
  // Truncate a string to fit maxW at the given font/size (single line).
  const fit = (str, font, size, maxW) => {
    let s = String(str ?? '');
    if (font.widthOfTextAtSize(s, size) <= maxW) return s;
    while (s.length > 1 && font.widthOfTextAtSize(s + '…', size) > maxW) s = s.slice(0, -1);
    return s + '…';
  };

  // ── PAGE 1: header + job info ──
  newPage();
  drawHeader();
  curY -= 24;

  // Title
  const title = 'SCOPE SHEET';
  const titleW = fBold.widthOfTextAtSize(title, 22);
  drawText(title, (PW - titleW) / 2, curY, { font: fBold, size: 22, color: navy });
  curY -= 6;
  curPage.drawLine({ start: { x: (PW - 180) / 2, y: curY }, end: { x: (PW + 180) / 2, y: curY }, thickness: 2, color: blue });
  curY -= 30;

  // Job info grid (2-column)
  const c1 = M, c2 = M + CW / 2 + 10;
  const infoRow = (label, val, col, y) => {
    drawText(label, col, y, { font: fBold, size: 8, color: gray });
    drawText(fit(val || '—', fReg, 10.5, CW / 2 - 14), col, y - 13, { font: fReg, size: 10.5, color: black });
  };
  let gy = curY;
  infoRow('DATE',       jobInfo.date,       c1, gy);
  infoRow('TECHNICIAN', jobInfo.techName,   c2, gy); gy -= 32;
  infoRow('JOB #',      jobInfo.jobNumber,  c1, gy);
  infoRow('INSURED',    jobInfo.insuredName, c2, gy); gy -= 32;
  infoRow('ADDRESS',    jobInfo.address,    c1, gy);
  infoRow('FLOOR PLAN', model.floorPlan,    c2, gy); gy -= 30;
  curY = gy - 6;
  drawLine(M, curY, PW - M, { thickness: 0.5, color: lgray });
  curY -= 22;

  // ── LOSS & SITE DETAILS (job-level sections) ──
  const jobSections = Array.isArray(model.jobSections) ? model.jobSections : [];
  if (jobSections.length > 0) {
    needY(50);
    const jbH = 22;
    curPage.drawRectangle({ x: M, y: curY - jbH + 4, width: CW, height: jbH, color: navy });
    drawText('LOSS & SITE DETAILS', M + 8, curY - 11, { font: fBold, size: 11, color: white });
    curY -= jbH + 10;
    let secIdx = 0;
    for (const sec of jobSections) {
      needY(26);
      drawSectionLabel(sec.label, secIdx++);
      curY -= 14;
      const entries = Array.isArray(sec.entries) ? sec.entries : [];
      for (const e of entries) {
        if (e.kind === 'group') {
          needY(16);
          drawText(String(e.label || '').toUpperCase(), M + 8, curY, { font: fBold, size: 7.5, color: gray });
          curY -= 12;
          continue;
        }
        needY(16);
        const valStr = e.value == null ? '' : String(e.value);
        const valW = fBold.widthOfTextAtSize(valStr, 9.5);
        drawText(fit(e.label, fReg, 9.5, CW - valW - 24), M + 14, curY, { font: fReg, size: 9.5, color: rgb(0.27, 0.27, 0.27) });
        drawText(valStr, M + CW - valW, curY, { font: fBold, size: 9.5, color: black });
        drawLine(M + 14, curY - 4, M + CW, { thickness: 0.3, color: rgb(0.93, 0.93, 0.93) });
        curY -= 15;
      }
      curY -= 6;
    }
    curY -= 8;
  }

  // ── ROOMS ──
  const rooms = Array.isArray(model.rooms) ? model.rooms : [];
  if (rooms.length === 0) {
    drawText('No room quantities were recorded for this demo sheet.', M, curY, { font: fReg, size: 11, color: gray });
    curY -= 18;
  }

  for (const room of rooms) {
    needY(70);
    // Room header bar
    const barH = 22;
    curPage.drawRectangle({ x: M, y: curY - barH + 4, width: CW, height: barH, color: blue });
    const roomTitle = `Room ${room.index}: ${room.name || 'Unnamed'}`;
    drawText(fit(roomTitle, fBold, 11, CW - 120), M + 8, curY - 11, { font: fBold, size: 11, color: white });
    if (room.dim) {
      const dimW = fReg.widthOfTextAtSize(room.dim, 9);
      drawText(room.dim, M + CW - 8 - dimW, curY - 11, { font: fReg, size: 9, color: rgb(0.85, 0.9, 1) });
    }
    curY -= barH + 8;

    const sections = Array.isArray(room.sections) ? room.sections : [];
    let rsi = 0;
    for (const sec of sections) {
      needY(26);
      // Section label — colored accent dot + label
      drawSectionLabel(sec.label, rsi++);
      curY -= 14;
      const entries = Array.isArray(sec.entries) ? sec.entries : [];
      for (const e of entries) {
        if (e.kind === 'group') {
          needY(16);
          drawText(String(e.label || '').toUpperCase(), M + 8, curY, { font: fBold, size: 7.5, color: gray });
          curY -= 12;
          continue;
        }
        needY(16);
        const valStr = e.value == null ? '' : String(e.value);
        const valW = fBold.widthOfTextAtSize(valStr, 9.5);
        drawText(fit(e.label, fReg, 9.5, CW - valW - 24), M + 14, curY, { font: fReg, size: 9.5, color: rgb(0.27, 0.27, 0.27) });
        drawText(valStr, M + CW - valW, curY, { font: fBold, size: 9.5, color: black });
        drawLine(M + 14, curY - 4, M + CW, { thickness: 0.3, color: rgb(0.93, 0.93, 0.93) });
        curY -= 15;
      }
      curY -= 6;
    }
    curY -= 8;
  }

  // ── JOB TOTALS ──
  const totals = Array.isArray(model.totals) ? model.totals : [];
  if (totals.length > 0) {
    needY(40 + totals.length * 16);
    const barH = 22;
    curPage.drawRectangle({ x: M, y: curY - barH + 4, width: CW, height: barH, color: navy });
    drawText('JOB TOTALS — ALL ROOMS', M + 8, curY - 11, { font: fBold, size: 11, color: white });
    curY -= barH + 10;
    for (const t of totals) {
      needY(16);
      const valStr = t.value == null ? '' : String(t.value);
      const valW = fBold.widthOfTextAtSize(valStr, 10);
      drawText(fit(t.label, fReg, 10, CW - valW - 20), M + 8, curY, { font: fReg, size: 10, color: rgb(0.27, 0.27, 0.27) });
      drawText(valStr, M + CW - valW, curY, { font: fBold, size: 10, color: navy });
      drawLine(M + 8, curY - 4, M + CW, { thickness: 0.3, color: lgray });
      curY -= 16;
    }
  }

  // ── FOOTERS: page numbers + brand strip ──
  const totalPages = pdfDoc.getPageCount();
  const allPages = pdfDoc.getPages();
  for (let i = 0; i < allPages.length; i++) {
    const p = allPages[i];
    p.drawLine({ start: { x: M, y: 30 }, end: { x: PW - M, y: 30 }, thickness: 0.5, color: lgray });
    p.drawText('Utah Pros Restoration · utah-pros.com', { x: M, y: 18, font: fReg, size: 7.5, color: rgb(0.55, 0.55, 0.55) });
    const pageStr = `Page ${i + 1} of ${totalPages}`;
    const pw = fReg.widthOfTextAtSize(pageStr, 7.5);
    p.drawText(pageStr, { x: PW - M - pw, y: 18, font: fReg, size: 7.5, color: rgb(0.55, 0.55, 0.55) });
  }

  return pdfDoc.save();
}
