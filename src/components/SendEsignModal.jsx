import { useState, useEffect } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const DOC_TYPES = [
  { key: 'coc',           label: 'Certificate of Completion' },
  { key: 'work_auth',     label: 'Work Authorization'        },
  { key: 'direction_pay', label: 'Direction of Pay'          },
  { key: 'change_order',  label: 'Change Order'              },
];

const DIVISIONS = [
  { key: 'water',          emoji: '💧', label: 'Water Mitigation'      },
  { key: 'mold',           emoji: '🧫', label: 'Mold Remediation'      },
  { key: 'reconstruction', emoji: '🏗️', label: 'Repairs & Recon'       },
  { key: 'fire',           emoji: '🔥', label: 'Fire & Smoke'          },
  { key: 'contents',       emoji: '📦', label: 'Contents'              },
];

function IconX(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}

export default function SendEsignModal({ job, currentUser, onClose, onSent }) {
  const [docType,        setDocType]        = useState('coc');
  const [signerName,     setSignerName]     = useState('');
  const [signerEmail,    setSignerEmail]    = useState('');
  const [contactId,      setContactId]      = useState(null);
  const [sending,        setSending]        = useState(false);
  const [divisions,      setDivisions]      = useState([]);
  const [error,          setError]          = useState('');
  const [done,           setDone]           = useState(false);
  const [signingUrl,     setSigningUrl]     = useState('');
  const [loadingContact, setLoadingContact] = useState(true);
  const [copied,         setCopied]         = useState(false);

  // Pre-seed division from job when CoC selected
  useEffect(() => {
    if (docType === 'coc' && job?.division) setDivisions([job.division]);
    else setDivisions([]);
  }, [docType, job?.division]);

  // Auto-fetch primary contact
  useEffect(() => {
    if (!job?.id) { setLoadingContact(false); return; }
    const fetch_ = async () => {
      try {
        let cid = null;
        for (const filter of [`is_primary=eq.true&`, ``]) {
          const res = await fetch(
            `${SUPABASE_URL}/rest/v1/contact_jobs?job_id=eq.${job.id}&${filter}limit=1&select=contact_id`,
            { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
          );
          const rows = await res.json();
          cid = rows?.[0]?.contact_id;
          if (cid) break;
        }
        if (!cid) { if (job.insured_name) setSignerName(job.insured_name); return; }
        const cRes = await fetch(
          `${SUPABASE_URL}/rest/v1/contacts?id=eq.${cid}&select=id,name,email`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        );
        const c = (await cRes.json())?.[0];
        if (!c) return;
        setContactId(c.id);
        if (c.name)  setSignerName(c.name);
        if (c.email) setSignerEmail(c.email);
      } catch {
        if (job.insured_name) setSignerName(job.insured_name);
      } finally {
        setLoadingContact(false);
      }
    };
    fetch_();
  }, [job?.id]);

  const toggleDivision = (key) =>
    setDivisions(prev =>
      prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key]
    );

  const handleSend = async (mode = 'email') => {
    setError('');
    if (docType === 'coc' && divisions.length === 0) { setError('Select at least one scope of work.'); return; }
    if (!signerName.trim())  { setError('Signer name is required.'); return; }
    if (mode === 'email') {
      if (!signerEmail.trim()) { setError('Signer email is required.'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) { setError('Enter a valid email address.'); return; }
    }

    setSending(mode);
    try {
      const res = await fetch('/api/send-esign', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id:       job.id,
          contact_id:   contactId || null,
          signer_name:  signerName.trim(),
          signer_email: signerEmail.trim() || `collect-${Date.now()}@noemail.local`,
          sent_by:      currentUser?.id,
          doc_type:     docType,
          divisions:    docType === 'coc' ? divisions : undefined,
          mode,
        }),
      });
      const raw = await res.text();
      let json;
      try { json = JSON.parse(raw); } catch { throw new Error(`Server error: ${raw.slice(0, 200)}`); }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      if (mode === 'collect') {
        window.open(json.signing_url, '_blank');
        window.dispatchEvent(new CustomEvent('upr:toast', { detail: {
          type: 'success', message: 'Signature page opened — hand device to client.',
        }}));
        onClose();
        onSent?.(json);
      } else {
        window.dispatchEvent(new CustomEvent('upr:toast', { detail: {
          type:    'success',
          message: json.email_error
            ? 'Sign request created — copy link to send manually.'
            : `Signing link sent to ${signerEmail.trim()}.`,
        }}));
        setSigningUrl(json.signing_url || '');
        setDone(true);
        onSent?.(json);
      }
    } catch (err) {
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
    return (
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
            <div style={{ fontSize: 44, marginBottom: 12 }}>✉️</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
              Link sent to {signerEmail}
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
      </div>
    );
  }

  // ── Form state ──
  return (
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {DOC_TYPES.map(d => {
                const active = docType === d.key;
                return (
                  <button key={d.key} onClick={() => setDocType(d.key)}
                    style={{
                      padding: '9px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                      border: `2px solid ${active ? 'var(--brand-primary)' : 'var(--border-light)'}`,
                      background: active ? '#2563eb' : 'var(--bg-primary)',
                      fontFamily: 'var(--font-sans)', fontSize: 12,
                      fontWeight: active ? 700 : 500,
                      color: active ? '#ffffff' : 'var(--text-secondary)',
                      textAlign: 'left', transition: 'all 0.12s',
                      boxShadow: active ? '0 1px 4px rgba(37,99,235,0.25)' : 'none',
                    }}>
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

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
                  Email <span style={{ color: '#ef4444' }}>*</span>
                  {loadingContact && <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 6 }}>fetching…</span>}
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
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: 'var(--radius-md)', padding: '10px 14px',
              fontSize: 13, color: '#dc2626', marginBottom: 4,
            }}>
              ⚠ {error}
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
    </div>
  );
}

const sectionLabel = {
  fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
};

const fieldLabel = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: 'var(--text-secondary)', marginBottom: 4,
};
