// POST /api/homebuilding-build-plan-pdf — export a polished "Build Plan" PDF for the New Build
// simulator. Receives the fully-computed plan from the page and returns application/pdf bytes
// for direct browser download. Moroni-only. Mirrors the pdf-lib pattern in demo-sheet-pdf.js.
//
// Body: { label, region, spec, plan:{lineItems,schedule,draws,hardTotal,costPerSf,months,arv},
//         financing:{soft,contingency,total,loan,down,carry,reserves,sellCost,profit,margin,cashNeeded,coc} }
// Env:  SUPABASE_* (auth). No AI, no storage — just renders + returns.

import { handleOptions, jsonResponse, corsHeaders } from '../lib/cors.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const OWNER_EMAIL = 'moroni@utah-pros.com';

async function getUserEmail(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user?.email || null;
}

// WinAnsi-safe text (StandardFonts can't encode emoji / box-drawing chars).
const san = (s) => String(s ?? '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '-');
const commas = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const money = (n) => '$' + commas(n);
const pct = (n) => (Number(n) * 100).toFixed(1) + '%';

const INK = rgb(0.08, 0.13, 0.17);
const MUTED = rgb(0.36, 0.40, 0.46);
const STEEL = rgb(0.118, 0.227, 0.361);
const AMBER = rgb(0.76, 0.455, 0.11);
const LINE = rgb(0.84, 0.855, 0.875);

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const email = await getUserEmail(request, env);
  if (!email) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);
  if (email.toLowerCase() !== OWNER_EMAIL) return jsonResponse({ error: 'Forbidden' }, 403, request, env);

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  const label = body.label || 'Build Plan';
  const region = body.region === 'southern' ? 'Southern Utah' : 'Wasatch Front';
  const spec = body.spec || {};
  const plan = body.plan || {};
  const fin = body.financing || {};
  const lines = Array.isArray(plan.lineItems) ? plan.lineItems : [];
  const sched = Array.isArray(plan.schedule) ? plan.schedule : [];
  const draws = Array.isArray(plan.draws) ? plan.draws : [];

  try {
    const pdf = await PDFDocument.create();
    const fBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const fReg = await pdf.embedFont(StandardFonts.Helvetica);
    const W = 612, H = 792, M = 48;

    let page = pdf.addPage([W, H]);
    let y = H - M;
    const newPage = () => { page = pdf.addPage([W, H]); y = H - M; };
    const ensure = (need) => { if (y - need < M) newPage(); };
    const text = (s, x, size, font = fReg, color = INK) => page.drawText(san(s), { x, y, size, font, color });
    const rule = (color = LINE) => { page.drawLine({ start: { x: M, y: y }, end: { x: W - M, y: y }, thickness: 0.7, color }); };
    // right-aligned text helper
    const textR = (s, xRight, size, font = fReg, color = INK) => {
      const t = san(s); const w = font.widthOfTextAtSize(t, size);
      page.drawText(t, { x: xRight - w, y, size, font, color });
    };
    const heading = (s) => { ensure(34); y -= 6; text(s, M, 14, fBold, STEEL); y -= 8; rule(); y -= 14; };

    // ── Title ──
    page.drawRectangle({ x: 0, y: H - 96, width: W, height: 96, color: STEEL });
    page.drawText(san('UTAH PROS RESTORATION  ·  BUILD PLAN'), { x: M, y: H - 44, size: 10, font: fBold, color: rgb(1, 1, 1) });
    page.drawText(san(label), { x: M, y: H - 70, size: 20, font: fBold, color: rgb(1, 1, 1) });
    y = H - 96 - 28;

    // ── Spec summary ──
    const specRows = [
      ['Market', region + (spec.submarket ? ` — ${spec.submarket}` : '')],
      ['Size', `${commas(spec.sqft)} sf · ${spec.stories}-story`],
      ['Bed / Bath', `${spec.bedrooms} bd / ${spec.bathrooms} ba`],
      ['Finish', String(spec.finish || 'mid')],
      ['Hard cost', `${money(plan.hardTotal)}  (${money(plan.costPerSf)}/sf)`],
      ['Build time', `${plan.months || '—'} months`],
    ];
    if (Array.isArray(spec.features) && spec.features.length) specRows.push(['Features', spec.features.join(', ')]);
    heading('Home spec');
    for (const [k, v] of specRows) {
      ensure(16);
      text(k, M, 10, fReg, MUTED);
      text(v, M + 110, 10, fBold);
      y -= 16;
    }
    y -= 6;

    // ── Budget ──
    heading('Itemized build budget (hard cost)');
    ensure(16);
    text('LINE ITEM', M, 8, fBold, MUTED);
    textR('QTY', M + 360, 8, fBold, MUTED);
    textR('UNIT $', M + 450, 8, fBold, MUTED);
    textR('TOTAL', W - M, 8, fBold, MUTED);
    y -= 6; rule(); y -= 12;
    for (const l of lines) {
      ensure(15);
      text(l.label, M, 9.5);
      textR(`${commas(l.qty)} ${l.unit === '$/sf' ? 'sf' : ''}`.trim(), M + 360, 9, fReg, MUTED);
      textR(l.unit === '$/sf' ? money(l.unit_price) + '/sf' : money(l.unit_price), M + 450, 9, fReg, MUTED);
      textR(money(l.total), W - M, 9.5, fBold);
      y -= 15;
    }
    y -= 4; rule(STEEL); y -= 16;
    ensure(16);
    text('Hard cost total', M, 11, fBold);
    textR(money(plan.hardTotal), W - M, 11, fBold, AMBER);
    y -= 22;

    // ── Schedule ──
    heading('Build schedule');
    ensure(16);
    text('PHASE', M, 8, fBold, MUTED);
    textR('START (wk)', M + 360, 8, fBold, MUTED);
    textR('WEEKS', M + 450, 8, fBold, MUTED);
    textR('FINISH (wk)', W - M, 8, fBold, MUTED);
    y -= 6; rule(); y -= 12;
    for (const s of sched) {
      ensure(15);
      const fin2 = (Number(s.startWeek) || 0) + (Number(s.weeks) || 0);
      text(s.name, M, 9.5);
      textR(String(s.startWeek), M + 360, 9, fReg, MUTED);
      textR(String(s.weeks), M + 450, 9, fReg, MUTED);
      textR(String(Math.round(fin2 * 10) / 10), W - M, 9.5);
      y -= 15;
    }
    y -= 6;
    ensure(16);
    const totalWeeks = sched.reduce((mx, p) => Math.max(mx, (Number(p.startWeek) || 0) + (Number(p.weeks) || 0)), 0);
    text(`Total build time: ${Math.round(totalWeeks * 10) / 10} weeks (~${plan.months} months)`, M, 10, fBold);
    y -= 22;

    // ── Draw schedule ──
    heading('Construction-loan draw schedule');
    ensure(16);
    text('MILESTONE', M, 8, fBold, MUTED);
    textR('DRAW', M + 380, 8, fBold, MUTED);
    textR('CUMULATIVE', W - M, 8, fBold, MUTED);
    y -= 6; rule(); y -= 12;
    for (const d of draws) {
      ensure(15);
      text(`${d.draw}. ${d.label}`, M, 9.5);
      textR(`${money(d.amount)} (${d.pct}%)`, M + 380, 9, fReg, MUTED);
      textR(`${money(d.cumulative)} (${d.cumulativePct}%)`, W - M, 9.5);
      y -= 15;
    }
    y -= 22;

    // ── Financing & returns ──
    heading('Financing & returns');
    const finRows = [
      ['Land / lot', money(spec.lot)],
      ['Hard cost', money(plan.hardTotal)],
      [`Soft costs (${spec.softPct}%)`, money(fin.soft)],
      [`Contingency (${spec.contingencyPct}%)`, money(fin.contingency)],
      ['Total project cost', money(fin.total)],
      [`Loan @ ${spec.ltc}% LTC`, money(fin.loan)],
      ['Down payment (equity in)', money(fin.down)],
      ['Interest carry', money(fin.carry)],
      ['Cash needed (down + reserves)', money(fin.cashNeeded)],
      ['Expected sale value (ARV)', money(plan.arv)],
      [`Selling cost (${spec.sellPct}%)`, money(fin.sellCost)],
      ['Projected profit', money(fin.profit)],
      ['Margin on sale', pct(fin.margin)],
      ['Cash-on-cash return', pct(fin.coc)],
    ];
    for (const [k, v] of finRows) {
      ensure(16);
      const strong = /Total project|profit|Margin|Cash-on-cash/.test(k);
      text(k, M, strong ? 10.5 : 9.5, strong ? fBold : fReg, strong ? INK : MUTED);
      textR(v, W - M, strong ? 10.5 : 9.5, fBold, /profit|Margin|Cash-on-cash/.test(k) ? (Number(fin.profit) >= 0 ? rgb(0.17, 0.48, 0.36) : rgb(0.69, 0.29, 0.19)) : INK);
      y -= 16;
    }

    // footer on every page
    const pages = pdf.getPages();
    pages.forEach((p, i) => {
      p.drawText(san(`UPR Build Plan — for internal review · estimates, validate against local subs & comps · page ${i + 1} of ${pages.length}`),
        { x: M, y: 28, size: 7.5, font: fReg, color: MUTED });
    });

    const bytes = await pdf.save();
    const safe = san(label).replace(/[^\w.-]+/g, '_').slice(0, 60) || 'build-plan';
    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders(request, env),
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${safe}.pdf"`,
      },
    });
  } catch (e) {
    return jsonResponse({ error: e.message || 'PDF generation failed' }, 500, request, env);
  }
}
