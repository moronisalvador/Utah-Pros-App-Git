// POST /api/submit-esign
// Called when client submits their signature on the sign page.
// Generates the signed PDF with pdf-lib, uploads to Supabase Storage,
// and calls complete_sign_request to mark signed + insert into job_documents.
//
// Request body:
// {
//   token:          uuid,
//   signer_name:    string,
//   signature_png:  string  (base64 data URL: "data:image/png;base64,...")
// }

import { supabase } from '../lib/supabase.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);

  try {
    const { token, signer_name, signature_png } = await request.json();

    if (!token)         return jsonResponse({ error: 'token is required' },         400, request, env);
    if (!signer_name)   return jsonResponse({ error: 'signer_name is required' },   400, request, env);
    if (!signature_png) return jsonResponse({ error: 'signature_png is required' }, 400, request, env);

    // ── 1. Fetch sign request + job data ──
    const signReq = await db.rpc('get_sign_request_by_token', { p_token: token });

    if (!signReq) {
      return jsonResponse({ error: 'Signing link not found or expired' }, 404, request, env);
    }
    if (signReq.status === 'signed') {
      return jsonResponse({ error: 'This document has already been signed' }, 409, request, env);
    }
    if (signReq.status !== 'pending') {
      return jsonResponse({ error: 'This signing link is no longer valid' }, 410, request, env);
    }
    if (new Date(signReq.expires_at) < new Date()) {
      return jsonResponse({ error: 'This signing link has expired' }, 410, request, env);
    }

    const job = signReq.job;
    const signedAt = new Date();

    // ── 2. Build PDF ──
    const pdfBytes = await buildCocPdf({
      job,
      signer_name,
      signature_png,
      signed_at: signedAt,
      doc_type:  signReq.doc_type,
    });

    // ── 3. Upload to Supabase Storage ──
    const fileName    = `coc-signed-${Date.now()}.pdf`;
    const storagePath = `${job.id}/esign/${fileName}`;
    const SUPABASE_URL = env.SUPABASE_URL;
    const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;

    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/job-files/${storagePath}`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey':        SUPABASE_KEY,
          'Content-Type':  'application/pdf',
          'x-upsert':      'true',
        },
        body: pdfBytes,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Storage upload failed: ${errText}`);
    }

    // ── 4. Get signer IP ──
    const signerIp = request.headers.get('CF-Connecting-IP')
      || request.headers.get('X-Forwarded-For')
      || 'unknown';

    // ── 5. Complete sign request (marks signed + inserts into job_documents) ──
    const result = await db.rpc('complete_sign_request', {
      p_token:            token,
      p_signer_name:      signer_name,
      p_signer_ip:        signerIp,
      p_signed_file_path: storagePath,
    });

    if (!result || result.error) {
      throw new Error(result?.error || 'Failed to complete sign request');
    }

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

