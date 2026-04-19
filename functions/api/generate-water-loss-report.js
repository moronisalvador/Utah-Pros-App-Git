// POST /api/generate-water-loss-report
// Generates a multi-page Water Loss Report PDF for a restoration job and
// uploads it to Supabase Storage + job_documents. Optional email delivery.
//
// Body: { p_job_id: UUID, email_to?: string, requested_by?: UUID }
//
// Reference implementation for pdf-lib usage in this repo:
// functions/api/submit-esign.js — helpers (drawText / drawLine / drawWrapped
// / drawParagraphs / newPage / needY / footer) are duplicated from there.
// Do NOT modify submit-esign.js; this file is a sibling worker.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ─────────────────────────────────────────────────────────────────────────────
//  AUTH
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

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE HANDLERS
// ─────────────────────────────────────────────────────────────────────────────
export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // ── Auth ──
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

  try {
    const body = await request.json();
    const { p_job_id, email_to, requested_by } = body || {};

    if (!p_job_id) {
      return jsonResponse({ error: 'p_job_id is required' }, 400, request, env);
    }

    // ── 1. Fetch report data ──
    const data = await rpc('get_water_loss_report_data', { p_job_id });
    if (!data || !data.job) {
      return jsonResponse({ error: 'Job not found or no data available' }, 404, request, env);
    }

    // ── 2. Fetch photos (cap 60 total, concurrency 6) ──
    const { photoBlobs, totalPhotoCount, includedPhotoCount } = await fetchPhotos(
      data.rooms || [], SUPABASE_URL, SUPABASE_KEY
    );

    // ── 3. Build PDF ──
    const pdfBytes = await buildReportPdf({ data, photoBlobs });

    // ── 4. Upload to Supabase Storage ──
    const jobId = data.job.id;
    const storagePath = `${jobId}/reports/water-loss-${Date.now()}.pdf`;
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

    // ── 5. Record in job_documents ──
    const dateLabel = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const docName = `Water Loss Report — ${dateLabel}`;
    const docResult = await rpc('insert_job_document', {
      p_job_id,
      p_name:          docName,
      p_file_path:     storagePath,
      p_mime_type:     'application/pdf',
      p_category:      'water_loss_report',
      p_uploaded_by:   requested_by || null,
    });
    const jobDocumentId = Array.isArray(docResult) ? docResult[0]?.id : (docResult?.id || docResult);

    // ── 6. Optional: email via SendGrid ──
    if (email_to && env.SENDGRID_API_KEY) {
      await sendReportEmail({
        env,
        toEmail:     email_to,
        job:         data.job,
        pdfBytes,
        dateLabel,
      }).catch(e => console.error('Report email failed:', e.message));
      // Non-fatal — document is already stored
    }

    return jsonResponse({
      success:                 true,
      storage_path:            storagePath,
      job_document_id:         jobDocumentId,
      photo_count_included:    includedPhotoCount,
      photo_count_total:       totalPhotoCount,
    }, 200, request, env);

  } catch (err) {
    console.error('generate-water-loss-report error:', err);
    return jsonResponse({ error: err.message || 'Internal server error' }, 500, request, env);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PHOTO FETCHING
//  - Caps at 60 photos total across the report
//  - Concurrency limit of 6 to avoid overwhelming CF Workers
//  - Returns a Map: photo.id → { bytes, mimeType } (failed fetches omitted)
// ─────────────────────────────────────────────────────────────────────────────
const PHOTO_HARD_CAP    = 60;
const PHOTOS_PER_ROOM   = 6;
const PHOTO_CONCURRENCY = 6;

async function fetchPhotos(rooms, supabaseUrl, supabaseKey) {
  // Build ordered photo fetch list: take first N per room, stop at global cap
  const toFetch = [];
  let totalReferenced = 0;

  for (const room of rooms) {
    const photos = Array.isArray(room.photos) ? room.photos : [];
    totalReferenced += photos.length;
    const slice = photos.slice(0, PHOTOS_PER_ROOM);
    for (const p of slice) {
      if (toFetch.length >= PHOTO_HARD_CAP) break;
      toFetch.push(p);
    }
    if (toFetch.length >= PHOTO_HARD_CAP) break;
  }

  const photoBlobs = new Map();

  // Concurrent chunked fetch
  for (let i = 0; i < toFetch.length; i += PHOTO_CONCURRENCY) {
    const chunk = toFetch.slice(i, i + PHOTO_CONCURRENCY);
    const results = await Promise.all(chunk.map(p => fetchSinglePhoto(p, supabaseUrl, supabaseKey)));
    for (let k = 0; k < results.length; k++) {
      const r = results[k];
      if (r) photoBlobs.set(chunk[k].id, r);
    }
  }

  return {
    photoBlobs,
    totalPhotoCount:    totalReferenced,
    includedPhotoCount: photoBlobs.size,
  };
}

async function fetchSinglePhoto(photo, supabaseUrl, supabaseKey) {
  try {
    const res = await fetch(
      `${supabaseUrl}/storage/v1/object/job-files/${photo.file_path}`,
      { headers: { 'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey } }
    );
    if (!res.ok) return null;
    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    const bytes    = new Uint8Array(await res.arrayBuffer());
    return { bytes, mimeType };
  } catch (e) {
    console.warn('Photo fetch failed:', photo.file_path, e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────
const fmt = {
  // 1 decimal or em-dash
  num1: (v) => (v == null || Number.isNaN(Number(v))) ? '—' : Number(v).toFixed(1),
  // 0 decimals (GPP) or em-dash
  num0: (v) => (v == null || Number.isNaN(Number(v))) ? '—' : Math.round(Number(v)).toString(),
  pct1: (v) => (v == null || Number.isNaN(Number(v))) ? '—' : `${Number(v).toFixed(1)}%`,
  // "Apr 18, 2026 · 2:35 PM"
  dateTime: (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timePart = d.toLocaleTimeString('en-US',  { hour: 'numeric', minute: '2-digit' });
    return `${datePart} · ${timePart}`;
  },
  // "Apr 18, 2026"
  dateOnly: (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  },
  materialLabel: (key) => {
    if (!key) return 'Material';
    return String(key).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  PDF BUILDER
// ─────────────────────────────────────────────────────────────────────────────
async function buildReportPdf({ data, photoBlobs }) {
  const pdfDoc = await PDFDocument.create();
  const fBold  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fReg   = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fMono  = await pdfDoc.embedFont(StandardFonts.Courier);

  // Page geometry (mirrors submit-esign.js)
  const PW = 612, PH = 792, M = 48, CW = PW - M * 2;
  const FOOTER_H = 40;
  const MIN_Y    = FOOTER_H + 20;

  // Colors
  const black   = rgb(0.05, 0.05, 0.05);
  const gray    = rgb(0.40, 0.40, 0.40);
  const lgray   = rgb(0.85, 0.85, 0.85);
  const xlgray  = rgb(0.94, 0.94, 0.94);
  const blue    = rgb(0.145, 0.388, 0.922);
  const amber   = rgb(0.96, 0.62, 0.04);
  const red     = rgb(0.86, 0.15, 0.15);
  const green   = rgb(0.09, 0.64, 0.29);
  const navy    = rgb(0.118, 0.161, 0.231);
  const white   = rgb(1, 1, 1);
  const accentBg = rgb(0.937, 0.965, 1.0);

  // Cursor
  let curPage = null;
  let curY    = 0;

  const newPage = () => {
    curPage = pdfDoc.addPage([PW, PH]);
    curY    = PH - 40;
  };
  const needY = (needed) => {
    if (curY - needed < MIN_Y) newPage();
  };

  // ── Draw primitives ──
  const drawText = (str, x, y, { font = fReg, size = 10, color = black } = {}) => {
    if (str == null || str === '') return;
    curPage.drawText(String(str), { x, y, font, size, color });
  };
  const drawLine = (x1, y, x2, opts = {}) => {
    curPage.drawLine({
      start: { x: x1, y }, end: { x: x2, y },
      thickness: opts.thickness || 0.5,
      color:     opts.color     || lgray,
    });
  };
  const drawWrapped = (str, x, maxW, { font = fReg, size = 9.5, color = black, lh = 14 } = {}) => {
    if (!str || !String(str).trim()) return curY;
    const words = String(str).trim().split(/\s+/);
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxW && current) {
        needY(lh + 2);
        drawText(current, x, curY, { font, size, color });
        curY -= lh;
        current = word;
      } else {
        current = test;
      }
    }
    if (current) {
      needY(lh + 2);
      drawText(current, x, curY, { font, size, color });
      curY -= lh;
    }
    return curY;
  };
  const drawParagraphs = (paragraphs, x, maxW, opts = {}) => {
    const { paraGap = 8, ...textOpts } = opts;
    for (const para of paragraphs) {
      if (!para || !String(para).trim()) { curY -= paraGap; continue; }
      drawWrapped(para, x, maxW, textOpts);
      curY -= paraGap;
    }
  };

  // ── Header bar (drawn on every page via drawHeader) ──
  const drawHeader = (isFirstPage = false) => {
    curPage.drawRectangle({ x: 0, y: PH - 48, width: PW, height: 48, color: navy });
    drawText('Utah Pros Restoration',   M, PH - 22, { font: fBold, size: 12, color: white });
    drawText('Licensed · Insured · Utah · (801) 427-0582', M, PH - 36,
      { font: fReg, size: 8, color: rgb(0.62, 0.68, 0.76) });
    // Right-aligned doc label
    const rightLabel = 'WATER LOSS REPORT';
    const rlW = fBold.widthOfTextAtSize(rightLabel, 10);
    drawText(rightLabel, PW - M - rlW, PH - 22, { font: fBold, size: 10, color: white });
    const jobLabel = data.job?.job_number ? `Job ${data.job.job_number}` : '';
    if (jobLabel) {
      const jlW = fReg.widthOfTextAtSize(jobLabel, 8);
      drawText(jobLabel, PW - M - jlW, PH - 36, { font: fReg, size: 8, color: rgb(0.62, 0.68, 0.76) });
    }
    curY = PH - 48 - 20;
  };

  // Override newPage to draw header
  const pageWithHeader = () => {
    newPage();
    drawHeader(false);
  };

  // ── Local needY override that adds header on fresh page ──
  const needYH = (needed) => {
    if (curY - needed < MIN_Y) pageWithHeader();
  };

  // ════════════════════════════════════════════════════════════════════════
  //  PAGE 1 — COVER
  // ════════════════════════════════════════════════════════════════════════
  newPage();
  drawHeader(true);

  curY -= 40;

  // Big title
  const title = 'WATER LOSS REPORT';
  const titleW = fBold.widthOfTextAtSize(title, 30);
  drawText(title, (PW - titleW) / 2, curY, { font: fBold, size: 30, color: navy });
  curY -= 6;
  curPage.drawLine({
    start: { x: (PW - 220) / 2, y: curY },
    end:   { x: (PW + 220) / 2, y: curY },
    thickness: 2.5, color: blue,
  });
  curY -= 40;

  const job = data.job || {};
  const jobNumStr = job.job_number || '—';
  const jobNumW   = fMono.widthOfTextAtSize(jobNumStr, 14);
  drawText(jobNumStr, (PW - jobNumW) / 2, curY, { font: fMono, size: 14, color: gray });
  curY -= 32;

  // Insured name (big)
  if (job.insured_name) {
    const nameW = fBold.widthOfTextAtSize(job.insured_name, 18);
    drawText(job.insured_name, (PW - nameW) / 2, curY, { font: fBold, size: 18, color: black });
    curY -= 22;
  }
  // Address
  const addrLine1 = job.address || '';
  const addrLine2 = [job.city, job.state, job.zip].filter(Boolean).join(', ');
  if (addrLine1) {
    const w = fReg.widthOfTextAtSize(addrLine1, 11);
    drawText(addrLine1, (PW - w) / 2, curY, { font: fReg, size: 11, color: gray });
    curY -= 14;
  }
  if (addrLine2) {
    const w = fReg.widthOfTextAtSize(addrLine2, 11);
    drawText(addrLine2, (PW - w) / 2, curY, { font: fReg, size: 11, color: gray });
    curY -= 14;
  }
  curY -= 20;

  // Info grid (2-column)
  const gridCol1X = M + 40;
  const gridCol2X = M + CW / 2 + 20;
  const rowGap    = 30;
  const infoRow = (label, val, col, y) => {
    drawText(label, col, y,      { font: fBold, size: 8, color: gray });
    drawText(val || '—', col, y - 13, { font: fReg, size: 10.5, color: black });
  };
  let gy = curY;
  infoRow('CLAIM NUMBER',      job.claim_number,      gridCol1X, gy);
  infoRow('INSURANCE COMPANY', job.insurance_company, gridCol2X, gy); gy -= rowGap;
  infoRow('POLICY NUMBER',     job.policy_number,     gridCol1X, gy);
  infoRow('ADJUSTER',          job.adjuster,          gridCol2X, gy); gy -= rowGap;
  infoRow('DATE OF LOSS',      fmt.dateOnly(job.date_of_loss), gridCol1X, gy);
  infoRow('TYPE OF LOSS',      job.type_of_loss,      gridCol2X, gy); gy -= rowGap;
  infoRow('DIVISION',          job.division,          gridCol1X, gy);
  infoRow('PHASE',             job.phase,             gridCol2X, gy); gy -= rowGap;
  curY = gy - 10;

  // Contact info (if present)
  if (job.client_phone || job.client_email) {
    drawLine(M + 40, curY, PW - M - 40, { thickness: 0.5, color: lgray });
    curY -= 18;
    const bits = [];
    if (job.client_phone) bits.push(job.client_phone);
    if (job.client_email) bits.push(job.client_email);
    const line = bits.join('  ·  ');
    const lw = fReg.widthOfTextAtSize(line, 9.5);
    drawText(line, (PW - lw) / 2, curY, { font: fReg, size: 9.5, color: gray });
    curY -= 20;
  }

  // Prepared-by + Report date block at the bottom of cover
  const preparedNames = (data.attestation?.taken_by_names || []).filter(Boolean);
  const generatedStr  = fmt.dateOnly(data.generated_at || new Date().toISOString());

  const footerBlockY = 110;
  drawLine(M + 40, footerBlockY + 44, PW - M - 40, { thickness: 0.5, color: lgray });
  drawText('PREPARED BY', M + 40, footerBlockY + 30, { font: fBold, size: 8, color: gray });
  drawText(
    preparedNames.length ? preparedNames.join(', ') : 'Utah Pros Restoration',
    M + 40, footerBlockY + 14, { font: fReg, size: 10, color: black }
  );
  drawText('REPORT DATE', PW - M - 160, footerBlockY + 30, { font: fBold, size: 8, color: gray });
  drawText(generatedStr, PW - M - 160, footerBlockY + 14, { font: fReg, size: 10, color: black });

  // ════════════════════════════════════════════════════════════════════════
  //  EXECUTIVE SUMMARY (new page)
  // ════════════════════════════════════════════════════════════════════════
  pageWithHeader();

  drawText('Executive Summary', M, curY, { font: fBold, size: 16, color: navy });
  curY -= 6;
  curPage.drawLine({
    start: { x: M, y: curY }, end: { x: M + 80, y: curY },
    thickness: 2, color: blue,
  });
  curY -= 24;

  // Metrics grid — 2 columns × 3 rows
  const summary = data.summary || {};
  const metrics = [
    { label: 'AFFECTED ROOMS',       value: String(summary.affected_rooms ?? 0) },
    { label: 'TOTAL READINGS',       value: String(summary.total_readings ?? 0) },
    { label: 'PEAK GPP',             value: fmt.num0(summary.peak_gpp) },
    { label: 'CURRENT AVG MC',       value: fmt.pct1(summary.current_avg_mc) },
    { label: 'DAYS DRYING',          value: String(summary.days_drying ?? 0) },
    { label: 'EQUIPMENT-DAYS ONSITE', value: String(summary.equipment_days ?? 0) },
  ];
  const metricColW   = CW / 2;
  const metricRowH   = 58;
  for (let i = 0; i < metrics.length; i++) {
    const colIdx = i % 2;
    const rowIdx = Math.floor(i / 2);
    const bx = M + colIdx * metricColW;
    const by = curY - rowIdx * metricRowH;
    curPage.drawRectangle({
      x: bx + 2, y: by - metricRowH + 6, width: metricColW - 4, height: metricRowH - 8,
      color: xlgray, borderColor: lgray, borderWidth: 0.5,
    });
    drawText(metrics[i].label, bx + 14, by - 18, { font: fBold, size: 8, color: gray });
    drawText(metrics[i].value, bx + 14, by - 42, { font: fBold, size: 20, color: navy });
  }
  curY -= metricRowH * Math.ceil(metrics.length / 2) + 16;

  // Narrative bullets — auto-generated
  needYH(140);
  drawText('Summary Narrative', M, curY, { font: fBold, size: 12, color: black });
  curY -= 18;

  const bullets = buildNarrativeBullets(data);
  for (const b of bullets) {
    needYH(28);
    // Bullet dot
    curPage.drawCircle({ x: M + 4, y: curY + 4, size: 2, color: b.warn ? amber : blue });
    drawWrapped(b.text, M + 14, CW - 14, {
      font: fReg, size: 10,
      color: b.warn ? rgb(0.70, 0.42, 0.02) : black,
      lh: 13,
    });
    curY -= 4;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  PER-ROOM PAGES
  // ════════════════════════════════════════════════════════════════════════
  const rooms = Array.isArray(data.rooms) ? data.rooms : [];

  if (rooms.length === 0) {
    pageWithHeader();
    drawText('Rooms & Readings', M, curY, { font: fBold, size: 16, color: navy });
    curY -= 24;
    drawText('No readings recorded yet.', M, curY, { font: fReg, size: 11, color: gray });
    curY -= 18;
    drawWrapped(
      'Moisture readings, photos, and equipment placements have not been logged for this job. Once the drying plan is active, this report will populate automatically.',
      M, CW, { font: fReg, size: 10, color: gray, lh: 14 }
    );
  } else {
    for (const room of rooms) {
      await renderRoomSection({
        room,
        photoBlobs,
        pdfDoc,
        // ctx
        newPage: pageWithHeader,
        needY: needYH,
        drawText, drawLine, drawWrapped, drawParagraphs,
        getCurY: () => curY, setCurY: (v) => { curY = v; },
        getCurPage: () => curPage,
        fonts: { fReg, fBold, fMono },
        colors: { black, gray, lgray, xlgray, blue, amber, red, green, navy, accentBg, white },
        layout: { PW, PH, M, CW },
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  EQUIPMENT LOG (job-wide)
  // ════════════════════════════════════════════════════════════════════════
  const equipmentLog = Array.isArray(data.equipment_log) ? data.equipment_log : [];
  pageWithHeader();
  drawText('Equipment Log', M, curY, { font: fBold, size: 16, color: navy });
  curY -= 6;
  curPage.drawLine({
    start: { x: M, y: curY }, end: { x: M + 80, y: curY },
    thickness: 2, color: blue,
  });
  curY -= 22;

  if (equipmentLog.length === 0) {
    drawText('No equipment placements recorded.', M, curY,
      { font: fReg, size: 10, color: gray });
    curY -= 14;
  } else {
    const EQUIP_SOFT_CAP = 100;
    const truncated = equipmentLog.length > EQUIP_SOFT_CAP;
    const rowsToShow = truncated ? equipmentLog.slice(0, EQUIP_SOFT_CAP) : equipmentLog;

    drawTableCustom({
      columns: [
        { key: 'type',       header: 'TYPE',     width: 95 },
        { key: 'nickname',   header: 'NICKNAME', width: 85, format: (v) => v || '—' },
        { key: 'room_name',  header: 'ROOM',     width: 110, format: (v) => v || '—' },
        { key: 'placed_at',  header: 'PLACED',   width: 90, format: fmt.dateOnly },
        { key: 'removed_at', header: 'REMOVED',  width: 90, format: (v) => v ? fmt.dateOnly(v) : 'Active' },
        { key: 'days',       header: 'DAYS',     width: 40, align: 'right', format: (v) => v == null ? '—' : String(v) },
      ],
      rows:      rowsToShow,
      startX:    M,
      // context
      getCurPage, setCurY: (v) => { curY = v; }, getCurY: () => curY,
      newPage:   pageWithHeader,
      needY:     needYH,
      drawText, drawLine,
      fonts:     { fReg, fBold },
      colors:    { black, gray, lgray, xlgray, navy },
    });

    if (truncated) {
      needYH(18);
      drawText(
        `+${equipmentLog.length - EQUIP_SOFT_CAP} more equipment records in app`,
        M, curY, { font: fReg, size: 9, color: gray }
      );
      curY -= 14;
    }
  }

  // Mini-helper to expose curPage to drawTableCustom
  function getCurPage() { return curPage; }

  // ════════════════════════════════════════════════════════════════════════
  //  ATTESTATION (final page)
  // ════════════════════════════════════════════════════════════════════════
  pageWithHeader();
  drawText('Attestation', M, curY, { font: fBold, size: 16, color: navy });
  curY -= 6;
  curPage.drawLine({
    start: { x: M, y: curY }, end: { x: M + 80, y: curY },
    thickness: 2, color: blue,
  });
  curY -= 24;

  const att = data.attestation || {};
  const names = (att.taken_by_names || []).filter(Boolean);
  const rangeStart = att.date_range?.start ? fmt.dateOnly(att.date_range.start) : '—';
  const rangeEnd   = att.date_range?.end   ? fmt.dateOnly(att.date_range.end)   : '—';
  const generatedFull = fmt.dateTime(data.generated_at || new Date().toISOString());

  drawWrapped(
    `Readings taken by: ${names.length ? names.join(', ') : '—'}.`,
    M, CW, { font: fReg, size: 11, color: black, lh: 16 }
  );
  curY -= 4;
  drawWrapped(
    `Date range: ${rangeStart} — ${rangeEnd}.`,
    M, CW, { font: fReg, size: 11, color: black, lh: 16 }
  );
  curY -= 4;
  drawWrapped(
    `Report generated: ${generatedFull}.`,
    M, CW, { font: fReg, size: 11, color: black, lh: 16 }
  );
  curY -= 28;

  // Signature line placeholder
  drawLine(M, curY, M + 240, { thickness: 0.75, color: gray });
  drawText('Authorized Representative', M, curY - 12, { font: fReg, size: 8, color: gray });
  drawLine(PW - M - 200, curY, PW - M, { thickness: 0.75, color: gray });
  drawText('Date', PW - M - 200, curY - 12, { font: fReg, size: 8, color: gray });
  curY -= 40;

  drawWrapped(
    'This report was auto-generated from live job data in the Utah Pros Restoration platform. All photos, readings, and equipment placements are captured on-site at the time indicated.',
    M, CW, { font: fReg, size: 9, color: gray, lh: 13 }
  );

  // ── FOOTERS: page numbers + brand strip ──
  const totalPages = pdfDoc.getPageCount();
  const allPages = pdfDoc.getPages();
  for (let i = 0; i < allPages.length; i++) {
    const p = allPages[i];
    p.drawLine({ start: { x: M, y: 30 }, end: { x: PW - M, y: 30 }, thickness: 0.5, color: lgray });
    p.drawText('Utah Pros Restoration · utah-pros.com',
      { x: M, y: 18, font: fReg, size: 7.5, color: rgb(0.55, 0.55, 0.55) });
    const pageStr = `Page ${i + 1} of ${totalPages}`;
    const pw = fReg.widthOfTextAtSize(pageStr, 7.5);
    p.drawText(pageStr, { x: PW - M - pw, y: 18, font: fReg, size: 7.5, color: rgb(0.55, 0.55, 0.55) });
  }

  return pdfDoc.save();
}

// ─────────────────────────────────────────────────────────────────────────────
//  NARRATIVE BULLETS — 3-5 auto-generated summary statements
// ─────────────────────────────────────────────────────────────────────────────
function buildNarrativeBullets(data) {
  const bullets = [];
  const summary = data.summary || {};
  const rooms = data.rooms || [];
  const generatedStr = fmt.dateOnly(data.generated_at || new Date().toISOString());

  const affected = summary.affected_rooms ?? 0;
  if (affected > 0) {
    bullets.push({ text: `Drying active across ${affected} room${affected === 1 ? '' : 's'} on this loss.` });
  }

  const peak = Number(summary.peak_gpp);
  if (!Number.isNaN(peak) && peak > 0) {
    // Find when peak was hit
    let peakIso = null;
    for (const r of rooms) {
      const mats = r.readings_by_material || {};
      for (const key of Object.keys(mats)) {
        for (const rd of mats[key] || []) {
          const g = Number(rd.gpp);
          if (!Number.isNaN(g) && g >= peak - 0.5) {
            peakIso = rd.taken_at || peakIso;
          }
        }
      }
    }
    const peakDate = peakIso ? fmt.dateOnly(peakIso) : null;
    bullets.push({
      text: peakDate
        ? `Peak humidity reached ${Math.round(peak)} GPP on ${peakDate}.`
        : `Peak humidity reached ${Math.round(peak)} GPP during the drying period.`,
    });
  }

  const avgMc = Number(summary.current_avg_mc);
  if (!Number.isNaN(avgMc) && avgMc > 0) {
    bullets.push({ text: `Current average moisture content across affected materials: ${avgMc.toFixed(1)}%.` });
  }

  const days = summary.days_drying ?? 0;
  const eqDays = summary.equipment_days ?? 0;
  if (days > 0 || eqDays > 0) {
    bullets.push({
      text: `${days} day${days === 1 ? '' : 's'} of active drying with ${eqDays} cumulative equipment-day${eqDays === 1 ? '' : 's'} onsite.`,
    });
  }

  // Stalled-material warning: a material whose latest MC is still at or above goal AND hasn't changed > 0.5% in the last 2 readings
  const stalled = detectStalled(rooms);
  for (const s of stalled.slice(0, 2)) {
    bullets.push({
      warn: true,
      text: `Stalled drying: ${s.roomName} — ${fmt.materialLabel(s.material)} holding at ${s.latestMc.toFixed(1)}% (goal ${s.goal.toFixed(1)}%). Recommend reviewing airflow/dehu placement.`,
    });
  }

  if (bullets.length === 0) {
    bullets.push({ text: `Report generated ${generatedStr}. No readings available yet.` });
  }
  return bullets;
}

function detectStalled(rooms) {
  const out = [];
  for (const r of rooms) {
    const mats = r.readings_by_material || {};
    for (const key of Object.keys(mats)) {
      const reads = (mats[key] || []).filter(x => x.is_affected && x.mc != null).slice().sort(
        (a, b) => new Date(b.taken_at || b.date) - new Date(a.taken_at || a.date)
      );
      if (reads.length < 2) continue;
      const latest = Number(reads[0].mc);
      const prior  = Number(reads[1].mc);
      const goal   = Number(reads[0].goal);
      if (Number.isNaN(latest) || Number.isNaN(goal)) continue;
      if (latest <= goal) continue; // Below goal — not stalled
      if (!Number.isNaN(prior) && Math.abs(prior - latest) <= 0.5) {
        out.push({ roomName: r.name, material: key, latestMc: latest, goal });
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROOM SECTION RENDERER
// ─────────────────────────────────────────────────────────────────────────────
async function renderRoomSection(args) {
  const {
    room, photoBlobs, pdfDoc,
    newPage, needY,
    drawText, drawLine, drawWrapped,
    getCurY, setCurY, getCurPage,
    fonts: { fReg, fBold },
    colors: { black, gray, lgray, xlgray, blue, amber, red, navy, accentBg, white },
    layout: { PW, M, CW },
  } = args;

  // Start room on its own page
  newPage();

  // Room header
  drawText(room.name || 'Untitled Room', M, getCurY(), { font: fBold, size: 18, color: navy });
  setCurY(getCurY() - 22);

  const dimBits = [];
  if (room.area_sqft)         dimBits.push(`${Number(room.area_sqft).toFixed(0)} sq ft`);
  if (room.ceiling_height_ft) dimBits.push(`${Number(room.ceiling_height_ft).toFixed(1)} ft ceiling`);
  if (dimBits.length) {
    drawText(dimBits.join(' · '), M, getCurY(), { font: fReg, size: 10, color: gray });
    setCurY(getCurY() - 18);
  }
  drawLine(M, getCurY(), PW - M, { thickness: 0.5, color: lgray });
  setCurY(getCurY() - 16);

  // ── PHOTOS ──
  const photos = Array.isArray(room.photos) ? room.photos : [];
  const maxPhotosToRender = 6;
  const photosInReport = photos.slice(0, maxPhotosToRender).filter(p => photoBlobs.has(p.id));
  const moreCount = photos.length - photosInReport.length;

  if (photosInReport.length > 0) {
    needY(30);
    drawText('Photos', M, getCurY(), { font: fBold, size: 11, color: black });
    setCurY(getCurY() - 16);

    const grid = { cols: 3, cellW: 160, cellH: 120, gap: 10, captionH: 26 };
    const rowH = grid.cellH + grid.captionH + grid.gap;

    for (let i = 0; i < photosInReport.length; i += grid.cols) {
      needY(rowH + 4);
      const rowY = getCurY();
      for (let c = 0; c < grid.cols && i + c < photosInReport.length; c++) {
        const photo = photosInReport[i + c];
        const x = M + c * (grid.cellW + grid.gap);
        const y = rowY - grid.cellH;
        await embedPhotoCell({
          photo, blobInfo: photoBlobs.get(photo.id), pdfDoc,
          curPage: getCurPage(),
          x, y, w: grid.cellW, h: grid.cellH,
          captionH: grid.captionH,
          drawText, drawLine,
          fonts: { fReg },
          colors: { gray, lgray, xlgray },
        });
      }
      setCurY(rowY - grid.cellH - grid.captionH - grid.gap);
    }

    if (moreCount > 0) {
      needY(16);
      drawText(`+${moreCount} more photo${moreCount === 1 ? '' : 's'} in app`, M, getCurY(),
        { font: fReg, size: 9, color: gray });
      setCurY(getCurY() - 14);
    }
    setCurY(getCurY() - 8);
  }

  // ── MOISTURE READINGS TABLE ──
  const materialsMap = room.readings_by_material || {};
  const allReadings = [];
  for (const key of Object.keys(materialsMap)) {
    for (const rd of (materialsMap[key] || [])) {
      allReadings.push({ ...rd, _material: key });
    }
  }
  // Newest first
  allReadings.sort((a, b) => new Date(b.taken_at || b.date) - new Date(a.taken_at || a.date));

  if (allReadings.length > 0) {
    needY(40);
    drawText('Moisture Readings', M, getCurY(), { font: fBold, size: 11, color: black });
    setCurY(getCurY() - 16);

    // Identify latest reading per material (already sorted — first occurrence of each material)
    const latestPerMaterial = new Set();
    const seenMats = new Set();
    for (const rd of allReadings) {
      if (!seenMats.has(rd._material)) {
        seenMats.add(rd._material);
        latestPerMaterial.add(rd);
      }
    }

    // Table header
    const cols = [
      { key: 'taken_at',   header: 'DATE',     width: 110, align: 'left' },
      { key: '_material',  header: 'MATERIAL', width: 85,  align: 'left' },
      { key: 'mc',         header: 'MC%',      width: 48,  align: 'right' },
      { key: 'rh',         header: 'RH%',      width: 48,  align: 'right' },
      { key: 'temp',       header: 'TEMP °F',  width: 52,  align: 'right' },
      { key: 'gpp',        header: 'GPP',      width: 40,  align: 'right' },
      { key: 'goal',       header: 'GOAL',     width: 48,  align: 'right' },
    ];

    drawReadingsTable({
      rows: allReadings,
      cols, latestSet: latestPerMaterial,
      startX: M,
      // ctx
      getCurY, setCurY, getCurPage, newPage, needY,
      drawText, drawLine,
      fonts: { fReg, fBold },
      colors: { black, gray, lgray, xlgray, blue, navy },
    });
  }

  // ── DRYING TRENDS (sparklines per affected material) ──
  const affectedMaterials = Object.keys(materialsMap).filter(key => {
    return (materialsMap[key] || []).some(x => x.is_affected);
  });

  if (affectedMaterials.length > 0) {
    needY(36);
    drawText('Drying Trends', M, getCurY(), { font: fBold, size: 11, color: black });
    setCurY(getCurY() - 16);

    for (const matKey of affectedMaterials) {
      const reads = (materialsMap[matKey] || [])
        .filter(x => x.mc != null)
        .slice()
        .sort((a, b) => new Date(a.taken_at || a.date) - new Date(b.taken_at || b.date));

      if (reads.length === 0) continue;

      needY(70);
      const latestMc = Number(reads[reads.length - 1].mc);
      const goal = Number(reads[reads.length - 1].goal);
      const goalStr = Number.isNaN(goal) ? '—' : `${goal.toFixed(1)}%`;
      const label = `${fmt.materialLabel(matKey)} — current ${fmt.num1(latestMc)}% / goal ${goalStr}`;
      drawText(label, M, getCurY(), { font: fReg, size: 9.5, color: black });
      setCurY(getCurY() - 12);

      // Sparkline area
      const sparkW = CW;
      const sparkH = 42;
      const baseY = getCurY() - sparkH;

      drawSparkline({
        curPage: getCurPage(),
        points: reads.map(r => ({
          x: new Date(r.taken_at || r.date).getTime(),
          y: Number(r.mc),
        })).filter(p => !Number.isNaN(p.x) && !Number.isNaN(p.y)),
        x: M, y: baseY, w: sparkW, h: sparkH,
        goalY: Number.isNaN(goal) ? null : goal,
        color: blue, goalColor: amber, axisColor: lgray, pointColor: blue,
      });
      setCurY(baseY - 10);
    }
  }

  // ── EQUIPMENT (bulleted list) ──
  const equip = Array.isArray(room.equipment) ? room.equipment : [];
  if (equip.length > 0) {
    needY(30 + equip.length * 14);
    drawText('Equipment Placed', M, getCurY(), { font: fBold, size: 11, color: black });
    setCurY(getCurY() - 16);

    for (const e of equip) {
      needY(16);
      const parts = [
        e.type || '—',
        e.nickname ? `"${e.nickname}"` : null,
        e.days != null ? `${e.days} day${e.days === 1 ? '' : 's'}` : null,
        e.removed_at ? `removed ${fmt.dateOnly(e.removed_at)}` : 'active',
      ].filter(Boolean);
      getCurPage().drawCircle({ x: M + 4, y: getCurY() + 4, size: 1.8, color: gray });
      drawText(parts.join(' · '), M + 14, getCurY(), { font: fReg, size: 9.5, color: black });
      setCurY(getCurY() - 13);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PHOTO CELL EMBED
// ─────────────────────────────────────────────────────────────────────────────
async function embedPhotoCell({
  photo, blobInfo, pdfDoc, curPage,
  x, y, w, h, captionH,
  drawText, drawLine,
  fonts: { fReg },
  colors: { gray, lgray, xlgray },
}) {
  try {
    let img;
    const mime = (blobInfo?.mimeType || '').toLowerCase();
    if (mime.includes('png')) {
      img = await pdfDoc.embedPng(blobInfo.bytes);
    } else {
      // default to jpeg (handles image/jpeg, image/jpg)
      img = await pdfDoc.embedJpg(blobInfo.bytes);
    }
    const dims = img.scale(1);
    const scale = Math.min(w / dims.width, h / dims.height);
    const drawW = dims.width * scale;
    const drawH = dims.height * scale;
    const dx = x + (w - drawW) / 2;
    const dy = y + (h - drawH) / 2;
    // Background frame
    curPage.drawRectangle({
      x, y, width: w, height: h,
      color: xlgray, borderColor: lgray, borderWidth: 0.5,
    });
    curPage.drawImage(img, { x: dx, y: dy, width: drawW, height: drawH });
  } catch (e) {
    console.warn('Photo embed failed:', photo.file_path, e.message);
    // Placeholder
    curPage.drawRectangle({
      x, y, width: w, height: h,
      color: xlgray, borderColor: lgray, borderWidth: 0.5,
    });
    const msg = 'image unavailable';
    const mw = fReg.widthOfTextAtSize(msg, 8);
    curPage.drawText(msg, { x: x + (w - mw) / 2, y: y + h / 2, font: fReg, size: 8, color: gray });
  }
  // Caption
  const caption = photo.description || fmt.dateOnly(photo.created_at);
  const captionTruncated = caption.length > 70 ? caption.slice(0, 67) + '…' : caption;
  curPage.drawText(captionTruncated, {
    x, y: y - 14, font: fReg, size: 8, color: gray,
    maxWidth: w,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  GENERIC MULTI-PAGE TABLE (used by Equipment Log)
// ─────────────────────────────────────────────────────────────────────────────
function drawTableCustom({
  rows, columns, startX, headerFill, stripeFill,
  getCurPage, getCurY, setCurY, newPage, needY,
  drawText, drawLine,
  fonts: { fReg, fBold },
  colors: { black, gray, lgray, xlgray, navy },
}) {
  const rowH = 20;
  const headerH = 22;

  const drawHeaderRow = () => {
    const py = getCurY();
    // Header background
    getCurPage().drawRectangle({
      x: startX, y: py - headerH + 4,
      width: columns.reduce((a, c) => a + c.width, 0),
      height: headerH,
      color: headerFill || navy,
    });
    let cx = startX;
    for (const col of columns) {
      const tx = col.align === 'right'
        ? cx + col.width - 8 - fBold.widthOfTextAtSize(col.header, 8)
        : cx + 8;
      drawText(col.header, tx, py - 12, { font: fBold, size: 8, color: rgb(1, 1, 1) });
      cx += col.width;
    }
    setCurY(py - headerH);
  };

  drawHeaderRow();

  for (let r = 0; r < rows.length; r++) {
    if (getCurY() - rowH < 60) {
      newPage();
      drawHeaderRow();
    }
    const row = rows[r];
    const py = getCurY();
    // Zebra stripe
    if (r % 2 === 1) {
      getCurPage().drawRectangle({
        x: startX, y: py - rowH + 2,
        width: columns.reduce((a, c) => a + c.width, 0),
        height: rowH,
        color: stripeFill || xlgray,
      });
    }
    let cx = startX;
    for (const col of columns) {
      const raw = row[col.key];
      const val = col.format ? col.format(raw) : (raw == null ? '—' : String(raw));
      const maxChars = Math.floor(col.width / 5);
      const disp = val.length > maxChars ? val.slice(0, maxChars - 1) + '…' : val;
      const tx = col.align === 'right'
        ? cx + col.width - 8 - fReg.widthOfTextAtSize(disp, 9)
        : cx + 8;
      drawText(disp, tx, py - 13, { font: fReg, size: 9, color: black });
      cx += col.width;
    }
    drawLine(startX, py - rowH + 2, startX + columns.reduce((a, c) => a + c.width, 0),
      { thickness: 0.3, color: lgray });
    setCurY(py - rowH);
  }
  setCurY(getCurY() - 6);
}

// ─────────────────────────────────────────────────────────────────────────────
//  READINGS TABLE (per-room, multi-page aware)
//  - Bolds latest-per-material rows
// ─────────────────────────────────────────────────────────────────────────────
function drawReadingsTable({
  rows, cols, latestSet, startX,
  getCurY, setCurY, getCurPage, newPage, needY,
  drawText, drawLine,
  fonts: { fReg, fBold },
  colors: { black, gray, lgray, xlgray, blue, navy },
}) {
  const rowH = 18;
  const headerH = 20;

  const drawHeaderRow = () => {
    const py = getCurY();
    const totalW = cols.reduce((a, c) => a + c.width, 0);
    getCurPage().drawRectangle({
      x: startX, y: py - headerH + 4,
      width: totalW, height: headerH,
      color: navy,
    });
    let cx = startX;
    for (const col of cols) {
      const tx = col.align === 'right'
        ? cx + col.width - 6 - fBold.widthOfTextAtSize(col.header, 8)
        : cx + 6;
      drawText(col.header, tx, py - 12, { font: fBold, size: 8, color: rgb(1, 1, 1) });
      cx += col.width;
    }
    setCurY(py - headerH);
  };

  drawHeaderRow();

  for (let r = 0; r < rows.length; r++) {
    if (getCurY() - rowH < 60) {
      newPage();
      drawHeaderRow();
    }
    const row = rows[r];
    const py = getCurY();
    const isLatest = latestSet.has(row);
    const totalW = cols.reduce((a, c) => a + c.width, 0);
    if (r % 2 === 1) {
      getCurPage().drawRectangle({
        x: startX, y: py - rowH + 2, width: totalW, height: rowH, color: xlgray,
      });
    }
    // Bold + accent bar for latest-per-material
    if (isLatest) {
      getCurPage().drawRectangle({
        x: startX - 3, y: py - rowH + 2, width: 3, height: rowH, color: blue,
      });
    }
    let cx = startX;
    for (const col of cols) {
      let disp;
      if (col.key === 'taken_at') {
        disp = fmt.dateTime(row.taken_at || row.date);
      } else if (col.key === '_material') {
        disp = fmt.materialLabel(row._material);
      } else if (col.key === 'mc' || col.key === 'rh' || col.key === 'goal') {
        disp = fmt.num1(row[col.key]);
      } else if (col.key === 'gpp') {
        disp = fmt.num0(row.gpp);
      } else if (col.key === 'temp') {
        disp = row.temp == null ? '—' : fmt.num1(row.temp);
      } else {
        disp = row[col.key] == null ? '—' : String(row[col.key]);
      }

      const font = isLatest ? fBold : fReg;
      const color = isLatest ? black : black;
      const size = 9;
      const maxChars = Math.floor(col.width / 5);
      const truncated = disp.length > maxChars ? disp.slice(0, maxChars - 1) + '…' : disp;
      const tx = col.align === 'right'
        ? cx + col.width - 6 - font.widthOfTextAtSize(truncated, size)
        : cx + 6;
      drawText(truncated, tx, py - 12, { font, size, color });
      cx += col.width;
    }
    drawLine(startX, py - rowH + 2, startX + totalW, { thickness: 0.3, color: lgray });
    setCurY(py - rowH);
  }
  setCurY(getCurY() - 8);
}

// ─────────────────────────────────────────────────────────────────────────────
//  SPARKLINE — vector, no rasterization
//  Draws a polyline of MC% over time with optional horizontal goal line.
// ─────────────────────────────────────────────────────────────────────────────
function drawSparkline({
  curPage, points, x, y, w, h,
  color, goalY, goalColor, axisColor, pointColor,
}) {
  if (!points || points.length === 0) return;

  // Compute bounds
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  let xMin = Math.min(...xs);
  let xMax = Math.max(...xs);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);

  if (goalY != null) {
    yMin = Math.min(yMin, goalY);
    yMax = Math.max(yMax, goalY);
  }
  // Avoid zero spans
  if (xMax === xMin) xMax = xMin + 1;
  if (yMax === yMin) yMax = yMin + 1;
  // Pad vertical
  const yPad = (yMax - yMin) * 0.15;
  yMin -= yPad;
  yMax += yPad;

  // Axis (baseline)
  curPage.drawLine({
    start: { x, y }, end: { x: x + w, y },
    thickness: 0.5, color: axisColor,
  });
  // Top line (faint)
  curPage.drawLine({
    start: { x, y: y + h }, end: { x: x + w, y: y + h },
    thickness: 0.3, color: axisColor,
  });

  const toCanvas = (p) => ({
    cx: x + ((p.x - xMin) / (xMax - xMin)) * w,
    cy: y + ((p.y - yMin) / (yMax - yMin)) * h,
  });

  // Goal line — dashed
  if (goalY != null) {
    const goalCy = y + ((goalY - yMin) / (yMax - yMin)) * h;
    const dashLen = 4, gapLen = 3;
    let xi = x;
    while (xi < x + w) {
      const x2 = Math.min(xi + dashLen, x + w);
      curPage.drawLine({
        start: { x: xi, y: goalCy }, end: { x: x2, y: goalCy },
        thickness: 0.6, color: goalColor,
      });
      xi = x2 + gapLen;
    }
  }

  // Polyline
  if (points.length > 1) {
    for (let i = 1; i < points.length; i++) {
      const a = toCanvas(points[i - 1]);
      const b = toCanvas(points[i]);
      curPage.drawLine({
        start: { x: a.cx, y: a.cy }, end: { x: b.cx, y: b.cy },
        thickness: 1.4, color,
      });
    }
  }

  // Points
  for (const p of points) {
    const { cx, cy } = toCanvas(p);
    curPage.drawCircle({ x: cx, y: cy, size: 1.8, color: pointColor });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  EMAIL DELIVERY (optional)
//  Mirrors the chunked-btoa pattern from submit-esign.js for V8 safety.
// ─────────────────────────────────────────────────────────────────────────────
async function sendReportEmail({ env, toEmail, job, pdfBytes, dateLabel }) {
  const bytes = new Uint8Array(pdfBytes);
  let b64 = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    b64 += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  const pdfB64 = btoa(b64);

  const propertyLine = [job.address, job.city, job.state].filter(Boolean).join(', ');
  const jobNumLine   = job.job_number ? ` · Job ${job.job_number}` : '';
  const insuredName  = job.insured_name || 'Property Owner';
  const fileName     = `water-loss-report-${(job.job_number || 'job')}-${Date.now()}.pdf`;

  const escHtml = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{
        to:      [{ email: toEmail }],
        subject: `Water Loss Report${jobNumLine} — Utah Pros Restoration`,
      }],
      from:     { email: 'restoration@utah-pros.com', name: 'Utah Pros Restoration' },
      reply_to: { email: 'restoration@utah-pros.com', name: 'Utah Pros Restoration' },
      content: [
        {
          type: 'text/plain',
          value: `Attached is the Water Loss Report for ${insuredName}${propertyLine ? ` at ${propertyLine}` : ''}.\n\nReport date: ${dateLabel}\n${jobNumLine.replace(' · ', '')}\n\n— Utah Pros Restoration\n(801) 427-0582`,
        },
        {
          type: 'text/html',
          value: `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;padding:24px;"><p>Attached is the <strong>Water Loss Report</strong> for ${escHtml(insuredName)}${propertyLine ? ` at ${escHtml(propertyLine)}` : ''}.</p><p style="color:#64748b;font-size:13px;">Report date: ${escHtml(dateLabel)}${jobNumLine ? ` · ${escHtml(jobNumLine.replace(' · ', ''))}` : ''}</p><p style="color:#64748b;font-size:12px;margin-top:24px;">Questions? Reply to this email or call (801) 427-0582.</p></body></html>`,
        },
      ],
      attachments: [{
        content:     pdfB64,
        filename:    fileName,
        type:        'application/pdf',
        disposition: 'attachment',
      }],
    }),
  });
}
