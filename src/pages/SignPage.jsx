/**
 * ════════════════════════════════════════════════
 * FILE: SignPage.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The page a customer uses to sign a document (work authorization,
 *   completion certificate, agreement). They open a private link we text or
 *   email them, read the document, type or draw their signature, and submit.
 *   A staff member can also open this same page in the app to collect a
 *   signature in person on their own phone.
 *
 * WHERE IT LIVES:
 *   Route:        /sign/:token and /s/:code (public, no login)
 *   Rendered by:  src/App.jsx (bare on web; PublicNativeShell in the iOS app)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/components/ReconAgreementContent, @/lib/backNav,
 *              @/lib/signSubmit (submitEsign, submitErrorText),
 *              functions/lib/short-link.js (resolveSignToken)
 *   Data:      reads  → sign_requests (get_sign_request_by_token RPC),
 *                       document_templates (get_sign_document_templates RPC)
 *              writes → none directly (submit posts to /api/submit-esign,
 *                       which owns the write)
 *
 * NOTES / GOTCHAS:
 *   - Nothing is saved before the final Submit — closing or leaving the page
 *     abandons the attempt safely; the sign request simply stays pending.
 *   - In-app escape hatch (field-polish 2026-07-29): when the router has
 *     in-app history behind this screen (tech "Collect signature on-site"),
 *     every state renders a way back; a customer's cold link open shows the
 *     unchanged public page. See InAppBackButton below.
 *   - This page deliberately uses its own fixed palette (raw hex) — it renders
 *     for logged-out customers outside the app shells and must not re-tone
 *     with the tech dark theme.
 *   - Being outside both app shells, it has NO toast container. A failed submit
 *     must therefore render inline (SubmitErrorNotice) — a toast call here would
 *     be swallowed and the customer would land back on an unchanged form.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReconAgreementContent from '@/components/ReconAgreementContent';
import {
  AlertTriangleIcon, CheckCircleIcon, CheckIcon, LockIcon,
  SignatureIcon, TypeIcon,
} from '@/components/ActionIcons';
import { resolveSignToken } from '../../functions/lib/short-link.js';
import { canGoBack } from '@/lib/backNav';
import { collapseAddressGroups, formatPropertyAddress } from '@/lib/propertyAddress';
import { parseBoldRuns, stripBoldMarkers } from '@/lib/signMarkdown';
import { submitEsign, submitErrorText } from '@/lib/signSubmit';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function rpc(fn, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`RPC ${fn} failed: ${await res.text()}`);
  return res.json();
}

/* ── Load cursive font for typed signatures ── */
function loadSignatureFont() {
  if (document.getElementById('sig-font')) return;
  const link = document.createElement('link');
  link.id   = 'sig-font';
  link.rel  = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&display=swap';
  document.head.appendChild(link);
}

/* ── Render typed name onto canvas in cursive ── */
function renderTypedSig(canvas, name) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  // Use CSS (logical) dimensions — context is already DPR-scaled by initCanvas
  const w = canvas.clientWidth || 500;
  const h = canvas.clientHeight || 140;
  ctx.clearRect(0, 0, w, h);
  if (!name?.trim()) return;
  ctx.font = '48px "Dancing Script", cursive';
  ctx.fillStyle = '#1e293b';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const measured = ctx.measureText(name);
  const maxW = w - 40;
  if (measured.width > maxW) {
    const scale = maxW / measured.width;
    ctx.font = `${Math.floor(48 * scale)}px "Dancing Script", cursive`;
  }
  ctx.fillText(name, w / 2, h / 2);
}

/* ── Scale canvas buffer to device pixel ratio for crisp retina rendering ── */
function initCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 500;
  const cssH = canvas.clientHeight || 140;
  // Setting canvas.width always clears the buffer, even if value is unchanged
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale all drawing ops to DPR
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth   = 2.5;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  return ctx;
}

