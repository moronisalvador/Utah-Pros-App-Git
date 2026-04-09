import { useState } from 'react';

const fmtDollar = (v) => {
  if (v == null) return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const PAYER_TYPES = [
  { value: 'insurance', label: 'Insurance' },
  { value: 'homeowner', label: 'Homeowner' },
  { value: 'mortgage_co', label: 'Mortgage Co' },
  { value: 'property_manager', label: 'Prop Mgr' },
  { value: 'other', label: 'Other' },
];

const PAYMENT_METHODS = [
  { value: '', label: '-- Method --' },
  { value: 'check', label: 'Check' },
  { value: 'ach', label: 'ACH' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'wire', label: 'Wire' },
  { value: 'cash', label: 'Cash' },
  { value: 'insurance_direct', label: 'Insurance Direct' },
  { value: 'other', label: 'Other' },
];

export default function ARPaymentSheet({ job, claim, onSubmit, onClose }) {
  const balance = Number(job.invoiced || 0) - Number(job.collected || 0);

  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [payerType, setPayerType] = useState('insurance');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [isDeductible, setIsDeductible] = useState(false);
  const [isDepreciationRelease, setIsDepreciationRelease] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const parsedAmount = parseFloat(amount) || 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (parsedAmount <= 0) return;

    setSubmitting(true);
    try {
      const payload = {
        job_id: job.job_id,
        amount: parsedAmount,
        payment_date: paymentDate,
        payer_type: payerType,
        _jobNumber: job.job_number, // stripped by ARPage before insert
      };
      if (paymentMethod) payload.payment_method = paymentMethod;
      if (referenceNumber.trim()) payload.reference_number = referenceNumber.trim();
      if (isDeductible) payload.is_deductible = true;
      if (isDepreciationRelease) payload.is_depreciation_release = true;
      if (notes.trim()) payload.notes = notes.trim();

      await onSubmit(payload);
    } catch {
      // error toast handled in ARPage
    } finally {
      setSubmitting(false);
    }
  };

  const fillBalance = () => {
    setAmount(balance.toFixed(2));
  };

  return (
    <div className="ar-sheet-overlay" onClick={onClose}>
      <div className="ar-sheet" onClick={e => e.stopPropagation()}>
        {/* Handle */}
        <div className="ar-sheet-handle" />

        {/* Context header */}
        <div className="ar-sheet-header">
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            Recording payment for {job.job_number}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            {claim.client || ''} · {job.division || ''}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#dc2626', marginTop: 4 }}>
            Balance: {fmtDollar(balance)}
          </div>
          <button className="ar-sheet-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="ar-sheet-body">
          {/* Amount with pay-full button */}
          <div className="form-group">
            <label className="label">Amount *</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                autoFocus
                style={{ flex: 1 }}
              />
              {balance > 0 && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={fillBalance} style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
                  Pay Full Balance
                </button>
              )}
            </div>
          </div>

          {/* Date */}
          <div className="form-group">
            <label className="label">Payment Date *</label>
            <input className="input" type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
          </div>

          {/* Source — pill selector */}
          <div className="form-group">
            <label className="label">Source *</label>
            <div className="ar-pill-selector">
              {PAYER_TYPES.map(pt => (
                <button
                  key={pt.value}
                  type="button"
                  className={`ar-pill-btn${payerType === pt.value ? ' active' : ''}`}
                  onClick={() => setPayerType(pt.value)}
                >
                  {pt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Method + Reference on same row */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="label">Method</label>
              <select className="input" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                {PAYMENT_METHODS.map(pm => (
                  <option key={pm.value} value={pm.value}>{pm.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="label">Reference #</label>
              <input className="input" placeholder="Check #, EFT..." value={referenceNumber} onChange={e => setReferenceNumber(e.target.value)} />
            </div>
          </div>

          {/* Toggles */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 'var(--space-3)' }}>
            <label className="ar-toggle-label" onClick={() => setIsDeductible(!isDeductible)}>
              <button type="button" className={`admin-toggle${isDeductible ? ' on' : ''}`} onClick={e => { e.stopPropagation(); setIsDeductible(!isDeductible); }}>
                <span className="admin-toggle-dot" />
              </button>
              <span>Deductible</span>
            </label>
            <label className="ar-toggle-label" onClick={() => setIsDepreciationRelease(!isDepreciationRelease)}>
              <button type="button" className={`admin-toggle${isDepreciationRelease ? ' on' : ''}`} onClick={e => { e.stopPropagation(); setIsDepreciationRelease(!isDepreciationRelease); }}>
                <span className="admin-toggle-dot" />
              </button>
              <span>Depreciation Release</span>
            </label>
          </div>

          {/* Notes — collapsed by default */}
          {!showNotes ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowNotes(true)} style={{ marginBottom: 'var(--space-3)' }}>
              + Add note
            </button>
          ) : (
            <div className="form-group">
              <textarea className="input textarea" placeholder="Notes..." value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', height: 44, fontSize: 14, fontWeight: 600 }}
            disabled={submitting || parsedAmount <= 0}
          >
            {submitting ? 'Recording...' : `Record ${parsedAmount > 0 ? fmtDollar(parsedAmount) : ''} Payment`}
          </button>
        </form>
      </div>
    </div>
  );
}
