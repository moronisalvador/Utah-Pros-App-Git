import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';

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

/* ── Markdown renderer — ## Heading, **bold**, blank lines ── */
function renderMarkdown(text) {
  if (!text) return null;
  return text.split('\n').map((line, i) => {
    if (line.startsWith('## ')) {
      return <div key={i} style={{ fontWeight: 700, fontSize: 12, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: i === 0 ? 0 : 14, marginBottom: 3 }}>{line.slice(3)}</div>;
    }
    if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const rendered = parts.map((p, j) => p.startsWith('**') && p.endsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : p);
    return <div key={i} style={{ fontSize: 14, color: '#334155', lineHeight: 1.65 }}>{rendered}</div>;
  });
}

/* ── Variable substitution — {{placeholders}} → real job data ──
   {{insurance_section}} is a smart computed variable:
   - Insurance job  → "INSURANCE & DIRECTION TO PAY" paragraph with carrier/claim data
   - Out-of-pocket  → "PRIVATE PAY & CONDITIONAL ASSIGNMENT" paragraph that still
                      pre-assigns benefits if a claim is filed later               */
function substituteVars(text, job) {
  if (!text) return '';
  const co = 'Utah Pros Restoration';

  const hasInsurance = !!(job.insurance_company);

  const insuranceSection = hasInsurance
    ? `## INSURANCE & DIRECTION TO PAY\nI authorize ${co} as the designated payee for all insurance proceeds related to the restoration of this Property. I authorize and direct ${job.insurance_company}${job.claim_number ? ` (Claim No. ${job.claim_number})` : ''} to issue payment jointly or directly to ${co}. I agree to promptly endorse and forward any insurance checks that include the Company's name. I remain responsible for my deductible and any amounts not covered by my carrier.`
    : `## PRIVATE PAY & CONDITIONAL ASSIGNMENT OF BENEFITS\nAt the time of signing, no insurance claim has been filed for the loss that is the subject of this Agreement. I agree to pay ${co} directly for all services rendered. All invoices are payable within 30 days of issuance.\n\n**SUBSEQUENT INSURANCE CLAIM:** If I file, or cause to be filed, an insurance claim related to the damage or loss described herein at any time — before, during, or after completion of the work — I hereby irrevocably pre-assign to ${co} all insurance proceeds attributable to the restoration, mitigation, and repair services performed under this Agreement. This pre-assignment is effective retroactively from the date of this Agreement. I agree to: (a) notify ${co} in writing within three (3) business days of filing any such claim; (b) execute a Direction to Pay and/or Assignment of Benefits in favor of ${co} immediately upon request; and (c) direct my insurance carrier to issue all applicable payments jointly or directly to ${co}. My obligation to pay ${co} in full for all authorized services is not contingent upon the filing, approval, or payment of any insurance claim.`;

  const m = {
    '{{insurance_section}}': insuranceSection,
    '{{client_name}}':       job.insured_name      || '',
    '{{job_number}}':        job.job_number        || '',
    '{{address}}':           job.address           || '',
    '{{city}}':              job.city              || '',
    '{{state}}':             job.state             || '',
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
  return Object.entries(m).reduce((t, [k, v]) => t.replaceAll(k, v), text);
}

/* ── Build sections from DB templates with variable substitution ──
   Falls back to hardcoded buildSectionText() if no templates exist. */
function buildSectionsFromTemplates(templates, divisions, doc_type, job) {
  if (!templates || templates.length === 0) {
    return buildSectionText(divisions, doc_type);
  }
  const ORDER = ['water', 'mold', 'reconstruction', 'fire', 'contents'];
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

export default function SignPage() {
  const { token } = useParams();

  const [data,       setData]       = useState(null);
  const [templates,  setTemplates]  = useState([]);
  const [status,     setStatus]     = useState('loading');
  const [errorMsg,   setErrorMsg]   = useState('');
  const [signerName, setSignerName] = useState('');
  const [nameError,  setNameError]  = useState('');
  const [hasSig,     setHasSig]     = useState(false);
  const [agreed,     setAgreed]     = useState(false);

  const canvasRef   = useRef(null);
  const isDrawing   = useRef(false);
  const lastPos     = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!token) { setStatus('error'); setErrorMsg('Invalid link.'); return; }
    rpc('get_sign_request_by_token', { p_token: token })
      .then(d => {
        if (!d) { setStatus('error'); setErrorMsg('This link was not found.'); return; }
        if (d.status === 'signed')  { setStatus('signed');  setData(d); return; }
        if (d.status !== 'pending') { setStatus('expired'); return; }
        if (new Date(d.expires_at) < new Date()) { setStatus('expired'); return; }
        setSignerName(d.signer_name || '');
        setData(d);
        setStatus('ready');
        if (d.doc_type) {
          fetch(
            `${SUPABASE_URL}/rest/v1/document_templates?doc_type=eq.${encodeURIComponent(d.doc_type)}&order=sort_order.asc`,
            { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
          )
            .then(r => r.json())
            .then(rows => { if (Array.isArray(rows) && rows.length > 0) setTemplates(rows); })
            .catch(() => {});
        }
      })
      .catch(e => { setStatus('error'); setErrorMsg(e.message); });
  }, [token]);

  useEffect(() => {
    if (status !== 'ready') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  }, [status]);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * (canvas.width / rect.width), y: (src.clientY - rect.top) * (canvas.height / rect.height) };
  };

  const startDraw = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current; if (!canvas) return;
    isDrawing.current = true; lastPos.current = getPos(e, canvas);
  }, []);

  const draw = useCallback((e) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y); ctx.stroke();
    lastPos.current = pos; setHasSig(true);
  }, []);

  const endDraw = useCallback((e) => { e.preventDefault(); isDrawing.current = false; }, []);

  const clearSig = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); setHasSig(false);
  };

  const handleSubmit = async () => {
    if (!signerName.trim()) { setNameError('Please enter your full name.'); return; }
    if (!hasSig)             { setNameError('Please provide your signature.'); return; }
    if (!agreed)             { setNameError('Please confirm the checkbox above.'); return; }
    setNameError(''); setStatus('submitting');
    try {
      const canvas = canvasRef.current;
      const sigPng = canvas.toDataURL('image/png');
      const res = await fetch('/api/submit-esign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, signer_name: signerName.trim(), signature_png: sigPng, divisions: data?.divisions || (data?.job?.division ? [data.job.division] : []) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Submission failed');
      setStatus('done');
    } catch (err) { setErrorMsg(err.message); setStatus('ready'); }
  };

  if (status === 'loading') return <Screen><Spinner /></Screen>;

  if (status === 'error') return (
    <Screen><Card>
      <StatusIcon>⚠️</StatusIcon>
      <h2 style={styles.heading}>Link Not Found</h2>
      <p style={styles.sub}>{errorMsg || 'This signing link is invalid.'}</p>
      <p style={styles.contact}>Questions? Contact us at <a href="mailto:restoration@utah-pros.com" style={styles.link}>restoration@utah-pros.com</a></p>
    </Card></Screen>
  );

  if (status === 'expired') return (
    <Screen><Card>
      <StatusIcon>🔒</StatusIcon>
      <h2 style={styles.heading}>Link Expired</h2>
      <p style={styles.sub}>This signing link is no longer active. Please contact Utah Pros Restoration to receive a new one.</p>
      <p style={styles.contact}><a href="mailto:restoration@utah-pros.com" style={styles.link}>restoration@utah-pros.com</a></p>
    </Card></Screen>
  );

  if (status === 'signed') return (
    <Screen><Card>
      <StatusIcon>✅</StatusIcon>
      <h2 style={styles.heading}>Already Signed</h2>
      <p style={styles.sub}>
        This document was signed on{' '}
        {data?.signed_at ? new Date(data.signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'a previous date'}.
      </p>
      <p style={styles.contact}>Questions? <a href="mailto:restoration@utah-pros.com" style={styles.link}>restoration@utah-pros.com</a></p>
    </Card></Screen>
  );

  if (status === 'done') return (
    <Screen>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', background: '#f1f5f9' }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: '48px 36px', maxWidth: 460, width: '100%', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 36 }}>✅</div>
          <h1 style={{ margin: '0 0 12px', fontSize: 24, fontWeight: 800, color: '#0f172a' }}>You're all set!</h1>
          <p style={{ margin: '0 0 8px', fontSize: 16, color: '#334155', lineHeight: 1.6 }}>Your <strong>{data?.doc_type === 'coc' ? 'Certificate of Completion' : 'document'}</strong> has been signed and saved successfully.</p>
          <p style={{ margin: '0 0 28px', fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>Thank you, <strong>{signerName}</strong>. Utah Pros Restoration has been notified. You may close this window.</p>
          <div style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 18px', border: '1px solid #e2e8f0' }}>
            <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Signed on</p>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          </div>
        </div>
      </div>
    </Screen>
  );

  const job      = data?.job || {};
  const address  = [job.address, job.city, job.state].filter(Boolean).join(', ');
  const docLabel = DOC_LABELS[data?.doc_type] || 'Document';

  const sectionText = buildSectionsFromTemplates(
    templates,
    data?.divisions || (job.division ? [job.division] : []),
    data?.doc_type,
    job
  );

  return (
    <Screen>
      <div style={styles.page}>
        <div style={styles.header}>
          <div style={styles.headerInner}>
            <p style={styles.company}>Utah Pros Restoration</p>
            <p style={styles.companySub}>Licensed · Insured · Utah</p>
          </div>
        </div>

        <div style={styles.content}>
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
            {job.date_of_loss      && <InfoRow label="Date of Loss" value={
              new Date(job.date_of_loss + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            } />}
          </div>

          <Divider />

          {sectionText.map((s, i) => (
            <div key={i} style={styles.section}>
              {s.heading && <p style={styles.sectionHeading}>{s.heading}</p>}
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

          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>FULL NAME <span style={{ color: '#ef4444' }}>*</span></label>
            <input style={styles.input} type="text" value={signerName}
              onChange={e => { setSignerName(e.target.value); setNameError(''); }}
              placeholder="Type your full legal name" autoComplete="name"
              disabled={status === 'submitting'} />
          </div>

          <div style={styles.fieldGroup}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={styles.fieldLabel}>SIGNATURE <span style={{ color: '#ef4444' }}>*</span></label>
              {hasSig && <button style={styles.clearBtn} onClick={clearSig} disabled={status === 'submitting'}>Clear</button>}
            </div>
            <div style={styles.canvasWrap}>
              <canvas ref={canvasRef} width={500} height={140} style={styles.canvas}
                onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
              {!hasSig && <p style={styles.canvasHint}>Sign here with your finger or mouse</p>}
            </div>
          </div>

          <label style={styles.checkLabel}>
            <input type="checkbox" checked={agreed} onChange={e => { setAgreed(e.target.checked); setNameError(''); }}
              disabled={status === 'submitting'} style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
              I have read and agree to the terms stated above, and confirm this electronic signature is legally binding.
            </span>
          </label>

          {nameError && <p style={styles.errorMsg}>⚠ {nameError}</p>}

          <button
            style={{ ...styles.submitBtn, opacity: status === 'submitting' ? 0.7 : 1, cursor: status === 'submitting' ? 'not-allowed' : 'pointer' }}
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

function Screen({ children }) { return <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', flexDirection: 'column' }}>{children}</div>; }
function Card({ children }) { return <div style={{ maxWidth: 420, margin: '80px auto', padding: '40px 32px', background: '#fff', borderRadius: 16, boxShadow: '0 2px 16px rgba(0,0,0,0.08)', textAlign: 'center' }}>{children}</div>; }
function StatusIcon({ children }) { return <div style={{ fontSize: 48, marginBottom: 16 }}>{children}</div>; }
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
    mold:           { heading: 'Mold Remediation',         body: 'I confirm that all mold remediation services performed by Utah Pros Restoration have been completed to my satisfaction. The affected areas have been properly contained, treated, and cleared. The work is 100% complete and I have no outstanding complaints or concerns.' },
    reconstruction: { heading: 'Repairs & Reconstruction', body: 'I confirm that all repairs and reconstruction performed by Utah Pros Restoration have been completed to my satisfaction. The repaired portions of the property are in equal or better condition than prior to the loss. The work is 100% complete and I have no outstanding complaints or concerns.' },
    fire:           { heading: 'Fire & Smoke Restoration', body: 'I confirm that all fire and smoke restoration services performed by Utah Pros Restoration have been completed to my satisfaction. The work was performed in a professional manner and is 100% complete. I have no outstanding complaints or concerns.' },
    contents:       { heading: 'Contents Restoration',     body: 'I confirm that Utah Pros Restoration has returned all salvageable contents items in satisfactory condition. I have had the opportunity to inspect the returned items. The work is 100% complete and I have no outstanding complaints or concerns.' },
  };
  const ORDER   = ['water', 'mold', 'reconstruction', 'fire', 'contents'];
  const divArr  = Array.isArray(divisions) ? divisions : (divisions ? [divisions] : []);
  const sorted  = [...divArr].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const results = sorted.map(d => map[d]).filter(Boolean);
  return results.length ? results : [{ heading: 'Work Completed', body: 'I confirm that all restoration services performed by Utah Pros Restoration have been completed to my satisfaction. The work was performed in a professional manner and is 100% complete. I have no outstanding complaints or concerns.' }];
}

const DOC_LABELS = { coc: 'Certificate of Completion', work_auth: 'Work Authorization', direction_pay: 'Direction of Pay', change_order: 'Change Order' };

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
  submitBtn:     { width: '100%', padding: '14px', background: '#2563eb', color: '#fff', fontSize: 16, fontWeight: 700, border: 'none', borderRadius: 10, fontFamily: 'inherit', letterSpacing: '0.1px' },
  footer:        { marginTop: 20, textAlign: 'center', fontSize: 12, color: '#94a3b8' },
  heading:       { margin: '0 0 12px', fontSize: 20, fontWeight: 700, color: '#0f172a' },
  sub:           { margin: '0 0 8px', fontSize: 14, color: '#475569', lineHeight: 1.6 },
  contact:       { margin: '16px 0 0', fontSize: 13, color: '#64748b' },
  link:          { color: '#2563eb', textDecoration: 'none' },
};
