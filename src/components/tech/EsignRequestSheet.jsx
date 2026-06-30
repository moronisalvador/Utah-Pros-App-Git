/**
 * ════════════════════════════════════════════════
 * FILE: EsignRequestSheet.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A slide-up panel a field tech uses to start an e-signature request for a
 *   job. The tech picks which document to send (Work Authorization or
 *   Certificate of Completion), confirms who is signing (pre-filled from the
 *   job's customer), then either collects the signature on the spot — it opens
 *   the signing screen right here so the customer can sign on the tech's phone —
 *   or emails the customer a signing link. It does not store anything itself; it
 *   asks the server to create the request and hands back a signing link.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (bottom sheet, opened from the Documents hub)
 *   Rendered by:  src/pages/tech/TechJobDocuments.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom (createPortal), react-router-dom (useNavigate)
 *   Internal:  @/lib/realtime (getAuthHeader)
 *   Data:      reads  → none directly
 *              writes → sign_requests (indirectly, via POST /api/send-esign);
 *                        sends an email through that worker when mode = 'email'
 *
 * NOTES / GOTCHAS:
 *   - "Collect on-site" navigates IN-APP to /sign/:token (the full-screen public
 *     signing page) instead of window.open — this avoids the iOS standalone-PWA
 *     popup problem. The tech hands over the phone, the customer signs, taps back.
 *   - Curated to two doc types on purpose (work_auth, coc); the other desktop
 *     types stay office-only. CoC needs ≥1 division (scope of work).
 *   - signer_email is optional for collect mode (a placeholder is sent so the
 *     worker is satisfied); it is required + validated for email mode.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { getAuthHeader } from '@/lib/realtime';

// ─── SECTION: Constants ──────────────
const DOC_TYPES = [
  { key: 'work_auth', label: 'Work Authorization',        sub: 'Authorize work to begin' },
  { key: 'coc',       label: 'Certificate of Completion', sub: 'Confirm the work is finished' },
];

const DIVISIONS = [
  { key: 'water',          emoji: '💧', label: 'Water' },
  { key: 'mold',           emoji: '🧫', label: 'Mold' },
  { key: 'reconstruction', emoji: '🏗️', label: 'Repairs & Recon' },
  { key: 'fire',           emoji: '🔥', label: 'Fire & Smoke' },
  { key: 'contents',       emoji: '📦', label: 'Contents' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fireToast = (message, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));

export default function EsignRequestSheet({ open, onClose, job, signerPrefill, employeeId, initialDocType = 'work_auth', onSent }) {
  // ─── SECTION: State & hooks ──────────────
  const navigate = useNavigate();
  const [docType, setDocType] = useState(initialDocType);
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [divisions, setDivisions] = useState([]);
  const [sending, setSending] = useState(null); // 'collect' | 'email' | null
  const [error, setError] = useState('');

  // Captured as primitives so the reset effect doesn't re-run on every parent
  // re-render (signerPrefill is a fresh object each time) and clobber edits.
  const prefillName = signerPrefill?.name || '';
  const prefillEmail = signerPrefill?.email || '';
  const jobDivision = job?.division || null;

  // Reset + prefill each time the sheet opens
  useEffect(() => {
    if (!open) return;
    setDocType(initialDocType);
    setSignerName(prefillName);
    setSignerEmail(prefillEmail);
    setError('');
    setSending(null);
  }, [open, initialDocType, prefillName, prefillEmail]);

  // Pre-seed scope of work from the job whenever CoC is the selected doc
  useEffect(() => {
    if (docType === 'coc') setDivisions(jobDivision ? [jobDivision] : []);
    else setDivisions([]);
  }, [docType, jobDivision]);

  if (!open) return null;

  // ─── SECTION: Event handlers ──────────────
  const toggleDivision = (key) =>
    setDivisions((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));

  const send = async (mode) => {
    setError('');
    if (!signerName.trim()) { setError('Signer name is required.'); return; }
    if (docType === 'coc' && divisions.length === 0) { setError('Select at least one scope of work.'); return; }
    if (mode === 'email') {
      if (!signerEmail.trim()) { setError('Signer email is required to send a link.'); return; }
      if (!EMAIL_RE.test(signerEmail.trim())) { setError('Enter a valid email address.'); return; }
    }
    setSending(mode);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/send-esign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          job_id: job.id,
          contact_id: signerPrefill?.contactId || null,
          signer_name: signerName.trim(),
          signer_email: signerEmail.trim() || `collect-${Date.now()}@noemail.local`,
          sent_by: employeeId,
          doc_type: docType,
          divisions: docType === 'coc' ? divisions : undefined,
          mode,
        }),
      });
      const raw = await res.text();
      let json;
      try { json = JSON.parse(raw); } catch { throw new Error(`Server error: ${raw.slice(0, 160)}`); }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      if (mode === 'collect') {
        // Stay inside the PWA: open the full-screen signing page and hand the
        // phone to the customer. onSent first so the hub refreshes on return.
        onSent?.();
        navigate(`/sign/${json.token}`);
      } else {
        fireToast(
          json.email_error
            ? `Email failed (${json.email_status || '?'}): ${json.email_error_detail || 'unknown error'}`
            : `Signing link sent to ${signerEmail.trim()}.`,
          json.email_error ? 'error' : 'success',
        );
        onSent?.();
        onClose?.();
      }
    } catch (err) {
      setError(err.message || 'Failed to send request.');
    } finally {
      setSending(null);
    }
  };

  // ─── SECTION: Render ──────────────
  return createPortal(
    <div
      onClick={() => { if (!sending) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: 'tech-fade-in 0.15s ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Request signature"
        style={{
          width: '100%', maxWidth: 560, background: 'var(--bg-primary)',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          boxShadow: '0 -8px 24px rgba(0,0,0,0.15)',
          maxHeight: '92dvh', display: 'flex', flexDirection: 'column',
          paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))',
          animation: 'tech-slide-up 0.22s ease-out',
        }}
      >
        {/* Grabber + close */}
        <div style={{ position: 'relative', padding: '10px 16px 2px' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border-color)', margin: '0 auto' }} />
          <button
            type="button" aria-label="Close" onClick={onClose} disabled={!!sending}
            style={{
              position: 'absolute', top: 2, right: 8, width: 40, height: 40,
              border: 'none', background: 'transparent', color: 'var(--text-tertiary)',
              cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 0,
              touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
            }}
          >
            ✕
          </button>
        </div>

        {/* Title + job context */}
        <div style={{ padding: '2px 16px 8px' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>Request signature</div>
          {(job?.job_number || job?.insured_name) && (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {job?.job_number}{job?.insured_name ? ` · ${job.insured_name}` : ''}
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 8px' }}>
          {/* Document type */}
          <SectionLabel>Document</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {DOC_TYPES.map((d) => {
              const active = docType === d.key;
              return (
                <button
                  key={d.key} type="button" onClick={() => setDocType(d.key)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                    minHeight: 56, padding: '10px 14px', borderRadius: 'var(--tech-radius-button, 14px)',
                    background: active ? 'var(--accent-light)' : 'var(--bg-tertiary)',
                    color: active ? 'var(--accent)' : 'var(--text-primary)',
                    border: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                    cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-sans)',
                    touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{d.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: active ? 'var(--accent)' : 'var(--text-tertiary)' }}>{d.sub}</span>
                </button>
              );
            })}
          </div>

          {/* Scope of work — CoC only */}
          {docType === 'coc' && (
            <div style={{ marginBottom: 16 }}>
              <SectionLabel>Scope of work</SectionLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {DIVISIONS.map((d) => {
                  const active = divisions.includes(d.key);
                  return (
                    <button
                      key={d.key} type="button" onClick={() => toggleDivision(d.key)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        minHeight: 'var(--tech-min-tap, 48px)', padding: '0 14px',
                        borderRadius: 'var(--radius-full, 9999px)',
                        background: active ? 'var(--accent-light)' : 'var(--bg-tertiary)',
                        color: active ? 'var(--accent)' : 'var(--text-primary)',
                        border: `1px solid ${active ? 'var(--accent)' : 'var(--border-light)'}`,
                        fontSize: 14, fontWeight: 600, cursor: 'pointer',
                        fontFamily: 'var(--font-sans)', touchAction: 'manipulation',
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      <span style={{ fontSize: 15 }}>{d.emoji}</span>
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Signer */}
          <SectionLabel>Signer</SectionLabel>
          <input
            className="input" type="text" value={signerName}
            onChange={(e) => { setSignerName(e.target.value); setError(''); }}
            placeholder="Full name"
            style={{ fontSize: 16, width: '100%', minHeight: 48, marginBottom: 8, boxSizing: 'border-box' }}
          />
          <input
            className="input" type="email" inputMode="email" value={signerEmail}
            onChange={(e) => { setSignerEmail(e.target.value); setError(''); }}
            placeholder="Email (required to send a link)"
            style={{ fontSize: 16, width: '100%', minHeight: 48, boxSizing: 'border-box' }}
          />

          {error && (
            <div style={{
              marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 13, color: '#dc2626',
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 16px 0', borderTop: '1px solid var(--border-light)' }}>
          <button
            type="button" className="btn btn-primary" onClick={() => send('collect')} disabled={!!sending}
            style={{ width: '100%', minHeight: 48, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {sending === 'collect' ? 'Opening…' : '✍️ Collect signature on-site'}
          </button>
          <button
            type="button" className="btn btn-secondary" onClick={() => send('email')} disabled={!!sending}
            style={{ width: '100%', minHeight: 48, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {sending === 'email' ? 'Sending…' : '✉️ Email link to sign'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── SECTION: Helpers ──────────────
function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
      textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
    }}>
      {children}
    </div>
  );
}
