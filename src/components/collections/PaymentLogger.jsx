import { useState, useEffect, useCallback, useRef } from 'react';

const toast = (msg, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type } }));

const fmtDollar = (v) => {
  if (v == null) return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtDate = (v) =>
  v ? new Date(v + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';

const todayISO = () => new Date().toISOString().slice(0, 10);

const PAYER_TYPES = [
  { value: 'insurance', label: 'Insurance' },
  { value: 'homeowner', label: 'Homeowner' },
  { value: 'mortgage_co', label: 'Mortgage Co' },
  { value: 'property_manager', label: 'Property Manager' },
  { value: 'other', label: 'Other' },
];

const PAYMENT_METHODS = [
  { value: '', label: '-- Select --' },
  { value: 'check', label: 'Check' },
  { value: 'ach', label: 'ACH' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'wire', label: 'Wire' },
  { value: 'cash', label: 'Cash' },
  { value: 'insurance_direct', label: 'Insurance Direct' },
  { value: 'other', label: 'Other' },
];

export default function PaymentLogger({ db }) {
  // Job list for dropdown
  const [jobs, setJobs] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [jobId, setJobId] = useState('');
  const [jobSearch, setJobSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [payerType, setPayerType] = useState('insurance');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [isDeductible, setIsDeductible] = useState(false);
  const [isDepreciationRelease, setIsDepreciationRelease] = useState(false);
  const [notes, setNotes] = useState('');

  // Delete confirmation
  const [confirmDel, setConfirmDel] = useState(null);

  const dropdownRef = useRef(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [jobsList, paymentsList] = await Promise.all([
        db.select('jobs', 'select=id,job_number,insured_name,division,invoiced_value,collected_value,claim_id&invoiced_value=gt.0&order=insured_name'),
        db.select('payments', 'order=created_at.desc&limit=25&select=*,jobs(job_number,insured_name,division)'),
      ]);
      setJobs(jobsList || []);
      setPayments(paymentsList || []);
    } catch (e) {
      toast('Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { loadData(); }, [loadData]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectedJob = jobs.find(j => j.id === jobId);

  const filteredJobs = jobs.filter(j => {
    if (!jobSearch) return true;
    const q = jobSearch.toLowerCase();
    return (j.job_number || '').toLowerCase().includes(q) ||
           (j.insured_name || '').toLowerCase().includes(q) ||
           (j.division || '').toLowerCase().includes(q);
  });

  const resetForm = () => {
    setJobId('');
    setJobSearch('');
    setAmount('');
    setPaymentDate(todayISO());
    setPayerType('insurance');
    setPaymentMethod('');
    setReferenceNumber('');
    setIsDeductible(false);
    setIsDepreciationRelease(false);
    setNotes('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!jobId) { toast('Please select a job', 'error'); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast('Amount must be greater than 0', 'error'); return; }
    if (!payerType) { toast('Please select a payment source', 'error'); return; }

    setSubmitting(true);
    try {
      const payload = {
        job_id: jobId,
        amount: amt,
        payment_date: paymentDate,
        payer_type: payerType,
      };
      if (paymentMethod) payload.payment_method = paymentMethod;
      if (referenceNumber.trim()) payload.reference_number = referenceNumber.trim();
      if (isDeductible) payload.is_deductible = true;
      if (isDepreciationRelease) payload.is_depreciation_release = true;
      if (notes.trim()) payload.notes = notes.trim();

      await db.insert('payments', payload);

      const jobNum = selectedJob?.job_number || '';
      toast(`Payment of ${fmtDollar(amt)} recorded for ${jobNum}`);
      resetForm();

      // Refresh payments list
      const fresh = await db.select('payments', 'order=created_at.desc&limit=25&select=*,jobs(job_number,insured_name,division)');
      setPayments(fresh || []);
    } catch (e) {
      toast('Failed to record payment: ' + (e.message || e), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (paymentId) => {
    if (confirmDel !== paymentId) { setConfirmDel(paymentId); return; }
    setConfirmDel(null);
    try {
      await db.delete('payments', `id=eq.${paymentId}`);
      toast('Payment deleted');
      const fresh = await db.select('payments', 'order=created_at.desc&limit=25&select=*,jobs(job_number,insured_name,division)');
      setPayments(fresh || []);
    } catch (e) {
      toast('Failed to delete payment', 'error');
    }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading...</div>;
  }

  return (
    <div className="pl-layout">
      {/* Form Panel */}
      <div className="pl-form-panel">
        <div className="card">
          <div className="card-header"><span className="card-title">Record Payment</span></div>
          <div className="card-body">
            <form onSubmit={handleSubmit}>
              {/* Job Select */}
              <div className="form-group" ref={dropdownRef} style={{ position: 'relative' }}>
                <label className="label">Job *</label>
                <input
                  className="input"
                  placeholder="Search jobs..."
                  value={selectedJob ? `${selectedJob.job_number} — ${selectedJob.insured_name || ''} (${selectedJob.division || ''})` : jobSearch}
                  onChange={e => { setJobSearch(e.target.value); setJobId(''); setShowDropdown(true); }}
                  onFocus={() => setShowDropdown(true)}
                />
                {showDropdown && (
                  <div className="pl-job-dropdown">
                    {filteredJobs.length === 0 && (
                      <div style={{ padding: '8px 12px', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>No jobs found</div>
                    )}
                    {filteredJobs.map(j => (
                      <div
                        key={j.id}
                        className="pl-job-option"
                        onMouseDown={() => { setJobId(j.id); setJobSearch(''); setShowDropdown(false); }}
                      >
                        <span style={{ fontWeight: 600 }}>{j.job_number}</span>
                        <span style={{ color: 'var(--text-secondary)' }}> — {j.insured_name || 'Unknown'}</span>
                        <span style={{ color: 'var(--text-tertiary)' }}> ({j.division || ''})</span>
                        <span style={{ float: 'right', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                          Inv: {fmtDollar(j.invoiced_value)} | Col: {fmtDollar(j.collected_value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Amount */}
              <div className="form-group">
                <label className="label">Amount *</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                />
              </div>

              {/* Payment Date */}
              <div className="form-group">
                <label className="label">Payment Date *</label>
                <input
                  className="input"
                  type="date"
                  value={paymentDate}
                  onChange={e => setPaymentDate(e.target.value)}
                />
              </div>

              {/* Source (payer_type) */}
              <div className="form-group">
                <label className="label">Source *</label>
                <select className="input" value={payerType} onChange={e => setPayerType(e.target.value)}>
                  {PAYER_TYPES.map(pt => (
                    <option key={pt.value} value={pt.value}>{pt.label}</option>
                  ))}
                </select>
              </div>

              {/* Method */}
              <div className="form-group">
                <label className="label">Method</label>
                <select className="input" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                  {PAYMENT_METHODS.map(pm => (
                    <option key={pm.value} value={pm.value}>{pm.label}</option>
                  ))}
                </select>
              </div>

              {/* Reference # */}
              <div className="form-group">
                <label className="label">Reference #</label>
                <input
                  className="input"
                  placeholder="Check #, EFT ref, etc."
                  value={referenceNumber}
                  onChange={e => setReferenceNumber(e.target.value)}
                />
              </div>

              {/* Toggles */}
              <div className="pl-toggle-row">
                <label className="label" style={{ marginBottom: 0 }}>Is Deductible</label>
                <button
                  type="button"
                  className={`admin-toggle${isDeductible ? ' on' : ''}`}
                  onClick={() => setIsDeductible(!isDeductible)}
                >
                  <span className="admin-toggle-dot" />
                </button>
              </div>
              <div className="pl-toggle-row">
                <label className="label" style={{ marginBottom: 0 }}>Is Depreciation Release</label>
                <button
                  type="button"
                  className={`admin-toggle${isDepreciationRelease ? ' on' : ''}`}
                  onClick={() => setIsDepreciationRelease(!isDepreciationRelease)}
                >
                  <span className="admin-toggle-dot" />
                </button>
              </div>

              {/* Notes */}
              <div className="form-group" style={{ marginTop: 'var(--space-3)' }}>
                <label className="label">Notes</label>
                <textarea
                  className="input textarea"
                  placeholder="Optional notes..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 'var(--space-3)' }} disabled={submitting}>
                {submitting ? 'Recording...' : 'Record Payment'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Recent Payments Panel */}
      <div className="pl-recent-panel">
        <div className="card">
          <div className="card-header"><span className="card-title">Recent Payments</span></div>
          <div className="card-body" style={{ padding: 0 }}>
            {payments.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)' }}>No payments recorded yet</div>
            ) : (
              <div className="ar-desktop-table">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Job #</th>
                      <th>Client</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Source</th>
                      <th>Method</th>
                      <th>Ref #</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(p => {
                      const jobInfo = p.jobs;
                      return (
                        <tr key={p.id} className="ar-row">
                          <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.payment_date)}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{jobInfo?.job_number || '—'}</td>
                          <td>{jobInfo?.insured_name || '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(p.amount)}</td>
                          <td>{PAYER_TYPES.find(pt => pt.value === p.payer_type)?.label || p.payer_type || '—'}</td>
                          <td>{PAYMENT_METHODS.find(pm => pm.value === p.payment_method)?.label || p.payment_method || '—'}</td>
                          <td>{p.reference_number || '—'}</td>
                          <td>
                            <button
                              className="btn btn-sm btn-ghost"
                              style={{
                                color: confirmDel === p.id ? '#dc2626' : 'var(--text-tertiary)',
                                background: confirmDel === p.id ? '#fef2f2' : 'transparent',
                                border: confirmDel === p.id ? '1px solid #fecaca' : '1px solid transparent',
                              }}
                              onClick={() => handleDelete(p.id)}
                              onBlur={() => setConfirmDel(null)}
                            >
                              {confirmDel === p.id ? 'Confirm' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Mobile payment cards */}
            <div className="pl-mobile-payments">
              {payments.map(p => {
                const jobInfo = p.jobs;
                return (
                  <div key={p.id} className="ar-mobile-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontWeight: 600 }}>{fmtDollar(p.amount)}</span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{fmtDate(p.payment_date)}</span>
                    </div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 4 }}>
                      {jobInfo?.job_number} — {jobInfo?.insured_name || 'Unknown'}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {PAYER_TYPES.find(pt => pt.value === p.payer_type)?.label || '—'}
                        {p.payment_method ? ` / ${PAYMENT_METHODS.find(pm => pm.value === p.payment_method)?.label || ''}` : ''}
                        {p.reference_number ? ` #${p.reference_number}` : ''}
                      </span>
                      <button
                        className="btn btn-sm btn-ghost"
                        style={{
                          color: confirmDel === p.id ? '#dc2626' : 'var(--text-tertiary)',
                          background: confirmDel === p.id ? '#fef2f2' : 'transparent',
                          fontSize: 11,
                        }}
                        onClick={() => handleDelete(p.id)}
                        onBlur={() => setConfirmDel(null)}
                      >
                        {confirmDel === p.id ? 'Confirm' : 'Delete'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
