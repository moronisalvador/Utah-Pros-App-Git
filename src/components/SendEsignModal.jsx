import { useState, useEffect } from 'react';

const DOC_TYPES = [
  { key: 'coc',           label: 'Certificate of Completion' },
  { key: 'work_auth',     label: 'Work Authorization' },
  { key: 'direction_pay', label: 'Direction of Pay' },
  { key: 'change_order',  label: 'Change Order' },
];

export default function SendEsignModal({ job, contacts, currentUser, onClose, onSent }) {
  const [docType,      setDocType]      = useState('coc');
  const [signerName,   setSignerName]   = useState('');
  const [signerEmail,  setSignerEmail]  = useState('');
  const [selectedContact, setSelectedContact] = useState('');
  const [sending,      setSending]      = useState(false);
  const [error,        setError]        = useState('');
  const [done,         setDone]         = useState(false);
  const [signingUrl,   setSigningUrl]   = useState('');

  // Pre-fill from job primary contact if available
  useEffect(() => {
    if (job?.insured_name) setSignerName(job.insured_name);
  }, [job]);

  // Auto-fill when contact is selected
  const handleContactSelect = (contactId) => {
    setSelectedContact(contactId);
    if (!contactId) return;
    const c = contacts?.find(c => c.id === contactId);
    if (!c) return;
    if (c.full_name)   setSignerName(c.full_name);
    if (c.email)       setSignerEmail(c.email);
  };

  const handleSend = async () => {
    if (!signerName.trim())  { setError('Signer name is required.');  return; }
    if (!signerEmail.trim()) { setError('Signer email is required.'); return; }
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRx.test(signerEmail)) { setError('Enter a valid email address.'); return; }

    setError('');
    setSending(true);
    try {
      const res = await fetch('/api/send-esign', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id:       job.id,
          contact_id:   selectedContact || null,
          signer_name:  signerName.trim(),
          signer_email: signerEmail.trim(),
          sent_by:      currentUser?.id,
          doc_type:     docType,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to send');
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

        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">Send for Signature</h2>
          <button className="btn btn-ghost btn-sm modal-close" onClick={onClose}>✕</button>
        </div>

        {done ? (
          /* ── Success state ── */
          <div style={{ padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✉️</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
              Sent Successfully
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Signing link sent to <strong>{signerEmail}</strong>.
              The document will appear in the Files tab once signed.
            </p>
            {signingUrl && (
              <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 14px', marginBottom: 20 }}>
                <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Signing Link
                </p>
                <a href={signingUrl} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 12, color: 'var(--brand-primary)', wordBreak: 'break-all', textDecoration: 'none' }}>
                  {signingUrl}
                </a>
              </div>
            )}
            <button className="btn btn-primary" onClick={onClose} style={{ width: '100%' }}>Done</button>
          </div>
        ) : (
          /* ── Form state ── */
          <div style={{ padding: '20px 24px 24px' }}>

            {/* Document type */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Document Type</label>
              <select className="input" value={docType} onChange={e => setDocType(e.target.value)}
                style={{ height: 38, fontSize: 'var(--text-sm)' }}>
                {DOC_TYPES.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </div>

            {/* Contact picker (if contacts passed in) */}
            {contacts && contacts.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Select Contact <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(optional — auto-fills fields)</span></label>
                <select className="input" value={selectedContact} onChange={e => handleContactSelect(e.target.value)}
                  style={{ height: 38, fontSize: 'var(--text-sm)' }}>
                  <option value="">— Pick a contact —</option>
                  {contacts.map(c => (
                    <option key={c.id} value={c.id}>{c.full_name}{c.email ? ` · ${c.email}` : ''}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Signer name */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Signer Full Name <span style={{ color: '#ef4444' }}>*</span></label>
              <input className="input" type="text" value={signerName}
                onChange={e => { setSignerName(e.target.value); setError(''); }}
                placeholder="e.g. John Smith"
                style={{ height: 38, fontSize: 'var(--text-sm)' }} />
            </div>

            {/* Signer email */}
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Signer Email <span style={{ color: '#ef4444' }}>*</span></label>
              <input className="input" type="email" value={signerEmail}
                onChange={e => { setSignerEmail(e.target.value); setError(''); }}
                placeholder="e.g. john@example.com"
                style={{ height: 38, fontSize: 'var(--text-sm)' }} />
            </div>

            {/* Job info preview */}
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--text-primary)' }}>{job?.job_number || 'No Job #'}</strong>
              {' · '}{job?.insured_name || '—'}
              {job?.address && <><br />{job.address}{job.city ? `, ${job.city}` : ''}{job.state ? ` ${job.state}` : ''}</>}
            </div>

            {/* Error */}
            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#dc2626' }}>
                ⚠ {error}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" onClick={onClose} disabled={sending} style={{ flex: 1 }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSend} disabled={sending} style={{ flex: 2 }}>
                {sending ? 'Sending…' : '✉ Send Signing Link'}
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

const labelStyle = {
  display:       'block',
  fontSize:      11,
  fontWeight:    700,
  color:         'var(--text-tertiary)',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  marginBottom:  6,
};
