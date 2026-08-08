import { useState, useEffect, useRef } from 'react';
import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';
import { createPortal } from 'react-dom';
import { getAuthHeader } from '@/lib/realtime';
import { ok, err } from '@/lib/toast';
import { canSendCustomDoc } from '@/lib/claimUtils';
import {
  CUSTOM_DOC_SNIPPETS, CUSTOM_DOC_TOKENS,
  CUSTOM_DOC_HEADING_MAX, CUSTOM_DOC_BODY_MAX,
} from '@/lib/customDocSnippets';

// Grouped so the picker stays scannable now that there are eleven types. `core`
// is the original five (unchanged keys, unchanged order); `situational` is the
// 2026-08-07 batch for one-off circumstances on a live loss.
const DOC_TYPES = [
  { key: 'coc',              label: 'Certificate of Completion', group: 'core' },
  { key: 'work_auth',        label: 'Work Authorization',        group: 'core' },
  { key: 'direction_pay',    label: 'Direction of Pay',          group: 'core' },
  { key: 'change_order',     label: 'Change Order',              group: 'core' },
  { key: 'recon_agreement',  label: 'Reconstruction Agreement',  group: 'core', fullWidth: true },

  { key: 'cat3_removal',            label: 'Emergency Removal — Cat 3', group: 'situational' },
  { key: 'emergency_demo',          label: 'Emergency Demolition',      group: 'situational' },
  { key: 'coverage_unconfirmed',    label: 'Coverage Not Confirmed',    group: 'situational' },
  { key: 'service_declined',        label: 'Declined Services',         group: 'situational' },
  { key: 'equipment_early_removal', label: 'Early Equipment Removal',   group: 'situational' },
  { key: 'access_release',          label: 'Property Access Release',   group: 'situational' },

  // Free-text. Role-gated in the picker below AND server-side in
  // functions/api/send-esign.js — the server is the one that matters.
  { key: 'other', label: 'Write a custom document…', group: 'custom', fullWidth: true },
];

const DOC_GROUPS = [
  { key: 'core',        label: 'Standard' },
  { key: 'situational', label: 'Situational Authorizations' },
  { key: 'custom',      label: 'Custom' },
];

const DIVISIONS = [
  { key: 'water',          emoji: '💧', label: 'Water Mitigation'      },
  { key: 'mold',           emoji: '🧫', label: 'Mold Remediation'      },
  { key: 'reconstruction', emoji: '🏗️', label: 'Repairs & Recon'       },
  { key: 'remodeling',     emoji: '🔨', label: 'Remodel'               },
  { key: 'fire',           emoji: '🔥', label: 'Fire & Smoke'          },
  { key: 'contents',       emoji: '📦', label: 'Contents'              },
];

/* Declared above the component, not below it: no-use-before-define is
   configured with variables:true and CI runs the changed-files ratchet at
   --max-warnings 0, so a style object used in the render but declared at the
   file tail is a finding on every usage. Same pure move SignPage.jsx made on
   2026-07-29. Values unchanged. */
const sectionLabel = {
  fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
};

const groupLabel = {
  fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
  letterSpacing: '0.03em', marginBottom: 5,
};

const fieldLabel = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: 'var(--text-secondary)', marginBottom: 4,
};

function IconX(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}

