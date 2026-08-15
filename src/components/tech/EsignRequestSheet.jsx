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
 *   or sends the customer a signing link by text or email. It does not store
 *   anything itself; it asks the server to create the request and hands back a
 *   signing link.
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
 *   - Two primary doc types (work_auth, coc) plus six fixed-wording situational
 *     authorizations added 2026-08-07. The line is PRE-APPROVED WORDING, not
 *     seniority: everything reachable here has text a human reviewed and
 *     committed. Composing NEW text stays office-only, and direction_pay /
 *     change_order / recon_agreement remain desktop-only as before.
 *     CoC needs ≥1 division (scope of work).
 *   - signer_email is required + validated only for email mode. It is genuinely
 *     optional elsewhere — the old `collect-<ts>@noemail.local` placeholder is
 *     gone (2026-07-26); the column was always nullable.
 *   - Texting needs a linked contact, because the number comes from that
 *     contact's conversation and consent is checked against it. No contact, no
 *     text button — never fall back to typing a number in by hand.
 *   - A text can be refused for consent/DND reasons. That is a normal outcome,
 *     not an error: the request still exists and the sheet keeps the link.
 *   - Sheet contract (UPR-Design-System.md Motion Catalog): useSheetClosing owns
 *     the exit animation (render only when `present`), useDialogLifecycle owns
 *     focus/Escape/aria. Adopt BOTH on any sibling sheet.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useRef } from 'react';
import { useDialogLifecycle } from '@/lib/useDialogLifecycle';
import { useSheetClosing } from '@/lib/useSheetClosing';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { getAuthHeader } from '@/lib/realtime';
import { ok, err } from '@/lib/toast';
import useNativeKeyboardInset from '@/lib/useNativeKeyboardInset';
import { canSendCustomDoc } from '@/lib/claimUtils';
import { CUSTOM_DOC_SNIPPETS, CUSTOM_DOC_HEADING_MAX, CUSTOM_DOC_BODY_MAX } from '@/lib/customDocSnippets';
import { SignatureIcon, TextIcon, EmailIcon } from '@/components/ActionIcons';

// ─── SECTION: Constants ──────────────
// The two documents a tech reaches for on nearly every job. Large stacked
// buttons — one-tap, gloved hands, no reading required.
const DOC_TYPES = [
  { key: 'work_auth', label: 'Work Authorization',        sub: 'Authorize work to begin' },
  { key: 'coc',       label: 'Certificate of Completion', sub: 'Confirm the work is finished' },
];

// Situational authorizations (2026-08-07). Pre-approved wording for things that
// come up on a live loss and used to be written by hand outside the app. A
// compact grid rather than six more full-width buttons: eight stacked 56px
// blocks would push the signer fields and the send actions off the sheet.
// These are NOT free-form — the text is fixed, which is why the field shell
// gets them while composing new text stays office-only.
const SITUATIONAL_DOC_TYPES = [
  { key: 'cat3_removal',            label: 'Emergency Removal',   sub: 'Cat 3 contamination' },
  { key: 'emergency_demo',          label: 'Emergency Demo',      sub: 'Before adjuster' },
  { key: 'coverage_unconfirmed',    label: 'Coverage Unconfirmed', sub: 'Proceed anyway' },
  { key: 'service_declined',        label: 'Declined Services',   sub: 'Customer said no' },
  { key: 'equipment_early_removal', label: 'Early Equip. Pull',   sub: 'Against advice' },
  { key: 'access_release',          label: 'Property Access',     sub: 'Key or code release' },
];