/* ── Detect if device is primarily pointer/mouse (desktop) ── */
function isDesktop() {
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/* ── In-app escape hatch (field-polish 2026-07-29 — trapped-screens batch) ──
   Rendered ONLY when the router has in-app history behind this screen — i.e. a
   staff member navigated here inside the app ("Collect signature on-site" in
   EsignRequestSheet). A customer opening the emailed/texted link in their own
   browser has no in-app history, so the public page is unchanged. Leaving
   abandons the attempt safely: nothing is written before the final atomic
   submit — the sign request simply stays pending and can be reopened/re-sent. */
function InAppBackButton({ onBack, disabled, color }) {
  return (
    <button
      onClick={onBack}
      disabled={disabled}
      aria-label="Back"
      style={{
        // 44px min height — documented-secondary nav control per tech-mobile-ux.md
        display: 'inline-flex', alignItems: 'center', gap: 4,
        minHeight: 44, padding: '8px 12px 8px 6px', marginLeft: -6,
        background: 'none', border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        fontFamily: 'inherit', fontSize: 15, fontWeight: 600, color,
        touchAction: 'manipulation',
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      Back
    </button>
  );
}

/* ── Markdown renderer ── */
function renderMarkdown(text) {
  if (!text) return null;
  return text.split('\n').map((line, i) => {
    if (line.startsWith('## ')) {
      return <div key={i} style={{ fontWeight: 700, fontSize: 12, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: i === 0 ? 0 : 14, marginBottom: 3 }}>{stripBoldMarkers(line.slice(3))}</div>;
    }
    if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
    const rendered = parseBoldRuns(line).map((p, j) => (p.bold ? <strong key={j}>{p.text}</strong> : p.text));
    return <div key={i} style={{ fontSize: 14, color: '#334155', lineHeight: 1.65 }}>{rendered}</div>;
  });
}

function substituteVars(text, job) {
  if (!text) return '';
  const co = 'Utah Pros Restoration';
  const hasInsurance = !!(job.insurance_company);
  const insuranceSection = hasInsurance
    ? `## INSURANCE & DIRECTION TO PAY\nI authorize ${co} as the designated payee for all insurance proceeds related to the restoration of this Property. I authorize and direct ${job.insurance_company}${job.claim_number ? ` (Claim No. ${job.claim_number})` : ''} to issue payment jointly or directly to ${co}. I agree to promptly endorse and forward any insurance checks that include the Company's name. I remain responsible for my deductible and any amounts not covered by my carrier.`
    : `## PRIVATE PAY & CONDITIONAL ASSIGNMENT OF BENEFITS\nAt the time of signing, no insurance claim has been filed for the loss that is the subject of this Agreement. I agree to pay ${co} directly for all services rendered. All invoices are payable within 30 days of issuance.\n\n**SUBSEQUENT INSURANCE CLAIM:** If I file, or cause to be filed, an insurance claim related to the damage or loss described herein at any time — before, during, or after completion of the work — I hereby irrevocably pre-assign to ${co} all insurance proceeds attributable to the restoration, mitigation, and repair services performed under this Agreement. This pre-assignment is effective retroactively from the date of this Agreement. I agree to: (a) notify ${co} in writing within three (3) business days of filing any such claim; (b) execute a Direction to Pay and/or Assignment of Benefits in favor of ${co} immediately upon request; and (c) direct my insurance carrier to issue all applicable payments jointly or directly to ${co}. My obligation to pay ${co} in full for all authorized services is not contingent upon the filing, approval, or payment of any insurance claim.`;
  const m = {
    '{{insurance_section}}':  insuranceSection,
    '{{property_address}}':   formatPropertyAddress(job),
    '{{client_name}}':       job.insured_name      || '',
    '{{job_number}}':        job.job_number        || '',
    '{{address}}':           job.address           || '',
    '{{city}}':              job.city              || '',
    // 'UT' matches submit-esign.js's default. The PDF is the legal artifact, so
    // the screen is aligned TO it rather than the other way round — a blank on
    // screen and "UT" in the signed document is the same class of divergence as
    // the {{date}} defect this pair already carried.
    '{{state}}':             job.state             || 'UT',
    '{{zip}}':               job.zip               || '',
    '{{date_of_loss}}':      job.date_of_loss
      ? new Date(job.date_of_loss + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : '',
    '{{insurance_company}}': job.insurance_company || '',
    '{{claim_number}}':      job.claim_number      || '',
    '{{policy_number}}':     job.policy_number     || '',
    '{{adjuster_name}}':     job.adjuster_name     || job.adjuster || '',
    '{{company_name}}':      co,
    '{{date}}':              new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  };
  // The group rewrite must run BEFORE the individual tokens — once {{city}} has
  // been replaced with '' there is no group left to recognise.
  return Object.entries(m).reduce((t, [k, v]) => t.replaceAll(k, v), collapseAddressGroups(text, job));
}

function buildSectionsFromTemplates(templates, divisions, doc_type, job) {
  if (!templates || templates.length === 0) return buildSectionText(divisions, doc_type);
  const ORDER = ['water', 'mold', 'reconstruction', 'remodeling', 'fire', 'contents'];
  if (doc_type === 'coc') {
    const divArr = Array.isArray(divisions) ? divisions : (divisions ? [divisions] : []);
    const sorted = [...divArr].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    return sorted.map(div => {
      const tpl = templates.find(t => t.division === div);
      if (!tpl) return null;
      return { heading: substituteVars(tpl.heading, job), body: substituteVars(tpl.body, job) };
    }).filter(Boolean);
  }
  return [...templates]
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map(tpl => ({ heading: substituteVars(tpl.heading, job), body: substituteVars(tpl.body, job) }));
}

/* Custom Authorization sections, built from the per-request snapshot.
   One section: the author's title, then the body. renderMarkdown turns any
   "## " lines inside the body into their own headings, which is the same
   structure functions/api/submit-esign.js produces via parseMarkdownSections —
   so the screen and the signed PDF read identically.
   Returns [] when there is no text; the caller has already routed that to the
   error screen rather than letting it reach a signable form. */
function buildCustomSections(customText, job) {
  if (!customText?.body) return [];
  return [{
    heading: customText.heading ? substituteVars(customText.heading, job) : null,
    body:    substituteVars(customText.body, job),
  }];
}

// Keep in lockstep with the copies in templateData.jsx, JobPage.jsx,
// TechJobDocuments.jsx, send-esign.js, resend-esign.js and submit-esign.js —
// pinned by tests/qa/unit/esign-doc-type-label-parity.test.js.
const DOC_LABELS = {
  coc:                     'Certificate of Completion',
  work_auth:               'Work Authorization',
  direction_pay:           'Direction of Pay',
  change_order:            'Change Order',
  recon_agreement:         'Reconstruction Agreement',
  cat3_removal:            'Emergency Removal Authorization',
  emergency_demo:          'Emergency Demolition Authorization',
  coverage_unconfirmed:    'Coverage Not Confirmed Acknowledgment',
  service_declined:        'Declination of Recommended Services',
  equipment_early_removal: 'Early Equipment Removal',
  access_release:          'Property Access Authorization',
  other:                   'Custom Authorization',
};

/* Declared above the component (they were below it until 2026-07-29, which the
   no-use-before-define ratchet flags now that this file is under the frozen
   shrink-only lint baseline). Values unchanged — a pure move. */
const styles = {
  page:          { minHeight: '100vh', background: '#f1f5f9', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  header:        { background: '#1e293b', padding: '20px 24px' },
  headerInner:   { maxWidth: 640, margin: '0 auto' },
  company:       { margin: 0, fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: '-0.2px' },
  companySub:    { margin: '2px 0 0', fontSize: 12, color: '#94a3b8' },
  content:       { maxWidth: 640, margin: '0 auto', padding: '28px 20px 60px' },
  titleBlock:    { textAlign: 'center', marginBottom: 24 },
  docTitle:      { margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: '#0f172a' },
  titleLine:     { width: 80, height: 3, background: '#2563eb', borderRadius: 2, margin: '0 auto' },
  infoGrid:      { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px', marginBottom: 4 },
  section:       { marginBottom: 16 },
  sectionHeading:{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.05em' },
  sectionBody:   { margin: 0 },
  authText:      { margin: 0, fontSize: 13, color: '#64748b', lineHeight: 1.65 },
  fieldGroup:    { marginBottom: 20 },
  fieldLabel:    { display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 },
  input:         { width: '100%', padding: '12px 14px', fontSize: 15, borderRadius: 8, border: '1.5px solid #cbd5e1', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', background: '#fff', color: '#0f172a' },
  canvasWrap:    { position: 'relative', background: '#fff', border: '1.5px solid #cbd5e1', borderRadius: 8, overflow: 'hidden' },
  canvas:        { display: 'block', width: '100%', height: 140, touchAction: 'none', cursor: 'crosshair' },
  canvasHint:    { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', margin: 0, fontSize: 13, color: '#94a3b8', pointerEvents: 'none', whiteSpace: 'nowrap' },
  clearBtn:      { fontSize: 12, fontWeight: 600, color: '#64748b', background: 'none', border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' },
  checkLabel:    { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 20, cursor: 'pointer' },
  errorMsg:      { color: '#ef4444', fontSize: 13, marginBottom: 16, fontWeight: 500 },
  submitError:   { display: 'flex', gap: 10, alignItems: 'flex-start', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 14px', marginBottom: 16 },
  submitErrorTitle: { margin: '0 0 3px', fontSize: 13, fontWeight: 700, color: '#b91c1c' },
  submitErrorBody:  { margin: 0, fontSize: 13, color: '#7f1d1d', lineHeight: 1.5 },
  submitBtn:     { width: '100%', padding: '14px', background: '#2563eb', color: '#fff', fontSize: 16, fontWeight: 700, border: 'none', borderRadius: 10, fontFamily: 'inherit', letterSpacing: '0.1px' },
  footer:        { marginTop: 20, textAlign: 'center', fontSize: 12, color: '#94a3b8' },
  heading:       { margin: '0 0 12px', fontSize: 20, fontWeight: 700, color: '#0f172a' },
  sub:           { margin: '0 0 8px', fontSize: 14, color: '#475569', lineHeight: 1.6 },
  contact:       { margin: '16px 0 0', fontSize: 13, color: '#64748b' },
  link:          { color: '#2563eb', textDecoration: 'none' },
};

export default function SignPage() {
  // Two routes land here: /sign/:token (the original, still live for every link
  // already sent) and /s/:code (the short form). Both resolve to the same UUID —
  // the short code is a denser spelling of it, not a different secret.
  const { token: routeToken, code } = useParams();
  const token = resolveSignToken(routeToken || code);
  const navigate = useNavigate();
  // In-app entry (tech collect-on-site) vs a customer's cold link open.
  const inApp = canGoBack();
  const exitToApp = () => navigate(-1);

  const [data,       setData]       = useState(null);
  const [templates,  setTemplates]  = useState([]);
  // Custom Authorization only — { heading, body } snapshotted on the request.
  const [customText, setCustomText] = useState(null);
  const [status,     setStatus]     = useState('loading');
  const [errorMsg,   setErrorMsg]   = useState('');
  const [signerName, setSignerName] = useState('');
  const [nameError,  setNameError]  = useState('');
  // Separate from errorMsg (which belongs to the load-failure 'error' screen):
  // this one renders inline in the 'ready' state next to the Submit button.
  const [submitError, setSubmitError] = useState('');
  const [hasSig,     setHasSig]     = useState(false);
  const [agreed,     setAgreed]     = useState(false);
  // Four separately-attested consents for recon_agreement doc_type.
  // Unused for other doc types — classic `agreed` single-checkbox flow still applies.
  const [consents,   setConsents]   = useState({ terms: false, commitment: false, esign: false, authority: false });
  const onConsentChange = (key, value) => {
    setConsents(prev => ({ ...prev, [key]: value }));
    setNameError('');
  };

  // ── Signature mode: 'type' | 'draw' ──
  const [sigMode,    setSigMode]    = useState(() => isDesktop() ? 'type' : 'draw');
  const [typedSig,   setTypedSig]   = useState('');
  const [fontLoaded, setFontLoaded] = useState(false);

  const canvasRef   = useRef(null);
  const isDrawing   = useRef(false);
  const lastPos     = useRef({ x: 0, y: 0 });

  // Load cursive font once
  useEffect(() => {
    loadSignatureFont();
    if (document.fonts) {
      document.fonts.load('600 48px "Dancing Script"').then(() => setFontLoaded(true));
    } else {
      setTimeout(() => setFontLoaded(true), 1000);
    }
  }, []);

  // Re-render typed sig when font loads or name changes
  useEffect(() => {
    if (sigMode === 'type' && fontLoaded) {
      renderTypedSig(canvasRef.current, typedSig);
      setHasSig(!!typedSig.trim());
    }
  }, [typedSig, sigMode, fontLoaded]);

  // When switching modes: re-init canvas (restores DPR scale + clears) then re-render typed sig if needed
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    initCanvas(canvas); // setting canvas.width always clears the buffer
    setHasSig(false);
    if (sigMode === 'type' && typedSig.trim() && fontLoaded) {
      renderTypedSig(canvas, typedSig);
      setHasSig(true);
    }
    // Intentionally re-inits ONLY on a mode switch — adding typedSig/fontLoaded
    // would clear and redraw the canvas on every keystroke (the [typedSig,
    // sigMode, fontLoaded] effect above owns keystroke re-renders).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigMode]);

  useEffect(() => {
    if (!token) { setStatus('error'); setErrorMsg('Invalid link.'); return; }
    rpc('get_sign_request_by_token', { p_token: token })
      .then(d => {
        if (!d) { setStatus('error'); setErrorMsg('This link was not found.'); return; }
        if (d.status === 'signed')  { setStatus('signed');  setData(d); return; }
        if (d.status !== 'pending') { setStatus('expired'); return; }
        if (new Date(d.expires_at) < new Date()) { setStatus('expired'); return; }
        setSignerName(d.signer_name || '');
        setTypedSig(d.signer_name || '');

        if (d.doc_type === 'other') {
          // A Custom Authorization's wording lives on the request itself, not in
          // document_templates, so it is fetched BEFORE the form is shown. If it
          // is missing there is nothing to sign: with no sections the renderer
          // falls through to buildSectionText()'s Certificate-of-Completion
          // boilerplate — "the work is 100% complete and I have no outstanding
          // complaints" — on a document the client opened to authorize
          // emergency work. Show an error instead of a signable form.
          rpc('get_sign_request_custom_text', { p_token: token })
            .then(rows => {
              const body = String(rows?.[0]?.custom_body || '').trim();
              if (!body) {
                setStatus('error');
                setErrorMsg('This document is missing its text and cannot be signed. Please contact us for a new link.');
                return;
              }
              setCustomText({ heading: String(rows?.[0]?.custom_heading || '').trim(), body });
              setData(d);
              setStatus('ready');
            })
            .catch(() => {
              setStatus('error');
              setErrorMsg('This document could not be loaded. Please contact us for a new link.');
            });
          return;
        }

        // Token-gated template read (DB-Foundation Phase P3 anon closure): the RPC
        // resolves this request's doc_type from the signing token server-side and
        // returns only that document type's sections — replacing the former direct
        // anon read of the whole document_templates table.
        //
        // Awaited before 'ready' for every type EXCEPT coc, for two reasons.
        //
        // 1. NO TEMPLATE MUST NEVER MEAN "SHOW THE COC BOILERPLATE".
        //    buildSectionsFromTemplates falls through to buildSectionText, which
        //    for any non-coc type returns "All work described in the work
        //    authorization has been satisfactorily completed." A doc type whose
        //    document_templates row is missing — a new type whose seed migration
        //    has not been applied yet — would otherwise show a client a COMPLETION
        //    CERTIFICATE on a document they opened to authorize emergency
        //    demolition, and submit-esign would bake the same text into the signed
        //    PDF. Refuse instead.
        //
        // 2. Even when the row exists, the old fire-and-forget fetch rendered that
        //    same fallback for one frame before the templates arrived.
        //
        // coc is the one legitimate exception: buildSectionText genuinely builds
        // its sections from the request's divisions, so it needs no row.
        if (d.doc_type === 'coc') {
          setData(d);
          setStatus('ready');
          rpc('get_sign_document_templates', { p_token: token })
            .then(rows => { if (Array.isArray(rows) && rows.length > 0) setTemplates(rows); })
            .catch(() => {});
          return;
        }

        rpc('get_sign_document_templates', { p_token: token })
          .then(rows => {
            if (!Array.isArray(rows) || rows.length === 0) {
              setStatus('error');
              setErrorMsg('This document is not available to sign yet. Please contact us for a new link.');
              return;
            }
            setTemplates(rows);
            setData(d);
            setStatus('ready');
          })
          .catch(() => {
            setStatus('error');
            setErrorMsg('This document could not be loaded. Please contact us for a new link.');
          });
      })
      .catch(e => { setStatus('error'); setErrorMsg(e.message); });
  }, [token]);

  // Scale canvas to DPR when ready, then re-render typed sig if already populated
  useEffect(() => {
    if (status !== 'ready') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    initCanvas(canvas);
    // initCanvas clears the buffer — re-render typed sig if font is loaded
    if (sigMode === 'type' && typedSig.trim() && fontLoaded) {
      renderTypedSig(canvas, typedSig);
      setHasSig(true);
    }
    // Intentionally fires ONLY on the loading→ready transition (first canvas
    // mount) — sigMode/typedSig/fontLoaded changes are owned by their own
    // effects; re-running this on them would double-clear the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    // Return CSS pixel coordinates — the DPR transform in initCanvas handles the rest
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  };

  const startDraw = useCallback((e) => {
    if (sigMode !== 'draw') return;
    e.preventDefault();
    const canvas = canvasRef.current; if (!canvas) return;
    isDrawing.current = true; lastPos.current = getPos(e, canvas);
  }, [sigMode]);

  const draw = useCallback((e) => {
    if (sigMode !== 'draw') return;
    e.preventDefault();
    if (!isDrawing.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y); ctx.stroke();
    lastPos.current = pos; setHasSig(true);
  }, [sigMode]);

  const endDraw = useCallback((e) => {
    if (sigMode !== 'draw') return;
    e.preventDefault(); isDrawing.current = false;
  }, [sigMode]);

  const clearSig = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    initCanvas(canvas); // re-scales + clears in one shot
    setHasSig(false);
    if (sigMode === 'type') setTypedSig('');
  };

  const handleSubmit = async () => {
    const isRecon = data?.doc_type === 'recon_agreement';
    setSubmitError(''); // a fresh attempt clears the previous failure
    if (!signerName.trim()) { setNameError('Please enter your full name.'); return; }
    if (!hasSig)             { setNameError(sigMode === 'type' ? 'Please type your name in the signature box.' : 'Please provide your signature.'); return; }
    if (isRecon) {
      if (!consents.terms || !consents.commitment || !consents.esign || !consents.authority) {
        setNameError('Please check all acknowledgments above.');
        return;
      }
    } else {
      if (!agreed) { setNameError('Please confirm the checkbox above.'); return; }
    }
    setNameError(''); setStatus('submitting');
    try {
      const canvas = canvasRef.current;
      const sigPng = canvas.toDataURL('image/png');
      const body = {
        token,
        signer_name: signerName.trim(),
        signature_png: sigPng,
        divisions: data?.divisions || (data?.job?.division ? [data.job.division] : []),
      };
      if (isRecon) {
        body.consent_terms       = consents.terms;
        body.consent_commitment  = consents.commitment;
        body.consent_esign       = consents.esign;
        body.consent_authority   = consents.authority;
      }
      await submitEsign(body);
      setStatus('done');
    } catch (err) { setSubmitError(submitErrorText(err)); setStatus('ready'); }
  };

  const inAppBackBar = inApp ? (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', padding: '12px 20px 0', boxSizing: 'border-box' }}>
      <InAppBackButton onBack={exitToApp} color="#64748b" />
    </div>
  ) : null;

  if (status === 'loading') return <Screen>{inAppBackBar}<Spinner /></Screen>;
  if (status === 'error')   return <Screen>{inAppBackBar}<Card><StatusIcon color="#ef4444"><AlertTriangleIcon size={44} strokeWidth={1.5} /></StatusIcon><h2 style={styles.heading}>Link Not Found</h2><p style={styles.sub}>{errorMsg || 'This signing link is invalid.'}</p><p style={styles.contact}>Questions? Contact us at <a href="mailto:restoration@utah-pros.com" style={styles.link}>restoration@utah-pros.com</a></p></Card></Screen>;
  if (status === 'expired') return <Screen>{inAppBackBar}<Card><StatusIcon color="#64748b"><LockIcon size={44} strokeWidth={1.5} /></StatusIcon><h2 style={styles.heading}>Link Expired</h2><p style={styles.sub}>This signing link is no longer active. Please contact Utah Pros Restoration to receive a new one.</p><p style={styles.contact}><a href="mailto:restoration@utah-pros.com" style={styles.link}>restoration@utah-pros.com</a></p></Card></Screen>;
  if (status === 'signed')  return <Screen>{inAppBackBar}<Card><StatusIcon color="#059669"><CheckCircleIcon size={44} strokeWidth={1.5} /></StatusIcon><h2 style={styles.heading}>Already Signed</h2><p style={styles.sub}>This document was signed on{' '}{data?.signed_at ? new Date(data.signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'a previous date'}.</p><p style={styles.contact}>Questions? <a href="mailto:restoration@utah-pros.com" style={styles.link}>restoration@utah-pros.com</a></p></Card></Screen>;

  if (status === 'done') return (
    <Screen>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', background: '#f1f5f9' }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: '48px 36px', maxWidth: 460, width: '100%', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          {/* The disc already carries the emphasis, so this is the bare tick —
              a ringed check inside a circle reads as two competing circles. */}
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', color: '#059669' }}>
            <CheckIcon size={34} strokeWidth={2.5} />
          </div>
          <h1 style={{ margin: '0 0 12px', fontSize: 24, fontWeight: 800, color: '#0f172a' }}>You're all set!</h1>
          <p style={{ margin: '0 0 8px', fontSize: 16, color: '#334155', lineHeight: 1.6 }}>Your <strong>{DOC_LABELS[data?.doc_type] || 'document'}</strong> has been signed and saved successfully.</p>
          <p style={{ margin: '0 0 28px', fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>Thank you, <strong>{signerName}</strong>. Utah Pros Restoration has been notified. {inApp ? 'Tap Done to return to the app.' : 'You may close this window.'}</p>
          <div style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 18px', border: '1px solid #e2e8f0' }}>
            <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Signed on</p>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          </div>
          {/* In-app collect flow only: hand the phone back and return to the job's
              documents. 48px primary action per tech-mobile-ux.md. */}
          {inApp && (
            <button
              onClick={exitToApp}
              style={{ marginTop: 20, width: '100%', minHeight: 48, padding: '13px', background: '#2563eb', color: '#fff', fontSize: 16, fontWeight: 700, border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', touchAction: 'manipulation' }}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </Screen>
  );

  const job      = data?.job || {};
  const address  = [job.address, job.city, job.state].filter(Boolean).join(', ');
  const docLabel = DOC_LABELS[data?.doc_type] || 'Document';
  // For a Custom Authorization the snapshot wins UNCONDITIONALLY and is never
  // merged with document_templates. If anyone ever inserted a row with
  // doc_type='other' via upsert_document_template it would otherwise apply to
  // every custom document ever sent. Mirrors submit-esign.js so the client reads
  // exactly what the PDF will say.
  const sectionText = data?.doc_type === 'other'
    ? buildCustomSections(customText, job)
    : buildSectionsFromTemplates(templates, data?.divisions || (job.division ? [job.division] : []), data?.doc_type, job);
  const isRecon  = data?.doc_type === 'recon_agreement';
  // Amber accent for recon_agreement, blue for everything else
  const accentColor = isRecon ? '#f59e0b' : '#2563eb';

  return (
    <Screen>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .sig-mode-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border: 1.5px solid #cbd5e1; background: #fff; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 500; color: #64748b; transition: all 0.12s; }
        .sig-mode-btn:first-child { border-radius: 8px 0 0 8px; border-right: none; }
        .sig-mode-btn:last-child  { border-radius: 0 8px 8px 0; }
        .sig-mode-btn.active { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 700; z-index: 1; }
      `}</style>

      <div style={styles.page}>
        <div style={styles.header}>
          <div style={styles.headerInner}>
            {inApp && (
              <InAppBackButton onBack={exitToApp} disabled={status === 'submitting'} color="#cbd5e1" />
            )}
            <p style={styles.company}>Utah Pros Restoration</p>
            <p style={styles.companySub}>Licensed · Insured · Utah</p>
          </div>
        </div>

        <div style={styles.content}>
          {isRecon ? (
            <ReconAgreementContent
              job={job}
              templates={templates}
              consents={consents}
              onConsentChange={onConsentChange}
              submitting={status === 'submitting'}
            />
          ) : (
            <>
              <div style={styles.titleBlock}>
                <h1 style={styles.docTitle}>{docLabel}</h1>
                <div style={styles.titleLine} />
              </div>

              <div style={styles.infoGrid}>
                <InfoRow label="Client"   value={job.insured_name} />
                <InfoRow label="Property" value={address} />
                <InfoRow label="Job #"    value={job.job_number} />
                {job.insurance_company && <InfoRow label="Insurance"    value={job.insurance_company} />}
                {job.claim_number      && <InfoRow label="Claim #"      value={job.claim_number} />}
                {job.date_of_loss      && <InfoRow label="Date of Loss" value={new Date(job.date_of_loss + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} />}
              </div>

              <Divider />

              {sectionText.map((s, i) => (
                <div key={i} style={styles.section}>
                  {s.heading && <p style={styles.sectionHeading}>{stripBoldMarkers(s.heading)}</p>}
                  <div style={styles.sectionBody}>{renderMarkdown(s.body)}</div>
                </div>
              ))}

              <Divider />

              <p style={styles.authText}>
                By signing below, I confirm that I am authorized to sign on behalf of the property owner and all responsible parties,
                and that the information above is accurate to the best of my knowledge. I authorize Utah Pros Restoration to receive
                payment directly for all work performed under this agreement.
              </p>

              <Divider />
            </>
          )}

          {/* Full name */}
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>FULL NAME <span style={{ color: '#ef4444' }}>*</span></label>
            <input style={styles.input} type="text" value={signerName}
              onChange={e => { setSignerName(e.target.value); setNameError(''); }}
              placeholder="Type your full legal name" autoComplete="name"
              disabled={status === 'submitting'} />
          </div>

          {/* Signature box */}
          <div style={styles.fieldGroup}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <label style={styles.fieldLabel}>SIGNATURE <span style={{ color: '#ef4444' }}>*</span></label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ display: 'flex' }}>
                  {/* Both icons draw with currentColor, so .sig-mode-btn.active
                      flipping the text to white takes the glyph with it. */}
                  <button className={`sig-mode-btn${sigMode === 'type' ? ' active' : ''}`}
                    onClick={() => setSigMode('type')} disabled={status === 'submitting'}>
                    <TypeIcon size={14} /> Type
                  </button>
                  <button className={`sig-mode-btn${sigMode === 'draw' ? ' active' : ''}`}
                    onClick={() => setSigMode('draw')} disabled={status === 'submitting'}>
                    <SignatureIcon size={14} /> Draw
                  </button>
                </div>
                {hasSig && (
                  <button style={styles.clearBtn} onClick={clearSig} disabled={status === 'submitting'}>Clear</button>
                )}
              </div>
            </div>

            {sigMode === 'type' && (
              <div style={{ marginBottom: 10 }}>
                <input
                  style={{
                    ...styles.input,
                    fontFamily: '"Dancing Script", cursive',
                    fontSize: 28,
                    letterSpacing: '0.5px',
                    color: '#1e293b',
                    paddingTop: 10,
                    paddingBottom: 10,
                  }}
                  type="text"
                  value={typedSig}
                  onChange={e => { setTypedSig(e.target.value); setNameError(''); }}
                  placeholder="Type your name to sign"
                  disabled={status === 'submitting'}
                  autoComplete="off"
                />
                <p style={{ margin: '5px 0 0', fontSize: 11, color: '#94a3b8' }}>
                  Your typed name will appear as a signature above.
                </p>
              </div>
            )}

            <div style={{
              ...styles.canvasWrap,
              background: sigMode === 'type' ? '#fafbfc' : '#fff',
              borderStyle: sigMode === 'type' ? 'dashed' : 'solid',
            }}>
              <canvas ref={canvasRef} width={500} height={140} style={{
                ...styles.canvas,
                cursor: sigMode === 'draw' ? 'crosshair' : 'default',
                touchAction: sigMode === 'draw' ? 'none' : 'auto',
              }}
                onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
              />
              {!hasSig && (
                <p style={styles.canvasHint}>
                  {sigMode === 'type' ? 'Signature preview will appear here' : 'Sign here with your finger or mouse'}
                </p>
              )}
              {sigMode === 'type' && hasSig && (
                <p style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', margin: 0, fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                  Signature preview
                </p>
              )}
            </div>
          </div>

          {/* Agreement checkbox (skipped for recon — attested via 4 consents above) */}
          {!isRecon && (
            <label style={styles.checkLabel}>
              <input type="checkbox" checked={agreed} onChange={e => { setAgreed(e.target.checked); setNameError(''); }}
                disabled={status === 'submitting'} style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
                I have read and agree to the terms stated above, and confirm this electronic signature is legally binding.
              </span>
            </label>
          )}

          {/* role="alert" so the validation failure is announced, not only shown —
              the emoji this replaced was the only thing a screen reader read here,
              and it read "warning sign", never the reason. Matches the notice below. */}
          {nameError && (
            <p role="alert" style={{ ...styles.errorMsg, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <AlertTriangleIcon size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{nameError}</span>
            </p>
          )}

          {submitError && <SubmitErrorNotice message={submitError} />}

          <button
            style={{ ...styles.submitBtn, background: accentColor, opacity: status === 'submitting' ? 0.7 : 1, cursor: status === 'submitting' ? 'not-allowed' : 'pointer' }}
            onClick={handleSubmit} disabled={status === 'submitting'}
          >
            {status === 'submitting' ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                <span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTop: '2px solid white', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
                Generating signed document…
              </span>
            ) : 'Submit Signature'}
          </button>

          <p style={styles.footer}>
            Secure electronic signature · Utah Pros Restoration · <a href="mailto:restoration@utah-pros.com" style={styles.link}>restoration@utah-pros.com</a>
          </p>
        </div>
      </div>
    </Screen>
  );
}

/* ── Inline submit-failure notice ──
   The only channel this page has for a failed POST: it is public, no-auth, and
   outside both app shells, so there is no toast container to raise (Rule 2's
   toast entry point exists only inside Layout/TechLayout). Rendered next to the
   Submit button so it is already in view where the customer just tapped, and
   role="alert" so a screen reader is told too. Deliberately does not claim
   anything about what the server saved — see loading-error-states.md §1. */
export function SubmitErrorNotice({ message }) {
  return (
    <div role="alert" style={styles.submitError}>
      <AlertTriangleIcon size={16} style={{ flexShrink: 0, marginTop: 1, color: '#b91c1c' }} />
      <div>
        <p style={styles.submitErrorTitle}>We couldn&apos;t submit your signature</p>
        <p style={styles.submitErrorBody}>
          {message} Please try again. If it keeps happening, contact us at{' '}
          <a href="mailto:restoration@utah-pros.com" style={styles.link}>restoration@utah-pros.com</a>.
        </p>
      </div>
    </div>
  );
}

function Screen({ children }) { return <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', flexDirection: 'column' }}>{children}</div>; }
function Card({ children }) { return <div style={{ maxWidth: 420, margin: '80px auto', padding: '40px 32px', background: '#fff', borderRadius: 16, boxShadow: '0 2px 16px rgba(0,0,0,0.08)', textAlign: 'center' }}>{children}</div>; }
/* `color` is the whole mechanism: the icons inside draw with `currentColor`, so
   setting it here is what makes the same glyph set read red / slate / green. */
function StatusIcon({ children, color }) {
  return <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16, color }}>{children}</div>;
}
function Divider() { return <div style={{ height: 1, background: '#e2e8f0', margin: '20px 0' }} />; }
function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: 14, color: '#0f172a', fontWeight: 500 }}>{value}</span>
    </div>
  );
}
function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <div style={{ width: 36, height: 36, border: '3px solid #e2e8f0', borderTop: '3px solid #2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function buildSectionText(divisions, doc_type) {
  if (doc_type !== 'coc') return [{ heading: 'Work Completed', body: 'All work described in the work authorization has been satisfactorily completed in a professional manner.' }];
  const map = {
    water:          { heading: 'Water Damage Mitigation',  body: 'I confirm that all water mitigation services performed by Utah Pros Restoration at the above property have been completed to my satisfaction. The work was performed in a professional manner and is 100% complete. I have no outstanding complaints or concerns.' },
    mold:           { heading: 'Mold Remediation',         body: 'I confirm that all mold remediation services performed by Utah Pros Restoration have been completed to my satisfaction. The affected areas have been properly contained, treated, and cleared in accordance with IICRC S520 standards. The work is 100% complete and I have no outstanding complaints or concerns.' },
    reconstruction: { heading: 'Repairs & Reconstruction', body: 'I confirm that all repairs and reconstruction performed by Utah Pros Restoration have been completed to my satisfaction. The repaired portions of the property are in equal or better condition than prior to the loss. The work is 100% complete and I have no outstanding complaints or concerns.' },
    remodeling:     { heading: 'Remodeling',               body: 'I confirm that all remodeling and finish work performed by Utah Pros Restoration has been completed to my satisfaction. The work is 100% complete, in equal or better condition than agreed, and I have no outstanding complaints or concerns.' },
    fire:           { heading: 'Fire & Smoke Restoration', body: 'I confirm that all fire and smoke restoration services performed by Utah Pros Restoration have been completed to my satisfaction. The work was performed in a professional manner and is 100% complete. I have no outstanding complaints or concerns.' },
    contents:       { heading: 'Contents Restoration',     body: 'I confirm that Utah Pros Restoration has returned all salvageable contents items in satisfactory condition. I have had the opportunity to inspect the returned items. The work is 100% complete and I have no outstanding complaints or concerns.' },
  };
  const ORDER   = ['water', 'mold', 'reconstruction', 'remodeling', 'fire', 'contents'];
  const divArr  = Array.isArray(divisions) ? divisions : (divisions ? [divisions] : []);
  const sorted  = [...divArr].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const results = sorted.map(d => map[d]).filter(Boolean);
  return results.length ? results : [{ heading: 'Work Completed', body: 'I confirm that all restoration services performed by Utah Pros Restoration have been completed to my satisfaction. The work was performed in a professional manner and is 100% complete. I have no outstanding complaints or concerns.' }];
}