// ════════════════════════════════════════════════════════
//  PDF BUILDER  — UPR Certificate of Completion
// ════════════════════════════════════════════════════════
async function buildCocPdf({ job, signer_name, signature_png, signed_at, doc_type }) {
  const pdfDoc = await PDFDocument.create();
  const page   = pdfDoc.addPage([612, 792]); // US Letter
  const { width, height } = page.getSize();

  const fontBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontReg    = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const black  = rgb(0.05, 0.05, 0.05);
  const gray   = rgb(0.4,  0.4,  0.4);
  const lgray  = rgb(0.85, 0.85, 0.85);
  const blue   = rgb(0.145, 0.388, 0.922);
  const white  = rgb(1, 1, 1);

  const margin = 56;
  let   y      = height - 48;

  // ── Helper: draw text ──
  const text = (str, x, yPos, { font = fontReg, size = 10, color = black } = {}) => {
    if (!str) return;
    page.drawText(String(str), { x, y: yPos, font, size, color });
  };

  // ── Helper: draw line ──
  const line = (x1, yPos, x2, { thickness = 0.5, color = lgray } = {}) => {
    page.drawLine({ start: { x: x1, y: yPos }, end: { x: x2, y: yPos }, thickness, color });
  };

  // ── Helper: wrap + draw paragraph ──
  const para = (str, x, yPos, maxWidth, { font = fontReg, size = 10, color = black, lineHeight = 15 } = {}) => {
    const words = str.split(' ');
    let line1 = '';
    let curY  = yPos;
    for (const word of words) {
      const test = line1 ? `${line1} ${word}` : word;
      const w    = font.widthOfTextAtSize(test, size);
      if (w > maxWidth && line1) {
        text(line1, x, curY, { font, size, color });
        curY  -= lineHeight;
        line1  = word;
      } else {
        line1 = test;
      }
    }
    if (line1) text(line1, x, curY, { font, size, color });
    return curY - lineHeight;
  };

  // ══════════════════════════════════════
  //  HEADER — dark bar
  // ══════════════════════════════════════
  page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: rgb(0.118, 0.161, 0.231) });

  text('Utah Pros Restoration', margin, height - 32, { font: fontBold, size: 18, color: white });
  text('Licensed · Insured · Utah', margin, height - 50, { font: fontReg, size: 10, color: rgb(0.58, 0.65, 0.75) });
  text('(801) 000-0000  ·  restoration@utah-pros.com', margin, height - 65, { font: fontReg, size: 9, color: rgb(0.58, 0.65, 0.75) });

  y = height - 80 - 28;

  // ══════════════════════════════════════
  //  TITLE
  // ══════════════════════════════════════
  const titleLabel = DOC_TITLES[doc_type] || 'Certificate of Completion';
  const titleW = fontBold.widthOfTextAtSize(titleLabel, 18);
  text(titleLabel, (width - titleW) / 2, y, { font: fontBold, size: 18, color: black });
  y -= 8;
  // Accent underline
  page.drawLine({
    start:     { x: (width - 160) / 2, y },
    end:       { x: (width + 160) / 2, y },
    thickness: 2,
    color:     blue,
  });
  y -= 24;

  // ══════════════════════════════════════
  //  JOB INFO BLOCK
  // ══════════════════════════════════════
  const col1 = margin;
  const col2 = margin + 260;
  const infoSize = 10;

  const infoRow = (label, val, col, yPos) => {
    text(label, col, yPos, { font: fontBold, size: 9, color: gray });
    text(val || '—', col, yPos - 13, { font: fontReg, size: infoSize, color: black });
  };

  infoRow('CLIENT NAME',     job.insured_name, col1, y);
  infoRow('JOB NUMBER',      job.job_number,   col2, y);
  y -= 32;

  const address = [job.address, job.city, job.state].filter(Boolean).join(', ');
  infoRow('PROPERTY ADDRESS', address, col1, y);
  infoRow('DATE OF LOSS',     job.date_of_loss
    ? new Date(job.date_of_loss).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null, col2, y);
  y -= 32;

  infoRow('INSURANCE COMPANY', job.insurance_company, col1, y);
  infoRow('CLAIM NUMBER',       job.claim_number,     col2, y);
  y -= 22;

  line(margin, y, width - margin);
  y -= 20;

  // ══════════════════════════════════════
  //  SECTION CONTENT based on division / doc_type
  // ══════════════════════════════════════
  const sections = buildSections(job.division, doc_type);

  for (const section of sections) {
    // Section heading
    text(section.heading, margin, y, { font: fontBold, size: 11, color: black });
    y -= 16;

    // Body paragraph
    y = para(section.body, margin, y, width - margin * 2, { font: fontReg, size: 10, color: black, lineHeight: 15 });
    y -= 16;
  }

  line(margin, y + 8, width - margin);
  y -= 20;

  // ══════════════════════════════════════
  //  AUTHORIZATION PARAGRAPH
  // ══════════════════════════════════════
  const authText =
    'By signing below, I confirm that I am authorized to sign on behalf of the property owner and all ' +
    'responsible parties, and that the information above is accurate to the best of my knowledge. ' +
    'I authorize Utah Pros Restoration to receive payment directly for all work performed under this agreement.';

  y = para(authText, margin, y, width - margin * 2, { font: fontReg, size: 9.5, color: gray, lineHeight: 14 });
  y -= 28;

  // ══════════════════════════════════════
  //  SIGNATURE BLOCK
  // ══════════════════════════════════════
  // Background box
  page.drawRectangle({
    x:      margin - 8,
    y:      y - 90,
    width:  width - (margin - 8) * 2,
    height: 100,
    color:  rgb(0.975, 0.978, 0.984),
    borderColor: lgray,
    borderWidth: 0.5,
    borderRadius: 4,
  });

  // Signature image (left half)
  try {
    const base64Data = signature_png.replace(/^data:image\/png;base64,/, '');
    const sigBytes   = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const sigImage   = await pdfDoc.embedPng(sigBytes);
    const sigDims    = sigImage.scale(1);
    const maxW = 220, maxH = 70;
    const scale = Math.min(maxW / sigDims.width, maxH / sigDims.height, 1);

    page.drawImage(sigImage, {
      x:      margin,
      y:      y - 76,
      width:  sigDims.width  * scale,
      height: sigDims.height * scale,
      opacity: 0.9,
    });
  } catch (e) {
    console.warn('Signature image embed failed:', e.message);
  }

  // Printed name + date (right side)
  const rightX = margin + (width - margin * 2) / 2 + 12;

  text('PRINTED NAME', rightX, y - 8, { font: fontBold, size: 8, color: gray });
  text(signer_name, rightX, y - 22, { font: fontBold, size: 11, color: black });

  text('DATE SIGNED', rightX, y - 44, { font: fontBold, size: 8, color: gray });
  text(
    signed_at.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    rightX, y - 58, { font: fontReg, size: 10, color: black }
  );

  // Signature label
  line(margin, y - 82, margin + 240, { thickness: 0.75, color: rgb(0.6, 0.6, 0.6) });
  text('Authorized Signature', margin, y - 94, { font: fontReg, size: 8, color: gray });

  y -= 110;

  // ══════════════════════════════════════
  //  FOOTER — audit trail
  // ══════════════════════════════════════
  y = 36;
  line(margin, y + 14, width - margin);
  text(
    `Electronically signed · ${signed_at.toISOString()} · Utah Pros Restoration · utah-pros.com`,
    margin, y, { font: fontReg, size: 7.5, color: rgb(0.6, 0.6, 0.6) }
  );

  return await pdfDoc.save();
}

