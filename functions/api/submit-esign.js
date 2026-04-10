// POST /api/submit-esign
// Called when client submits signature on the sign page.
// Generates signed PDF with pdf-lib, uploads to Supabase Storage,
// calls complete_sign_request to mark signed + insert into job_documents.
//
// Body: { token, signer_name, signature_png }
// Divisions and template content come from the DB — not the request body.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

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

    // ── 2. Fetch template from DB for non-CoC docs ──
    let templateSections = null;
    if (signReq.doc_type !== 'coc') {
      const templates = await select(
        'document_templates',
        `doc_type=eq.${encodeURIComponent(signReq.doc_type)}&order=sort_order.asc`
      );
      if (templates.length > 0) {
        const body = substituteVars(templates[0].body, job);
        templateSections = parseMarkdownSections(body);
      }
    }

    // ── 3. Generate PDF ──
    const signerIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || null;
    const pdfBytes = await buildPdf({
      job, signer_name, signature_png,
      signed_at: signedAt,
      doc_type:  signReq.doc_type,
      divisions,
      templateSections,
      signer_ip: signerIp,
    });

    // ── 4. Upload to Supabase Storage ──
    const storagePath = `${job.id}/esign/${signReq.doc_type}-signed-${Date.now()}.pdf`;
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/job-files/${storagePath}`, {
      method: 'POST',
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
    const result = await rpc('complete_sign_request', {
      p_token:            token,
      p_signer_name:      signer_name,
      p_signer_ip:        signerIp,
      p_signed_file_path: storagePath,
    });
    if (!result || result.error) throw new Error(result?.error || 'Failed to complete sign request');

    // ── 6. Send confirmation email with PDF attached ──
    const docLabel = {
      coc:           'Certificate of Completion',
      work_auth:     'Work Authorization',
      direction_pay: 'Direction of Pay',
      change_order:  'Change Order',
    }[signReq.doc_type] || 'Signed Document';

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

    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SENDGRID_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        personalizations: [{
          to:      [{ email: signReq.signer_email, name: signer_name }],
          subject: `Your signed ${docLabel} – Utah Pros Restoration`,
        }],
        from:     { email: 'restoration@utah-pros.com', name: 'Utah Pros Restoration' },
        reply_to: { email: 'restoration@utah-pros.com', name: 'Utah Pros Restoration' },
        content: [
          {
            type:  'text/plain',
            value: `Hi ${firstName},\n\nThank you for signing. Your ${docLabel} is attached to this email for your records.\n\nDocument: ${docLabel}\nProperty: ${[job.address, job.city, job.state].filter(Boolean).join(', ')}\nSigned: ${signedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}\n\nIf you have any questions, reply to this email or call us at (801) 427-0582.\n\n— Utah Pros Restoration`,
          },
          {
            type:  'text/html',
            value: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;"><tr><td align="center"><table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);"><tr><td style="background:#1e293b;padding:28px 32px;text-align:center;"><p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">Utah Pros Restoration</p><p style="margin:4px 0 0;font-size:13px;color:#94a3b8;">Licensed &amp; Insured &middot; Utah</p></td></tr><tr><td style="padding:32px;"><p style="margin:0 0 20px;font-size:16px;color:#0f172a;">Hi ${firstName},</p><p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.6;">Thank you for signing. Your <strong>${docLabel}</strong> is attached to this email for your records.</p><table cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;"><tr><td style="padding:16px 20px;"><p style="margin:0 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8;">Document Details</p><table cellpadding="0" cellspacing="0"><tr><td style="font-size:13px;color:#64748b;padding:3px 0;width:100px;">Document</td><td style="font-size:13px;color:#0f172a;font-weight:500;padding:3px 0;">${docLabel}</td></tr><tr><td style="font-size:13px;color:#64748b;padding:3px 0;">Property</td><td style="font-size:13px;color:#0f172a;font-weight:500;padding:3px 0;">${[job.address, job.city, job.state].filter(Boolean).join(', ')}</td></tr><tr><td style="font-size:13px;color:#64748b;padding:3px 0;">Signed</td><td style="font-size:13px;color:#0f172a;font-weight:500;padding:3px 0;">${signedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</td></tr></table></td></tr></table><p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;">The signed PDF is attached. Please save it for your records.</p></td></tr><tr><td style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;"><p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">Questions? Reply to this email or call <strong>(801) 427-0582</strong>.</p></td></tr></table></td></tr></table></body></html>`,
          },
        ],
        attachments: [{
          content:     pdfB64,
          filename:    fileName,
          type:        'application/pdf',
          disposition: 'attachment',
        }],
      }),
    }).catch(e => console.error('Confirmation email failed:', e.message));
    // Non-fatal — don't throw if email fails, the document is already signed and stored

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
// ─────────────────────────────────────────────────────────────────────────────
function substituteVars(body, job) {
  const hasInsurance = !!job.insurance_company;
  const dolFormatted = job.date_of_loss
    ? new Date(job.date_of_loss).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  const insuranceSection = hasInsurance
    ? `DIRECTION OF PAYMENT\n\nI hereby direct ${job.insurance_company} to pay Utah Pros Restoration directly for all restoration services performed at the above property under Claim No. ${job.claim_number || '[Pending]'}. I authorize Utah Pros Restoration to negotiate, supplement, and finalize my claim on my behalf.`
    : `PRIVATE PAY & CONDITIONAL ASSIGNMENT OF BENEFITS\n\nI acknowledge that no insurance claim has been filed as of the date of this Agreement. Should I subsequently file an insurance claim for damage addressed by this Agreement, I hereby IRREVOCABLY PRE-ASSIGN to Utah Pros Restoration all insurance proceeds attributable to the work performed hereunder. This pre-assignment is retroactive to the date of this Agreement. I will notify Utah Pros Restoration within 3 business days of filing any claim and will immediately execute a Direction to Pay/Assignment of Benefits upon request. My payment obligation is unconditional and not contingent on any insurance filing, approval, or payment.`;

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
async function buildPdf({ job, signer_name, signature_png, signed_at, doc_type, divisions, templateSections, signer_ip }) {
  const pdfDoc = await PDFDocument.create();
  const fBold  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fReg   = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const PW = 612, PH = 792, M = 56, CW = PW - M * 2;
  const needsCoSig  = doc_type === 'work_auth' || doc_type === 'change_order';
  const SIG_BLOCK_H = needsCoSig ? 210 : 130; // extra height for company block
  const FOOTER_H    = 60;  // height reserved for footer
  const MIN_Y       = SIG_BLOCK_H + FOOTER_H;

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
  const drawText = (str, x, y, { font = fReg, size = 10, color = black } = {}) => {
    if (!str) return;
    curPage.drawText(String(str), { x, y, font, size, color });
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
  const drawWrapped = (str, x, maxW, { font = fReg, size = 9.5, color = black, lh = 14 } = {}) => {
    if (!str?.trim()) return curY;

    const words = str.trim().split(/\s+/);
    let current = '';

    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxW && current) {
        // Flush current line
        needY(MIN_Y);
        drawText(current, x, curY, { font, size, color });
        curY -= lh;
        current = word;
      } else {
        current = test;
      }
    }
    // Flush last line
    if (current) {
      needY(MIN_Y);
      drawText(current, x, curY, { font, size, color });
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
      drawText(s.heading, M, curY, { font: fBold, size: 11 });
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

  // ── COMPANY PRE-AUTHORIZATION BLOCK (Work Auth + Change Order only) ──
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

const DOC_TITLES = {
  coc:           'Certificate of Completion',
  work_auth:     'Work Authorization',
  direction_pay: 'Direction of Pay',
  change_order:  'Change Order',
};
