// POST /api/submit-esign
// Called when client submits signature on the sign page.
// Generates signed PDF with pdf-lib, uploads to Supabase Storage,
// calls complete_sign_request to mark signed + insert into job_documents.
//
// Body: { token, signer_name, signature_png }

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const SUPABASE_KEY = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

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
    const { token, signer_name, signature_png } = await request.json();

    if (!token)         return jsonResponse({ error: 'token is required' },         400, request, env);
    if (!signer_name)   return jsonResponse({ error: 'signer_name is required' },   400, request, env);
    if (!signature_png) return jsonResponse({ error: 'signature_png is required' }, 400, request, env);

    // ── 1. Fetch sign request + job ──
    const signReq = await rpc('get_sign_request_by_token', { p_token: token });
    if (!signReq)                        return jsonResponse({ error: 'Signing link not found' },          404, request, env);
    if (signReq.status === 'signed')     return jsonResponse({ error: 'Document already signed' },         409, request, env);
    if (signReq.status !== 'pending')    return jsonResponse({ error: 'Signing link is no longer valid' }, 410, request, env);
    if (new Date(signReq.expires_at) < new Date()) return jsonResponse({ error: 'Signing link has expired' }, 410, request, env);

    const job       = signReq.job;
    const signedAt  = new Date();

    // ── 2. Generate PDF ──
    const pdfBytes = await buildCocPdf({ job, signer_name, signature_png, signed_at: signedAt, doc_type: signReq.doc_type });

    // ── 3. Upload to Supabase Storage ──
    const storagePath = `${job.id}/esign/coc-signed-${Date.now()}.pdf`;
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

    // ── 4. Complete sign request ──
    const signerIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const result = await rpc('complete_sign_request', {
      p_token:            token,
      p_signer_name:      signer_name,
      p_signer_ip:        signerIp,
      p_signed_file_path: storagePath,
    });

    if (!result || result.error) throw new Error(result?.error || 'Failed to complete sign request');

    return jsonResponse({
      success: true,
      job_document_id: result.job_document_id,
      job_id:          result.job_id,
      signed_at:       signedAt.toISOString(),
    }, 200, request, env);

  } catch (err) {
    console.error('submit-esign error:', err);
    return jsonResponse({ error: err.message || 'Internal server error' }, 500, request, env);
  }
}

