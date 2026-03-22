import { useState, useEffect } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const DOC_TYPES = [
  { key: 'coc',           label: 'Certificate of Completion' },
  { key: 'work_auth',     label: 'Work Authorization' },
  { key: 'direction_pay', label: 'Direction of Pay' },
  { key: 'change_order',  label: 'Change Order' },
];

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

  // ── Pre-check job division when coc selected ──
  useEffect(() => {
    if (docType === 'coc' && job?.division) setDivisions([job.division]);
    else setDivisions([]);
  }, [docType, job?.division]);

  // ── Auto-fetch primary contact on mount ──
  useEffect(() => {
    if (!job?.id) { setLoadingContact(false); return; }

    const fetchPrimaryContact = async () => {
      try {
        // Try primary contact first, fall back to any contact on the job
        let cid = null;
        for (const filter of [`is_primary=eq.true&`, ``]) {
          const res = await fetch(
            `${SUPABASE_URL}/rest/v1/contact_jobs?job_id=eq.${job.id}&${filter}limit=1&select=contact_id`,
            { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
          );
          const rows = await res.json();
          cid = rows?.[0]?.contact_id;
          if (cid) break;
        }

        if (!cid) {
          if (job.insured_name) setSignerName(job.insured_name);
          return;
        }

        const cRes = await fetch(
          `${SUPABASE_URL}/rest/v1/contacts?id=eq.${cid}&select=id,name,email`,
          { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
        );
        const contacts = await cRes.json();
        const c = contacts?.[0];
        if (!c) return;

        setContactId(c.id);
        if (c.name) setSignerName(c.name);
        if (c.email)     setSignerEmail(c.email);

      } catch (err) {
        console.warn('Could not fetch primary contact:', err.message);
        if (job.insured_name) setSignerName(job.insured_name);
      } finally {
        setLoadingContact(false);
      }
    };

    fetchPrimaryContact();
  }, [job?.id]);

  const handleSend = async () => {
    if (docType === 'coc' && divisions.length === 0) { setError('Select at least one scope of work.'); return; }
    if (!signerName.trim())  { setError('Signer name is required.');  return; }
    if (!signerEmail.trim()) { setError('Signer email is required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) { setError('Enter a valid email address.'); return; }

    setError('');
    setSending(true);
    try {
      const res = await fetch('/api/send-esign', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id:       job.id,
          contact_id:   contactId || null,
          signer_name:  signerName.trim(),
          signer_email: signerEmail.trim(),
          sent_by:      currentUser?.id,
          doc_type:     docType,
          divisions:    docType === 'coc' ? divisions : undefined,
        }),
      });
      let json;
      const rawText = await res.text();
      try { json = JSON.parse(rawText); } catch { throw new Error(`Server error: ${rawText.slice(0, 200)}`); }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}: ${rawText.slice(0, 200)}`);
      setSigningUrl(json.signing_url || '');
      setDone(true);
      if (onSent) onSent(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel" style={{ maxWidth: 460 }}>

        <div className="modal-header">
          <h2 className="modal-title">Send for Signature</h2>
          <button className="btn btn-ghost btn-sm modal-close" onClick={onClose}>✕</button>
        </div>

        {done ? (
          <div style={{ padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✉️</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>Sent Successfully</h3>
            <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Signing link sent to <strong>{signerEmail}</strong>.<br />
              The signed document will appear in the Files tab once complete.
            </p>
            {signingUrl && (
              <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 14px', marginBottom: 20 }}>
                <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Signing Link (backup)</p>
                <a href={signingUrl} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 12, color: 'var(--brand-primary)', wordBreak: 'break-all', textDecoration: 'none' }}>
                  {signingUrl}
                </a>
              </div>
            )}
            <button className="btn btn-primary" onClick={onClose} style={{ width: '100%' }}>Done</button>
          </div>
        ) : (
          <div style={{ padding: '20px 24px 24px' }}>

            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Document Type</label>
              <select className="input" value={docType} onChange={e => setDocType(e.target.value)} style={{ height: 38, fontSize: 'var(--text-sm)' }}>
                {DOC_TYPES.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </div>

            {/* Division checkboxes — only for CoC */}
            {docType === 'coc' && (
              <div style={{ marginBottom: 16 }}>
                <label style={lbl}>Scope of Work <span style={{ color: '#ef4444' }}>*</span></label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                  {[
                    { key: 'water',          label: '💧 Water Damage Mitigation' },
                    { key: 'mold',           label: '🧫 Mold Remediation' },
                    { key: 'reconstruction', label: '🏗️ Repairs & Reconstruction' },
                    { key: 'fire',           label: '🔥 Fire & Smoke Restoration' },
                    { key: 'contents',       label: '📦 Contents Restoration' },
                  ].map(d => (
                    <label key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)', fontWeight: divisions.includes(d.key) ? 600 : 400 }}>
                      <input type="checkbox"
                        checked={divisions.includes(d.key)}
                        onChange={e => setDivisions(prev => e.target.checked ? [...prev, d.key] : prev.filter(x => x !== d.key))}
                        style={{ width: 15, height: 15, cursor: 'pointer' }}
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
                {docType === 'coc' && divisions.length === 0 && (
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: '#ef4444' }}>Select at least one scope of work.</p>
                )}
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Signer Full Name <span style={{ color: '#ef4444' }}>*</span></label>
              <input className="input" type="text" value={signerName}
                onChange={e => { setSignerName(e.target.value); setError(''); }}
                placeholder={loadingContact ? 'Loading…' : 'e.g. John Smith'}
                disabled={loadingContact}
                style={{ height: 38, fontSize: 'var(--text-sm)' }} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={lbl}>
                Signer Email <span style={{ color: '#ef4444' }}>*</span>
                {loadingContact && <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 6 }}>fetching…</span>}
              </label>
              <input className="input" type="email" value={signerEmail}
                onChange={e => { setSignerEmail(e.target.value); setError(''); }}
                placeholder={loadingContact ? 'Loading…' : 'e.g. john@example.com'}
                disabled={loadingContact}
                style={{ height: 38, fontSize: 'var(--text-sm)' }} />
              {!loadingContact && !signerEmail && (
                <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-tertiary)' }}>No email on contact — enter manually.</p>
              )}
            </div>

            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--text-primary)' }}>{job?.job_number || 'No Job #'}</strong>
              {' · '}{job?.insured_name || '—'}
              {job?.address && <><br />{job.address}{job.city ? `, ${job.city}` : ''}{job.state ? ` ${job.state}` : ''}</>}
            </div>

            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#dc2626' }}>
                ⚠ {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" onClick={onClose} disabled={sending} style={{ flex: 1 }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSend} disabled={sending || loadingContact} style={{ flex: 2 }}>
                {sending ? 'Sending…' : 'Send Signing Link'}
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

const lbl = {
  display: 'block', fontSize: 11, fontWeight: 700,
  color: 'var(--text-tertiary)', letterSpacing: '0.05em',
  textTransform: 'uppercase', marginBottom: 6,
};