export default function SendEsignModal({ job, currentUser, db, onClose, onSent }) {
  const [docType,        setDocType]        = useState('coc');
  const [signerName,     setSignerName]     = useState('');
  const [signerEmail,    setSignerEmail]    = useState('');
  const [contactId,      setContactId]      = useState(null);
  const [sending,        setSending]        = useState(false);
  const [divisions,      setDivisions]      = useState([]);
  const [error,          setError]          = useState('');
  const [done,           setDone]           = useState(false);
  const [sentVia,        setSentVia]        = useState('email');
  const [signingUrl,     setSigningUrl]     = useState('');
  const [loadingContact, setLoadingContact] = useState(true);
  const [copied,         setCopied]         = useState(false);

  // ── Custom Authorization compose state ──
  const [snippetKey,    setSnippetKey]    = useState('blank');
  const [customHeading, setCustomHeading] = useState('');
  const [customBody,    setCustomBody]    = useState('');
  const bodyRef  = useRef(null);
  const errorRef = useRef(null);

  // The compose form is tall — snippet picker, title, an 8,000-character body,
  // token chips, then the signer fields — so on a laptop the error banner
  // renders below the fold. Pressing Send looked like it did nothing at all.
  // Reduced motion is honoured explicitly; scrollIntoView does not do it for us
  // (motion-standard.md §5).
  useEffect(() => {
    if (!error || !errorRef.current) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    errorRef.current.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }, [error]);

  const mayWriteCustom = canSendCustomDoc(currentUser?.role);
  const visibleGroups  = DOC_GROUPS.filter(g => g.key !== 'custom' || mayWriteCustom);

  const applySnippet = (key) => {
    const s = CUSTOM_DOC_SNIPPETS.find(x => x.key === key);
    if (!s) return;
    setSnippetKey(key);
    setCustomHeading(s.heading);
    setCustomBody(s.body);
    setError('');
  };

  // Insert a {{token}} at the cursor rather than appending — mirrors
  // TemplateEditor.jsx's insertVar so the two editors behave the same way.
  const insertToken = (tokenKey) => {
    const el = bodyRef.current;
    if (!el) { setCustomBody(v => v + tokenKey); return; }
    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd   ?? el.value.length;
    setCustomBody(el.value.slice(0, start) + tokenKey + el.value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + tokenKey.length, start + tokenKey.length);
    });
  };

  // Pre-seed division from job when CoC selected.
  // Recon agreement is always reconstruction-scoped — pre-set so the
  // division is recorded on the sign_request and available to the PDF.
  useEffect(() => {
    if (docType === 'coc' && job?.division) setDivisions([job.division]);
    else if (docType === 'recon_agreement')  setDivisions(['reconstruction']);
    else                                      setDivisions([]);
  }, [docType, job?.division]);

  // Auto-fetch primary contact — uses authenticated db client passed from JobPage
  useEffect(() => {
    if (!job?.id) { setLoadingContact(false); return; }
    const loadContact = async () => {
      try {
        let cid = null;
        // Try primary contact first, then any contact on the job
        for (const filter of ['is_primary=eq.true&', '']) {
          const rows = await db.select('contact_jobs', `job_id=eq.${job.id}&${filter}limit=1&select=contact_id`);
          cid = rows?.[0]?.contact_id;
          if (cid) break;
        }
        if (!cid) {
          if (job.insured_name) setSignerName(job.insured_name);
          if (job.client_email) setSignerEmail(job.client_email);
          return;
        }
        const contacts = await db.select('contacts', `id=eq.${cid}&select=id,name,email`);
        const c = contacts?.[0];
        if (!c) return;
        setContactId(c.id);
        if (c.name)  setSignerName(c.name);
        // Prefer contact email, fall back to job.client_email if contact has none
        if (c.email) setSignerEmail(c.email);
        else if (job?.client_email) setSignerEmail(job.client_email);
      } catch {
        if (job.insured_name) setSignerName(job.insured_name);
      } finally {
        setLoadingContact(false);
      }
    };
    loadContact();
  }, [job?.id, db]);

  const toggleDivision = (key) =>
    setDivisions(prev =>
      prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key]
    );

  const handleSend = async (mode = 'email') => {
    setError('');
    if (docType === 'coc' && divisions.length === 0) { setError('Select at least one scope of work.'); return; }
    if (docType === 'other') {
      if (!customHeading.trim()) { setError('Give the document a title.'); return; }
      if (!customBody.trim())    { setError('Write the document text.'); return; }
      // A skeleton's [bracketed] prompts print verbatim on the signed PDF. The
      // change_order template has shipped for months telling customers
      // "[Describe the additional work authorized here]" — do not add a second.
      const unfilled = customBody.match(/\[[^\]\n]{4,}\]/);
      if (unfilled) {
        setError(`Fill in "${unfilled[0].slice(0, 60)}" — bracketed prompts print exactly as written.`);
        return;
      }
    }
    if (!signerName.trim())  { setError('Signer name is required.'); return; }
    if (mode === 'email') {
      if (!signerEmail.trim()) { setError('Signer email is required.'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) { setError('Enter a valid email address.'); return; }
    }
    if (mode === 'sms' && !contactId) {
      setError('This job has no linked contact, so the link cannot be texted.');
      return;
    }

    // iOS Safari blocks window.open() after any await — must open synchronously
    // in the user-gesture context, before the first await
    let collectWin = null;
    if (mode === 'collect') {
      collectWin = window.open('about:blank', '_blank');
    }

    setSending(mode);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/send-esign', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          job_id:       job.id,
          contact_id:   contactId || null,
          signer_name:  signerName.trim(),
          // Genuinely optional now — no placeholder. Blank means blank.
          signer_email: signerEmail.trim() || null,
          sent_by:      currentUser?.id,
          doc_type:     docType,
          divisions:    docType === 'coc' ? divisions : undefined,
          mode,
          // Snapshotted onto the sign_request by the worker so the wording
          // cannot change after the link is sent.
          ...(docType === 'other' ? {
            custom_heading:     customHeading.trim(),
            custom_body:        customBody.trim(),
            custom_snippet_key: snippetKey === 'blank' ? null : snippetKey,
          } : {}),
        }),
      });
      const raw = await res.text();
      let json;
      try { json = JSON.parse(raw); } catch { throw new Error(`Server error: ${raw.slice(0, 200)}`); }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      if (mode === 'collect') {
        if (collectWin) {
          collectWin.location.href = json.signing_url;
        } else {
          window.open(json.signing_url, '_blank'); // fallback (non-Safari)
        }
        ok('Signature page opened — hand device to client.');
        onClose();
        onSent?.(json);
      } else if (mode === 'sms' && json.sms_error) {
        // Consent/DND refusal is an expected outcome, not a crash. Stay on the
        // form, say why, and keep the link reachable so the user can switch to
        // email or copy it — the sign request already exists either way.
        setError(json.message || 'The text could not be sent.');
        setSigningUrl(json.signing_url || '');
        onSent?.(json);
      } else {
        if (json.email_error) {
          err(`Email failed: ${json.email_error_detail || 'unknown error'}`);
        } else {
          ok(mode === 'sms'
            ? 'Signing link texted to the client.'
            : `Signing link sent to ${signerEmail.trim()}.`);
        }
        setSentVia(mode);
        setSigningUrl(json.signing_url || '');
        setDone(true);
        onSent?.(json);
      }
    } catch (err) {
      if (collectWin) collectWin.close(); // close blank tab on error
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(signingUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Success state ──
  if (done) {
    return createPortal(
      <div className="conv-modal-backdrop" onClick={onClose}>
        <div className="conv-modal" onClick={e => e.stopPropagation()}
          style={{ maxWidth: 440, display: 'flex', flexDirection: 'column' }}>

          <div className="conv-modal-header">
            <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>Sent for Signature</span>
            <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ width: 32, height: 32, padding: 0 }}>
              <IconX style={{ width: 18, height: 18 }} />
            </button>
          </div>

          <div style={{ padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>{sentVia === 'sms' ? '💬' : '✉️'}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
              {sentVia === 'sms' ? `Link texted to ${signerName}` : `Link sent to ${signerEmail}`}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 24 }}>
              The signed PDF will appear in the Files tab automatically once they sign.
            </div>

            {signingUrl && (
              <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 20, textAlign: 'left' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                  Signing Link (backup)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <a href={signingUrl} target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, fontSize: 11, color: 'var(--brand-primary)', wordBreak: 'break-all', textDecoration: 'none', lineHeight: 1.4 }}>
                    {signingUrl}
                  </a>
                  <button className="btn btn-secondary btn-sm" onClick={copyUrl}
                    style={{ flexShrink: 0, fontSize: 11, height: 28 }}>
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            <button className="btn btn-primary" onClick={onClose} style={{ width: '100%' }}>Done</button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // ── Form state ──
  return createPortal(
    <div className="conv-modal-backdrop" onClick={onClose}>
      <div className="conv-modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div className="conv-modal-header">
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>Send for Signature</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ width: 32, height: 32, padding: 0 }}>
            <IconX style={{ width: 18, height: 18 }} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* Job context pill */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-light)', marginBottom: 20,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                {job?.job_number || 'No Job #'}
                {job?.insured_name && <span style={{ fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 6 }}>· {job.insured_name}</span>}
              </div>
              {job?.address && (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                  {job.address}{job.city ? `, ${job.city}` : ''}{job.state ? ` ${job.state}` : ''}
                </div>
              )}
            </div>
          </div>

          {/* Document type */}
          <div style={{ marginBottom: 18 }}>
            <div style={sectionLabel}>Document Type</div>
            {visibleGroups.map((g, gi) => (
              <div key={g.key} style={{ marginTop: gi === 0 ? 0 : 14 }}>
                <div style={groupLabel}>{g.label}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {DOC_TYPES.filter(d => d.group === g.key).map(d => {
                    const active = docType === d.key;
                    // Reconstruction Agreement uses amber accent to match signer page branding
                    const isRecon = d.key === 'recon_agreement';
                    const accent       = isRecon ? '#f59e0b' : 'var(--brand-primary)';
                    const accentFill   = isRecon ? '#f59e0b' : '#2563eb';
                    const accentShadow = isRecon ? '0 1px 4px rgba(245,158,11,0.28)' : '0 1px 4px rgba(37,99,235,0.25)';
                    return (
                      <button key={d.key} onClick={() => setDocType(d.key)}
                        style={{
                          padding: '9px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                          border: `2px solid ${active ? accent : 'var(--border-light)'}`,
                          background: active ? accentFill : 'var(--bg-primary)',
                          fontFamily: 'var(--font-sans)', fontSize: 12,
                          fontWeight: active ? 700 : 500,
                          color: active ? '#ffffff' : 'var(--text-secondary)',
                          textAlign: 'left', transition: 'all 0.12s',
                          boxShadow: active ? accentShadow : 'none',
                          gridColumn: d.fullWidth ? '1 / -1' : 'auto',
                        }}>
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Compose — Custom Authorization only */}
          {docType === 'other' && (
            <div style={{ marginBottom: 18 }}>
              <div style={{
                background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 'var(--radius-md)',
                padding: '9px 12px', marginBottom: 12, fontSize: 12, color: '#92400e', lineHeight: 1.5,
              }}>
                This wording is not reviewed by anyone before the client signs it. If one of the
                ready-made documents above fits, use that instead.
              </div>

              <div style={sectionLabel}>Start From</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {CUSTOM_DOC_SNIPPETS.map(s => {
                  const active = snippetKey === s.key;
                  return (
                    <button key={s.key} type="button" onClick={() => applySnippet(s.key)}
                      title={s.hint}
                      style={{
                        padding: '6px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                        border: `1px solid ${active ? 'var(--brand-primary)' : 'var(--border-light)'}`,
                        background: active ? '#eff6ff' : 'var(--bg-primary)',
                        color: active ? 'var(--brand-primary)' : 'var(--text-secondary)',
                        fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: active ? 700 : 500,
                      }}>
                      {s.label}
                    </button>
                  );
                })}
              </div>

              <label style={fieldLabel}>
                Document Title <span style={{ color: '#ef4444' }}>*</span>
                <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 6 }}>
                  {customHeading.length}/{CUSTOM_DOC_HEADING_MAX}
                </span>
              </label>
              <input className="input" type="text" value={customHeading}
                onChange={e => { setCustomHeading(e.target.value); setError(''); }}
                maxLength={CUSTOM_DOC_HEADING_MAX}
                placeholder="e.g. Authorization to Remove Damaged Cabinetry"
                style={{ height: 36, fontSize: 13, marginBottom: 12 }}
              />

              <label style={fieldLabel}>
                Document Text <span style={{ color: '#ef4444' }}>*</span>
                <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 6 }}>
                  {customBody.length}/{CUSTOM_DOC_BODY_MAX} · “## ” starts a section, **bold** for emphasis
                </span>
              </label>
              <textarea ref={bodyRef} className="input textarea" value={customBody}
                onChange={e => { setCustomBody(e.target.value); setError(''); }}
                maxLength={CUSTOM_DOC_BODY_MAX}
                rows={14}
                placeholder="Pick a starting point above, or write the document here."
                style={{ fontSize: 13, lineHeight: 1.6, resize: 'vertical', minHeight: 240, fontFamily: 'var(--font-mono, monospace)' }}
              />

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                {CUSTOM_DOC_TOKENS.map(t => (
                  <button key={t.key} type="button" onClick={() => insertToken(t.key)}
                    title={`Insert ${t.key}`}
                    style={{
                      padding: '3px 7px', borderRadius: 5, cursor: 'pointer',
                      border: '1px solid var(--border-light)', background: 'var(--bg-secondary)',
                      color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', fontSize: 10.5,
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8, lineHeight: 1.5 }}>
                Fill in every <strong>[bracketed]</strong> prompt — they print exactly as written.
                The client&rsquo;s name, the date and the signature block are added automatically.
              </div>
            </div>
          )}

          {/* Scope of work — CoC only */}
          {docType === 'coc' && (
            <div style={{ marginBottom: 18 }}>
              <div style={sectionLabel}>
                Scope of Work <span style={{ color: '#ef4444' }}>*</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {DIVISIONS.map(d => {
                  const active = divisions.includes(d.key);
                  return (
                    <label key={d.key} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px', borderRadius: 'var(--radius-md)',
                      border: `1px solid ${active ? 'var(--brand-primary)' : 'var(--border-light)'}`,
                      background: active ? 'var(--brand-primary)08' : 'var(--bg-primary)',
                      cursor: 'pointer', transition: 'all 0.12s',
                    }}>
                      <input type="checkbox" checked={active}
                        onChange={() => toggleDivision(d.key)}
                        style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--brand-primary)' }}
                      />
                      <span style={{ fontSize: 14 }}>{d.emoji}</span>
                      <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: 'var(--text-primary)' }}>
                        {d.label}
                      </span>
                    </label>
                  );
                })}
              </div>
              {divisions.length === 0 && (
                <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>
                  Select at least one scope of work.
                </div>
              )}
            </div>
          )}

          {/* Signer info */}
          <div style={{ marginBottom: 18 }}>
            <div style={sectionLabel}>Signer</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <label style={fieldLabel}>
                  Full Name <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input className="input" type="text" value={signerName}
                  onChange={e => { setSignerName(e.target.value); setError(''); }}
                  placeholder={loadingContact ? 'Loading…' : 'e.g. John Smith'}
                  disabled={loadingContact}
                  style={{ height: 36, fontSize: 13 }}
                />
              </div>
              <div>
                <label style={fieldLabel}>
                  Email
                  <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 6 }}>
                    {loadingContact ? 'fetching…' : 'only needed to email the link'}
                  </span>
                </label>
                <input className="input" type="email" value={signerEmail}
                  onChange={e => { setSignerEmail(e.target.value); setError(''); }}
                  placeholder={loadingContact ? 'Loading…' : 'e.g. john@example.com'}
                  disabled={loadingContact}
                  style={{ height: 36, fontSize: 13 }}
                />
                {!loadingContact && !signerEmail && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3 }}>
                    No email on contact — required for email delivery.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div ref={errorRef} role="alert" style={{
              background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: 'var(--radius-md)', padding: '10px 14px',
              fontSize: 13, color: '#dc2626', marginBottom: 4,
            }}>
              ⚠ {error}
              {/* A refused text still produced a sign request — surface its link
                  here so the work is recoverable without re-creating it. */}
              {signingUrl && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <a href={signingUrl} target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, fontSize: 11, color: 'var(--brand-primary)', wordBreak: 'break-all', textDecoration: 'none' }}>
                    {signingUrl}
                  </a>
                  <button className="btn btn-secondary btn-sm" onClick={copyUrl}
                    style={{ flexShrink: 0, fontSize: 11, height: 28 }}>
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{
          padding: '14px 24px env(safe-area-inset-bottom, 16px)', borderTop: '1px solid var(--border-color)',
          background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {/* Primary: collect on-site */}
          <button className="btn btn-primary" onClick={() => handleSend('collect')}
            disabled={!!sending || loadingContact}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 40 }}>
            {sending === 'collect'
              ? <><div className="spinner" style={{ width: 14, height: 14, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }}/> Opening…</>
              : <><span style={{ fontSize: 15 }}>✍️</span> Collect Signature Now</>}
          </button>

          {/* Secondary: text the link. Needs a linked contact — the number comes
              from that contact's conversation, never from this form. */}
          <button className="btn btn-secondary" onClick={() => handleSend('sms')}
            disabled={!!sending || loadingContact || !contactId}
            title={contactId ? undefined : 'No contact linked to this job'}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 40, opacity: contactId ? 1 : 0.5 }}>
            {sending === 'sms'
              ? <><div className="spinner" style={{ width: 14, height: 14 }}/> Sending…</>
              : <><span style={{ fontSize: 15 }}>💬</span> Send Link via Text</>}
          </button>

          {/* Secondary: send by email */}
          <button className="btn btn-secondary" onClick={() => handleSend('email')}
            disabled={!!sending || loadingContact}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 40 }}>
            {sending === 'email'
              ? <><div className="spinner" style={{ width: 14, height: 14 }}/> Sending…</>
              : <><span style={{ fontSize: 15 }}>✉️</span> Send Link via Email</>}
          </button>

          <button className="btn btn-ghost" onClick={onClose} disabled={!!sending}
            style={{ width: '100%', height: 36 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
