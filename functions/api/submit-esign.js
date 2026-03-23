// POST /api/submit-esign
// Called when client submits signature on the sign page.
// Generates signed PDF with pdf-lib, uploads to Supabase Storage,
// calls complete_sign_request to mark signed + insert into job_documents.
//
// Body: { token, signer_name, signature_png }
// NOTE: divisions and template content come from the DB — not the request body.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

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
    const { token, signer_name, signature_png } = await request.json();

    if (!token)         return jsonResponse({ error: 'token is required' },         400, request, env);
    if (!signer_name)   return jsonResponse({ error: 'signer_name is required' },   400, request, env);
    if (!signature_png) return jsonResponse({ error: 'signature_png is required' }, 400, request, env);

    // ── 1. Fetch sign request + job ──
    const signReq = await rpc('get_sign_request_by_token', { p_token: token });
    if (!signReq)                                  return jsonResponse({ error: 'Signing link not found' },          404, request, env);
    if (signReq.status === 'signed')               return jsonResponse({ error: 'Document already signed' },         409, request, env);
    if (signReq.status !== 'pending')              return jsonResponse({ error: 'Signing link is no longer valid' }, 410, request, env);
    if (new Date(signReq.expires_at) < new Date()) return jsonResponse({ error: 'Signing link has expired' },       410, request, env);

    const job      = signReq.job;
    const signedAt = new Date();

    const divisions = (Array.isArray(signReq.divisions) && signReq.divisions.length > 0)
      ? signReq.divisions
      : (job.division ? [job.division] : []);

    // ── 2. Fetch document template from DB ──
    // For CoC: use hardcoded per-division completion text (divisions array drives content)
    // For all other doc types: fetch from document_templates table and substitute variables
    let templateSections = null;
    if (signReq.doc_type !== 'coc') {
      const templates = await select(
        'document_templates',
        `doc_type=eq.${encodeURIComponent(signReq.doc_type)}&order=sort_order.asc`
      );
      if (templates.length > 0) {
        const tmpl = templates[0];
        const substituted = substituteVars(tmpl.body, job);
        templateSections = parseMarkdownSections(substituted);
      }
    }

    // ── 3. Generate PDF ──
    const pdfBytes = await buildPdf({
      job, signer_name, signature_png,
      signed_at:        signedAt,
      doc_type:         signReq.doc_type,
      divisions,
      templateSections, // null for CoC — uses hardcoded completion text
    });

    // ── 4. Upload to Supabase Storage ──
    const storagePath = `${job.id}/esign/${signReq.doc_type}-signed-${Date.now()}.pdf`;
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/job-files/${storagePath}`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey':        SUPABASE_KEY,
        'Content-Type':  'application/pdf',
        'x-upsert':      'true',
      },
      body: pdfBytes,
    });
    if (!uploadRes.ok) throw new Error(`Storage upload failed: ${await uploadRes.text()}`);

    // ── 5. Complete sign request ──
    const signerIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const result = await rpc('complete_sign_request', {
      p_token:            token,
      p_signer_name:      signer_name,
      p_signer_ip:        signerIp,
      p_signed_file_path: storagePath,
    });

    if (!result || result.error) throw new Error(result?.error || 'Failed to complete sign request');

    return jsonResponse({
      success:         true,
      job_document_id: result.job_document_id,
      job_id:          result.job_id,
      signed_at:       signedAt.toISOString(),
    }, 200, request, env);

  } catch (err) {
    console.error('submit-esign error:', err);
    return jsonResponse({ error: err.message || 'Internal server error' }, 500, request, env);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  VARIABLE SUBSTITUTION
//  Replaces {{placeholders}} in template body with actual job data
// ─────────────────────────────────────────────────────────────────────────────
function substituteVars(body, job) {
  const hasInsurance = !!job.insurance_company;

  const insuranceSection = hasInsurance
    ? `DIRECTION OF PAYMENT\n\nI hereby direct ${job.insurance_company} to pay Utah Pros Restoration directly for all restoration services performed at the above property under Claim No. ${job.claim_number || '[Pending]'}. I authorize Utah Pros Restoration to negotiate, supplement, and finalize my claim on my behalf.`
    : `PRIVATE PAY & CONDITIONAL ASSIGNMENT OF BENEFITS\n\nI acknowledge that no insurance claim has been filed as of the date of this Agreement. Should I subsequently file an insurance claim for damage addressed by this Agreement, I hereby IRREVOCABLY PRE-ASSIGN to Utah Pros Restoration all insurance proceeds attributable to the work performed hereunder. This pre-assignment is retroactive to the date of this Agreement. I will notify Utah Pros Restoration within 3 business days of filing any claim and will immediately execute a Direction to Pay/Assignment of Benefits upon request. My payment obligation is unconditional and not contingent on any insurance filing, approval, or payment.`;

  const dolFormatted = job.date_of_loss
    ? new Date(job.date_of_loss).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  return body
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
    .replace(/\{\{insurance_section\}\}/g, insuranceSection);
}

// ─────────────────────────────────────────────────────────────────────────────
//  MARKDOWN SECTION PARSER
//  Splits template body on ## headings into [{heading, body}] pairs
//  Also handles ### sub-headings as bold inline text
// ─────────────────────────────────────────────────────────────────────────────
function parseMarkdownSections(body) {
  const lines = body.split('\n');
  const sections = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current);
      current = { heading: line.slice(3).trim(), body: '' };
    } else {
      if (!current) current = { heading: null, body: '' };
      current.body += (current.body ? '\n' : '') + line;
    }
  }
  if (current) sections.push(current);

  // Clean up leading/trailing blank lines in each body
  return sections.map(s => ({ ...s, body: s.body.trim() })).filter(s => s.heading || s.body);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PDF BUILDER
//  Supports multi-page documents with automatic page breaks
// ─────────────────────────────────────────────────────────────────────────────
async function buildPdf({ job, signer_name, signature_png, signed_at, doc_type, divisions, templateSections }) {
  const pdfDoc  = await PDFDocument.create();
  const fBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fReg    = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const PW = 612, PH = 792, M = 56, CW = PW - M * 2;
  const black = rgb(0.05, 0.05, 0.05);
  const gray  = rgb(0.40, 0.40, 0.40);
  const lgray = rgb(0.85, 0.85, 0.85);
  const blue  = rgb(0.145, 0.388, 0.922);
  const white = rgb(1, 1, 1);

  // Minimum Y before triggering page break (leaves room for sig block on last page)
  const MIN_Y = 130;

  // ── Page state ──
  let page = null;
  let y    = 0;

  const addPage = () => {
    page = pdfDoc.addPage([PW, PH]);
    y    = PH - 40;
  };

  const ensureY = (needed) => {
    if (y < needed) addPage();
  };

  // ── Primitives ──
  const txt = (str, x, yy, { font = fReg, size = 10, color = black } = {}) => {
    if (!str) return;
    page.drawText(String(str), { x, y: yy, font, size, color });
  };

  const line = (x1, yy, x2, { thickness = 0.5, color = lgray } = {}) => {
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness, color });
  };

  // Wrap a single paragraph (no embedded newlines), respecting page breaks
  const wrapText = (str, x, startY, maxW, { font = fReg, size = 10, color = black, lh = 14 } = {}) => {
    if (!str?.trim()) return startY;
    const words = str.split(' ');
    let lineStr = '', cy = startY;
    for (const w of words) {
      const test = lineStr ? `${lineStr} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxW && lineStr) {
        ensureY(MIN_Y);
        txt(lineStr, x, y < startY ? y : cy, { font, size, color });
        if (y !== cy) cy = y; // page was added mid-paragraph
        cy -= lh;
        lineStr = w;
      } else {
        lineStr = test;
      }
    }
    if (lineStr) {
      ensureY(MIN_Y);
      txt(lineStr, x, y < cy ? y : cy, { font, size, color });
      if (y !== cy) cy = y;
      cy -= lh;
    }
    return cy;
  };

  // Render a block of text that may contain \n line breaks and \n\n paragraph breaks
  const renderBody = (body, x, startY, maxW, opts = {}) => {
    const { lh = 14, paraGap = 8 } = opts;
    const paragraphs = body.split(/\n\n+/);
    let cy = startY;
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) { cy -= paraGap; continue; }
      // Handle single \n within a paragraph as forced line breaks
      const subLines = trimmed.split('\n');
      for (const subLine of subLines) {
        if (!subLine.trim()) { cy -= lh * 0.5; continue; }
        cy = wrapText(subLine, x, cy, maxW, { ...opts, lh });
      }
      cy -= paraGap; // paragraph gap
    }
    return cy;
  };

  // ── FIRST PAGE: header + job info ──
  addPage();
  y = PH - 48;

  // Header bar
  page.drawRectangle({ x: 0, y: PH - 80, width: PW, height: 80, color: rgb(0.118, 0.161, 0.231) });
  txt('Utah Pros Restoration', M,    PH - 32, { font: fBold, size: 18, color: white });
  txt('Licensed · Insured · Utah',   M, PH - 50, { font: fReg,  size: 10, color: rgb(0.58, 0.65, 0.75) });
  txt('(801) 427-0582  ·  restoration@utah-pros.com', M, PH - 65, { font: fReg, size: 9, color: rgb(0.58, 0.65, 0.75) });
  y = PH - 80 - 28;

  // Title
  const titleLabel = DOC_TITLES[doc_type] || 'Document';
  const titleW = fBold.widthOfTextAtSize(titleLabel, 18);
  txt(titleLabel, (PW - titleW) / 2, y, { font: fBold, size: 18 });
  y -= 8;
  page.drawLine({ start: { x: (PW - 160) / 2, y }, end: { x: (PW + 160) / 2, y }, thickness: 2, color: blue });
  y -= 24;

  // Job info grid
  const c1 = M, c2 = M + 260;
  const infoRow = (label, val, col, yp) => {
    txt(label,      col, yp,      { font: fBold, size: 9,  color: gray });
    txt(val || '—', col, yp - 13, { font: fReg,  size: 10, color: black });
  };
  infoRow('CLIENT NAME',      job.insured_name,       c1, y);
  infoRow('JOB NUMBER',       job.job_number,         c2, y); y -= 32;
  const addr = [job.address, job.city, job.state].filter(Boolean).join(', ');
  infoRow('PROPERTY ADDRESS', addr,                   c1, y);
  infoRow('DATE OF LOSS', job.date_of_loss
    ? new Date(job.date_of_loss).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null,                                           c2, y); y -= 32;
  infoRow('INSURANCE COMPANY', job.insurance_company, c1, y);
  infoRow('CLAIM NUMBER',      job.claim_number,      c2, y); y -= 22;
  line(M, y, PW - M); y -= 20;

  // ── DOCUMENT SECTIONS ──
  const sections = templateSections || buildCocSections(divisions);

  for (const s of sections) {
    // Section heading
    if (s.heading) {
      ensureY(MIN_Y + 40);
      txt(s.heading, M, y, { font: fBold, size: 11 });
      y -= 18;
    }
    // Section body
    if (s.body) {
      y = renderBody(s.body, M, y, CW, { font: fReg, size: 9.5, color: black, lh: 14, paraGap: 8 });
      y -= 8;
    }
  }

  line(M, y + 6, PW - M); y -= 20;

  // ── AUTHORIZATION BLURB ──
  ensureY(MIN_Y + 30);
  y = renderBody(
    'By signing below, I confirm that I am authorized to sign on behalf of the property owner and all responsible parties, and that the information above is accurate to the best of my knowledge. I authorize Utah Pros Restoration to receive payment directly for all work performed under this agreement.',
    M, y, CW, { font: fReg, size: 9.5, color: gray, lh: 14 }
  );
  y -= 24;

  // ── SIGNATURE BLOCK (always needs ~110px — create new page if necessary) ──
  ensureY(150);
  page.drawRectangle({
    x: M - 8, y: y - 90,
    width: PW - (M - 8) * 2, height: 100,
    color: rgb(0.975, 0.978, 0.984),
    borderColor: lgray, borderWidth: 0.5,
  });

  // Signature image
  try {
    const b64   = signature_png.replace(/^data:image\/png;base64,/, '');
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const img   = await pdfDoc.embedPng(bytes);
    const dims  = img.scale(1);
    const scale = Math.min(220 / dims.width, 70 / dims.height, 1);
    page.drawImage(img, {
      x: M, y: y - 76,
      width: dims.width * scale, height: dims.height * scale,
      opacity: 0.9,
    });
  } catch (e) { console.warn('Sig embed failed:', e.message); }

  const rx = M + CW / 2 + 12;
  txt('PRINTED NAME', rx, y - 8,  { font: fBold, size: 8, color: gray });
  txt(signer_name,    rx, y - 22, { font: fBold, size: 11 });
  txt('DATE SIGNED',  rx, y - 44, { font: fBold, size: 8, color: gray });
  txt(signed_at.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), rx, y - 58, { font: fReg, size: 10 });
  line(M, y - 82, M + 240, { thickness: 0.75, color: rgb(0.6, 0.6, 0.6) });
  txt('Authorized Signature', M, y - 94, { font: fReg, size: 8, color: gray });

  // ── FOOTER AUDIT TRAIL (all pages) ──
  const allPages = pdfDoc.getPages();
  for (const p of allPages) {
    p.drawLine({ start: { x: M, y: 50 }, end: { x: PW - M, y: 50 }, thickness: 0.5, color: lgray });
    p.drawText(
      `Electronically signed · ${signed_at.toISOString()} · Utah Pros Restoration · utah-pros.com`,
      { x: M, y: 36, font: fReg, size: 7.5, color: rgb(0.6, 0.6, 0.6) }
    );
  }

  return pdfDoc.save();
}

// ─────────────────────────────────────────────────────────────────────────────
//  CoC SECTIONS (hardcoded per-division completion text — not from DB)
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

const DOC_TITLES = {
  coc:           'Certificate of Completion',
  work_auth:     'Work Authorization',
  direction_pay: 'Direction of Pay',
  change_order:  'Change Order',
};
