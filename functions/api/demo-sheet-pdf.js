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
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ─────────────────────────────────────────────────────────────────────────────
//  AUTH (mirrors generate-water-loss-report.js)
// ─────────────────────────────────────────────────────────────────────────────
async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { error: 'Missing Authorization header', status: 401 };
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: 'Invalid or expired token', status: 401 };
  return { ok: true };
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = await requireAuth(request, env);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);

  const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return jsonResponse({ error: 'Supabase env vars missing' }, 500, request, env);
  }

  const sbHeaders = {
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type':  'application/json',
  };
  const rpc = async (fn, params) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: sbHeaders, body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`RPC ${fn}: ${await res.text()}`);
    return res.json();
  };
  const select = async (table, query) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders });
    if (!res.ok) throw new Error(`SELECT ${table}: ${await res.text()}`);
    return res.json();
  };

  try {
    const body = await request.json();
    const { p_job_id, job_number, sheet_id, requested_by, model } = body || {};

    if (!model || typeof model !== 'object') {
      return jsonResponse({ error: 'model is required' }, 400, request, env);
    }

    // ── 1. Resolve the job ──
    //   Prefer the explicit p_job_id; otherwise try to match a job by its
    //   job_number. A demo sheet started from an Encircle search may not be
    //   linked to a UPR job — in that case we return a non-error "not attached"
    //   response so the client can show "skipped" rather than a failure.
    let jobId = p_job_id || null;
    if (!jobId && job_number) {
      try {
        const rows = await select('jobs', `job_number=eq.${encodeURIComponent(job_number)}&select=id&limit=1`);
        if (Array.isArray(rows) && rows[0]?.id) jobId = rows[0].id;
      } catch { /* fall through — handled below */ }
    }
    if (!jobId) {
      return jsonResponse({ success: true, attached: false, reason: 'no_matching_job' }, 200, request, env);
    }

    // ── 2. Build PDF ──
    const pdfBytes = await buildDemoPdf(model);

    // ── 3. Upload to Supabase Storage ──
    const storagePath = `${jobId}/demo-sheets/demo-sheet-${Date.now()}.pdf`;
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/job-files/${storagePath}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey':        SUPABASE_KEY,
          'Content-Type':  'application/pdf',
          'x-upsert':      'true',
        },
        body: pdfBytes,
      }
    );
    if (!uploadRes.ok) throw new Error(`Storage upload failed: ${await uploadRes.text()}`);

    // ── 4. Record in job_documents ──
    const dateLabel = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const docName = `Demo Sheet — ${model?.jobInfo?.jobNumber ? `${model.jobInfo.jobNumber} · ` : ''}${dateLabel}`;
    const docResult = await rpc('insert_job_document', {
      p_job_id:      jobId,
      p_name:        docName,
      p_file_path:   storagePath,
      p_mime_type:   'application/pdf',
      p_category:    'demo_sheet',
      p_uploaded_by: requested_by || null,
    });
    const jobDocumentId = Array.isArray(docResult) ? docResult[0]?.id : (docResult?.id || docResult);

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
function pdfSafe(s) {
  return String(s == null ? '' : s)
    // eslint-disable-next-line no-misleading-character-class -- intentionally strips lone variation selectors (FE00-FE0F), ZWJ (200D) and combining keycap (20E3); pdf-lib WinAnsi throws on them
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/^\s+|\s+$/g, '');
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