// ════════════════════════════════════════════════════════
//  PDF BUILDER — UPR Certificate of Completion
// ════════════════════════════════════════════════════════
async function buildCocPdf({ job, signer_name, signature_png, signed_at, doc_type }) {
  const pdfDoc   = await PDFDocument.create();
  const page     = pdfDoc.addPage([612, 792]);
  const { width, height } = page.getSize();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const black = rgb(0.05, 0.05, 0.05);
  const gray  = rgb(0.4,  0.4,  0.4);
  const lgray = rgb(0.85, 0.85, 0.85);
  const blue  = rgb(0.145, 0.388, 0.922);
  const white = rgb(1, 1, 1);
  const margin = 56;

  const txt = (str, x, y, { font = fontReg, size = 10, color = black } = {}) => {
    if (!str) return;
    page.drawText(String(str), { x, y, font, size, color });
  };

  const ln = (x1, y, x2, { thickness = 0.5, color = lgray } = {}) =>
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });

  const wrap = (str, x, y, maxW, { font = fontReg, size = 10, color = black, lh = 15 } = {}) => {
    const words = str.split(' ');
    let line = '', cy = y;
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxW && line) {
        txt(line, x, cy, { font, size, color }); cy -= lh; line = w;
      } else line = test;
    }
    if (line) txt(line, x, cy, { font, size, color });
    return cy - lh;
  };

  let y = height - 48;

  // Header bar
  page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: rgb(0.118, 0.161, 0.231) });
  txt('Utah Pros Restoration', margin, height - 32, { font: fontBold, size: 18, color: white });
  txt('Licensed · Insured · Utah', margin, height - 50, { font: fontReg, size: 10, color: rgb(0.58, 0.65, 0.75) });
  txt('(801) 427-0582  ·  restoration@utah-pros.com', margin, height - 65, { font: fontReg, size: 9, color: rgb(0.58, 0.65, 0.75) });
  y = height - 80 - 28;

  // Title
  const titleLabel = DOC_TITLES[doc_type] || 'Certificate of Completion';
  const titleW = fontBold.widthOfTextAtSize(titleLabel, 18);
  txt(titleLabel, (width - titleW) / 2, y, { font: fontBold, size: 18 });
  y -= 8;
  page.drawLine({ start: { x: (width - 160) / 2, y }, end: { x: (width + 160) / 2, y }, thickness: 2, color: blue });
  y -= 24;

  // Job info grid
  const c1 = margin, c2 = margin + 260;
  const infoRow = (label, val, col, yp) => {
    txt(label, col, yp,      { font: fontBold, size: 9,  color: gray });
    txt(val||'—', col, yp-13, { font: fontReg,  size: 10, color: black });
  };
  infoRow('CLIENT NAME',     job.insured_name,   c1, y);
  infoRow('JOB NUMBER',      job.job_number,     c2, y); y -= 32;
  const addr = [job.address, job.city, job.state].filter(Boolean).join(', ');
  infoRow('PROPERTY ADDRESS', addr,              c1, y);
  infoRow('DATE OF LOSS', job.date_of_loss
    ? new Date(job.date_of_loss).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null, c2, y); y -= 32;
  infoRow('INSURANCE COMPANY', job.insurance_company, c1, y);
  infoRow('CLAIM NUMBER',       job.claim_number,     c2, y); y -= 22;
  ln(margin, y, width - margin); y -= 20;

  // Section body
  const sections = buildSections(job.division, doc_type);
  for (const s of sections) {
    txt(s.heading, margin, y, { font: fontBold, size: 11 }); y -= 16;
    y = wrap(s.body, margin, y, width - margin * 2, { lh: 15 }); y -= 16;
  }
  ln(margin, y + 8, width - margin); y -= 20;

  // Authorization
  y = wrap(
    'By signing below, I confirm that I am authorized to sign on behalf of the property owner and all responsible parties, and that the information above is accurate to the best of my knowledge. I authorize Utah Pros Restoration to receive payment directly for all work performed under this agreement.',
    margin, y, width - margin * 2, { font: fontReg, size: 9.5, color: gray, lh: 14 }
  ); y -= 28;

  // Signature block
  page.drawRectangle({ x: margin - 8, y: y - 90, width: width - (margin - 8) * 2, height: 100, color: rgb(0.975, 0.978, 0.984), borderColor: lgray, borderWidth: 0.5 });

  try {
    const b64  = signature_png.replace(/^data:image\/png;base64,/, '');
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const img   = await pdfDoc.embedPng(bytes);
    const dims  = img.scale(1);
    const scale = Math.min(220 / dims.width, 70 / dims.height, 1);
    page.drawImage(img, { x: margin, y: y - 76, width: dims.width * scale, height: dims.height * scale, opacity: 0.9 });
  } catch (e) { console.warn('Sig embed failed:', e.message); }

  const rx = margin + (width - margin * 2) / 2 + 12;
  txt('PRINTED NAME', rx, y - 8,  { font: fontBold, size: 8, color: gray });
  txt(signer_name,    rx, y - 22, { font: fontBold, size: 11 });
  txt('DATE SIGNED',  rx, y - 44, { font: fontBold, size: 8, color: gray });
  txt(signed_at.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), rx, y - 58, { font: fontReg, size: 10 });
  ln(margin, y - 82, margin + 240, { thickness: 0.75, color: rgb(0.6, 0.6, 0.6) });
  txt('Authorized Signature', margin, y - 94, { font: fontReg, size: 8, color: gray });

  // Footer audit trail
  ln(margin, 50, width - margin);
  txt(`Electronically signed · ${signed_at.toISOString()} · Utah Pros Restoration · utah-pros.com`, margin, 36, { font: fontReg, size: 7.5, color: rgb(0.6, 0.6, 0.6) });

  return pdfDoc.save();
}

function buildSections(division, doc_type) {
  if (doc_type !== 'coc') return [{ heading: 'Work Completed', body: 'All work described in the work authorization has been satisfactorily completed in a professional manner.' }];
  const map = {
    water:          [{ heading: 'Mitigation',               body: 'I confirm that all water mitigation services performed by Utah Pros Restoration at the above property have been completed to my satisfaction. The work was performed in a professional manner and is 100% complete. I have no outstanding complaints or concerns.' }],
    mold:           [{ heading: 'Mold Remediation',         body: 'I confirm that all mold remediation services performed by Utah Pros Restoration have been completed to my satisfaction. The affected areas have been properly contained, treated, and cleared. The work is 100% complete and I have no outstanding complaints or concerns.' }],
    reconstruction: [{ heading: 'Repairs & Reconstruction', body: 'I confirm that all repairs and reconstruction performed by Utah Pros Restoration have been completed to my satisfaction. The repaired portions of the property are in equal or better condition than prior to the loss. The work is 100% complete and I have no outstanding complaints or concerns.' }],
    fire:           [{ heading: 'Fire & Smoke Restoration', body: 'I confirm that all fire and smoke restoration services performed by Utah Pros Restoration have been completed to my satisfaction. The work was performed in a professional manner and is 100% complete. I have no outstanding complaints or concerns.' }],
    contents:       [{ heading: 'Contents Restoration',     body: 'I confirm that Utah Pros Restoration has returned all salvageable contents items in satisfactory condition. I have had the opportunity to inspect the returned items. The work is 100% complete and I have no outstanding complaints or concerns.' }],
  };
  return map[division] || [{ heading: 'Work Completed', body: 'I confirm that all restoration services performed by Utah Pros Restoration have been completed to my satisfaction. The work was performed in a professional manner and is 100% complete. I have no outstanding complaints or concerns.' }];
}

const DOC_TITLES = {
  coc:           'Certificate of Completion',
  work_auth:     'Work Authorization',
  direction_pay: 'Direction of Pay',
  change_order:  'Change Order',
};