// ── Build section text by division ──
function buildSections(division, doc_type) {
  if (doc_type !== 'coc') return [{ heading: 'Work Completed', body: 'All work described in the work authorization has been satisfactorily completed in a professional manner.' }];

  const divMap = {
    water: [
      {
        heading: 'Mitigation',
        body: 'I confirm that all water mitigation services performed by Utah Pros Restoration at the above property have been completed to my satisfaction. The work was performed in a professional manner and is 100% complete. I have no outstanding complaints or concerns regarding the mitigation work.',
      },
    ],
    mold: [
      {
        heading: 'Mold Remediation',
        body: 'I confirm that all mold remediation services performed by Utah Pros Restoration at the above property have been completed to my satisfaction. The affected areas have been properly contained, treated, and cleared. The work is 100% complete and I have no outstanding complaints or concerns.',
      },
    ],
    reconstruction: [
      {
        heading: 'Repairs & Reconstruction',
        body: 'I confirm that all repairs and reconstruction performed by Utah Pros Restoration at the above property have been completed to my satisfaction. The repaired portions of the property are in equal or better condition than prior to the loss. The work is 100% complete and I have no outstanding complaints or concerns.',
      },
    ],
    fire: [
      {
        heading: 'Fire & Smoke Restoration',
        body: 'I confirm that all fire and smoke restoration services performed by Utah Pros Restoration at the above property have been completed to my satisfaction. The work was performed in a professional manner and is 100% complete. I have no outstanding complaints or concerns.',
      },
    ],
    contents: [
      {
        heading: 'Contents Restoration',
        body: 'I confirm that Utah Pros Restoration has returned all salvageable contents items removed from the property in satisfactory condition. I have had the opportunity to inspect the returned items. The work is 100% complete and I have no outstanding complaints or concerns.',
      },
    ],
  };

  return divMap[division] || [
    {
      heading: 'Work Completed',
      body: 'I confirm that all restoration services performed by Utah Pros Restoration at the above property have been completed to my satisfaction. The work was performed in a professional manner and is 100% complete. I have no outstanding complaints or concerns.',
    },
  ];
}

const DOC_TITLES = {
  coc:           'Certificate of Completion',
  work_auth:     'Work Authorization',
  direction_pay: 'Direction of Pay',
  change_order:  'Change Order',
};