const DIVISIONS = [
  { key: 'water',          emoji: '💧', label: 'Water' },
  { key: 'mold',           emoji: '🧫', label: 'Mold' },
  { key: 'reconstruction', emoji: '🏗️', label: 'Repairs & Recon' },
  { key: 'fire',           emoji: '🔥', label: 'Fire & Smoke' },
  { key: 'contents',       emoji: '📦', label: 'Contents' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EsignRequestSheet({ open, onClose, job, signerPrefill, employeeId, employeeRole, initialDocType = 'work_auth', onSent }) {
  // ─── SECTION: State & hooks ──────────────
  const navigate = useNavigate();
  // KB-01. This sheet is bottom-docked with its Collect/Text/Email actions in a
  // footer OUTSIDE the scrollable body, so when the keyboard covered the bottom
  // the actions and the focused field were unreachable and scrolling could not
  // recover them. Native only — 0 in a browser, where the sheet renders exactly
  // as it does today (owner decision: the PWA UI is frozen).
  const kbInset = useNativeKeyboardInset();
  // MODAL-01: focus trap, focus return, Escape, aria-modal — the same
  // contract Modal.jsx provides, without restructuring this sheet's markup.
  const panelRef = useRef(null);
  const dialogProps = useDialogLifecycle({ open, onClose, panelRef });
  // motion-standard §3: stay mounted through the exit animation, then unmount
  // on animationend. `present` outlives `open` by one exit (~165ms).
  const { present, overlayClassName, panelClassName, onAnimationEnd } = useSheetClosing(open);
  const [docType, setDocType] = useState(initialDocType);
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [divisions, setDivisions] = useState([]);
  const [sending, setSending] = useState(null); // 'collect' | 'email' | null
  const [error, setError] = useState('');
  const errorRef = useRef(null);

  // Custom Authorization compose. Free text is admin/office/project_manager only
  // — server-enforced in functions/api/send-esign.js; this just hides the button.
  // It exists in the field shell because the owner explicitly wanted it "from
  // either the computer or the field" — an owner standing in a flooded basement
  // is the case that created this feature.
  const mayWriteCustom = canSendCustomDoc(employeeRole);
  const [snippetKey, setSnippetKey] = useState('blank');
  const [customHeading, setCustomHeading] = useState('');
  const [customBody, setCustomBody] = useState('');

  const applySnippet = (key) => {
    const s = CUSTOM_DOC_SNIPPETS.find(x => x.key === key);
    if (!s) return;
    setSnippetKey(key);
    setCustomHeading(s.heading);
    setCustomBody(s.body);
    setError('');
  };

  // Captured as primitives so the reset effect doesn't re-run on every parent
  // re-render (signerPrefill is a fresh object each time) and clobber edits.
  const prefillName = signerPrefill?.name || '';
  const prefillEmail = signerPrefill?.email || '';
  const contactId = signerPrefill?.contactId || null;
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

  // The error banner sits under the three send buttons, so on a phone it lands
  // below the fold: the tech taps Text link, nothing appears to happen, and the
  // real reason ("this job has no linked customer") is off-screen. Reduced
  // motion is honoured explicitly — scrollIntoView does not (motion-standard §5).
  useEffect(() => {
    if (!error || !errorRef.current) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    errorRef.current.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }, [error]);

  if (!present) return null;

  // ─── SECTION: Event handlers ──────────────
  const toggleDivision = (key) =>
    setDivisions((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));

  const send = async (mode) => {
    setError('');
    if (!signerName.trim()) { setError('Signer name is required.'); return; }
    if (docType === 'coc' && divisions.length === 0) { setError('Select at least one scope of work.'); return; }
    if (docType === 'other') {
      if (!mayWriteCustom) { setError('You do not have permission to send a custom document.'); return; }
      if (!customHeading.trim()) { setError('Give the document a title.'); return; }
      if (!customBody.trim()) { setError('Write the document text.'); return; }
      // A leftover [bracketed] prompt prints verbatim on the signed PDF.
      const unfilled = customBody.match(/\[[^\]\n]{4,}\]/);
      if (unfilled) { setError(`Fill in "${unfilled[0].slice(0, 50)}" before sending.`); return; }
    }
    if (mode === 'email') {
      if (!signerEmail.trim()) { setError('Signer email is required to send a link.'); return; }
      if (!EMAIL_RE.test(signerEmail.trim())) { setError('Enter a valid email address.'); return; }
    }
    if (mode === 'sms' && !contactId) { setError('This job has no linked customer, so the link cannot be texted.'); return; }
    setSending(mode);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/send-esign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          job_id: job.id,
          contact_id: contactId,
          signer_name: signerName.trim(),
          // Genuinely optional now — no placeholder. Blank means blank.
          signer_email: signerEmail.trim() || null,
          sent_by: employeeId,
          doc_type: docType,
          divisions: docType === 'coc' ? divisions : undefined,
          mode,
          ...(docType === 'other' ? {
            custom_heading: customHeading.trim(),
            custom_body: customBody.trim(),
            custom_snippet_key: snippetKey === 'blank' ? null : snippetKey,
          } : {}),
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
        return;
      }

      // A refused text (no consent / DND) is an expected outcome. Keep the sheet
      // open and say so plainly, so the tech can switch to email or hand over
      // the phone instead of thinking the app broke.
      if (mode === 'sms' && json.sms_error) {
        setError(json.message || 'The text could not be sent.');
        onSent?.();
        return;
      }
      if (mode === 'email' && json.email_error) {
        err(`Email failed: ${json.email_error_detail || 'unknown error'}`);
      } else {
        ok(mode === 'sms'
          ? 'Signing link texted to the customer.'
          : `Signing link sent to ${signerEmail.trim()}.`);
      }
      onSent?.();
      onClose?.();
    } catch (e) {
      setError(e.message || 'Failed to send request.');
    } finally {
      setSending(null);
    }
  };

  // ─── SECTION: Render ──────────────
  return createPortal(
    <div
      onClick={() => { if (!sending) onClose?.(); }}
      className={overlayClassName}
      onAnimationEnd={onAnimationEnd}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        // The sheet is docked to flex-end, so padding here lifts the whole
        // sheet clear of the keyboard. 0 on web => identical to today.
        paddingBottom: kbInset || undefined,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        ref={panelRef}
        {...dialogProps}
        aria-label="Request signature"
        className={panelClassName}
        style={{
          width: '100%', maxWidth: 560, background: 'var(--bg-primary)',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          boxShadow: '0 -8px 24px rgba(0,0,0,0.15)',
          // Shrink by the same amount the overlay lifted, or a tall sheet would
          // push its own header off the top of the screen.
          maxHeight: kbInset ? `calc(92dvh - ${kbInset}px)` : '92dvh',
          display: 'flex', flexDirection: 'column',
          // The home-indicator inset is meaningless while a keyboard occupies
          // that space; collapse it so the actions sit flush on the keyboard.
          paddingBottom: kbInset ? 12 : 'max(12px, env(safe-area-inset-bottom, 12px))',
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

          {/* Situational authorizations — fixed wording, two-up grid */}
          <SectionLabel>Situational</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            {SITUATIONAL_DOC_TYPES.map((d) => {
              const active = docType === d.key;
              return (
                <button
                  key={d.key} type="button" onClick={() => setDocType(d.key)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1,
                    minHeight: 'var(--tech-min-tap, 48px)', padding: '8px 12px',
                    borderRadius: 'var(--tech-radius-button, 14px)',
                    background: active ? 'var(--accent-light)' : 'var(--bg-tertiary)',
                    color: active ? 'var(--accent)' : 'var(--text-primary)',
                    border: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                    cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-sans)',
                    touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.25 }}>{d.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.25, color: active ? 'var(--accent)' : 'var(--text-tertiary)' }}>{d.sub}</span>
                </button>
              );
            })}
          </div>

          {/* Free-text compose — office roles only */}
          {mayWriteCustom && (
            <button
              type="button" onClick={() => setDocType('other')}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1,
                width: '100%', minHeight: 'var(--tech-min-tap, 48px)', padding: '10px 14px',
                marginBottom: 16, borderRadius: 'var(--tech-radius-button, 14px)',
                background: docType === 'other' ? 'var(--accent-light)' : 'var(--bg-tertiary)',
                color: docType === 'other' ? 'var(--accent)' : 'var(--text-primary)',
                border: `2px solid ${docType === 'other' ? 'var(--accent)' : 'transparent'}`,
                cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-sans)',
                touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700 }}>Write a custom document</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: docType === 'other' ? 'var(--accent)' : 'var(--text-tertiary)' }}>
                For a situation none of the above covers
              </span>
            </button>
          )}

          {/* Compose — Custom Authorization only */}
          {docType === 'other' && mayWriteCustom && (
            <div style={{ marginBottom: 16 }}>
              <div style={{
                background: 'var(--warning-bg, #fffbeb)', border: '1px solid var(--warning-border, #fde68a)',
                borderRadius: 'var(--radius-md)', padding: '9px 12px', marginBottom: 12,
                fontSize: 12, color: 'var(--warning, #92400e)', lineHeight: 1.5,
              }}>
                Nobody reviews this wording before the customer signs it. If one of the documents
                above fits, use that instead.
              </div>

              <SectionLabel>Start from</SectionLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {CUSTOM_DOC_SNIPPETS.map((s) => {
                  const active = snippetKey === s.key;
                  return (
                    <button
                      key={s.key} type="button" onClick={() => applySnippet(s.key)}
                      style={{
                        minHeight: 40, padding: '0 12px', borderRadius: 'var(--radius-full, 9999px)',
                        background: active ? 'var(--accent-light)' : 'var(--bg-tertiary)',
                        color: active ? 'var(--accent)' : 'var(--text-primary)',
                        border: `1px solid ${active ? 'var(--accent)' : 'var(--border-light)'}`,
                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        fontFamily: 'var(--font-sans)', touchAction: 'manipulation',
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>

              <SectionLabel>Title</SectionLabel>
              <input
                className="input" type="text" value={customHeading}
                onChange={(e) => { setCustomHeading(e.target.value); setError(''); }}
                maxLength={CUSTOM_DOC_HEADING_MAX}
                placeholder="What this document is"
                style={{ fontSize: 16, width: '100%', minHeight: 48, marginBottom: 10, boxSizing: 'border-box' }}
              />

              <SectionLabel>Document text</SectionLabel>
              {/* Both classes are required — .input pins height:40px and only
                  .textarea restores height:auto. fontSize 16 blocks iOS zoom. */}
              <textarea
                className="input textarea" value={customBody}
                onChange={(e) => { setCustomBody(e.target.value); setError(''); }}
                maxLength={CUSTOM_DOC_BODY_MAX}
                rows={10}
                placeholder="Pick a starting point above, then fill in the details."
                style={{
                  fontSize: 16, width: '100%', minHeight: 220, lineHeight: 1.55,
                  resize: 'vertical', boxSizing: 'border-box', fontFamily: 'var(--font-sans)',
                }}
              />
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6, lineHeight: 1.5 }}>
                Replace every [bracketed] prompt — they print exactly as written.
              </div>
            </div>
          )}

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
            placeholder="Email (only needed to email the link)"
            style={{ fontSize: 16, width: '100%', minHeight: 48, boxSizing: 'border-box' }}
          />
          {!contactId && (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6, lineHeight: 1.5 }}>
              No customer linked to this job, so the link can’t be texted. Collect on-site or email it.
            </div>
          )}

          {error && (
            <div ref={errorRef} role="alert" style={{
              marginTop: 12, background: 'var(--danger-bg)', border: '1px solid var(--danger-border)',
              borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 13, color: 'var(--danger)',
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
            {sending === 'collect' ? 'Opening…' : <><SignatureIcon size={18} /> Collect signature on-site</>}
          </button>
          {/* Text before email: in the field the customer is holding a phone. */}
          <button
            type="button" className="btn btn-secondary" onClick={() => send('sms')}
            disabled={!!sending || !contactId}
            style={{ width: '100%', minHeight: 48, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: contactId ? 1 : 0.5 }}
          >
            {sending === 'sms' ? 'Sending…' : <><TextIcon size={18} /> Text link to sign</>}
          </button>
          <button
            type="button" className="btn btn-secondary" onClick={() => send('email')} disabled={!!sending}
            style={{ width: '100%', minHeight: 48, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {sending === 'email' ? 'Sending…' : <><EmailIcon size={18} /> Email link to sign</>}
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
