import { useState } from 'react';

const fmtDollar = (v) => {
  if (v == null) return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtDate = (v) =>
  v ? new Date(v + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';

const PAYER_COLORS = {
  insurance: '#3b82f6',
  homeowner: '#10b981',
  mortgage_co: '#8b5cf6',
  property_manager: '#f59e0b',
  other: '#6b7280',
};

const PAYER_LABELS = {
  insurance: 'Insurance',
  homeowner: 'Homeowner',
  mortgage_co: 'Mortgage Co',
  property_manager: 'Prop Mgr',
  other: 'Other',
};

export default function ARPaymentTimeline({ payments, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(null);

  const handleDelete = (id) => {
    if (confirmDel !== id) { setConfirmDel(id); return; }
    setConfirmDel(null);
    onDelete(id);
  };

  if (!payments || payments.length === 0) {
    return (
      <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
        No payments recorded
      </div>
    );
  }

  return (
    <div className="ar-payment-timeline">
      {payments.map(p => {
        const dotColor = PAYER_COLORS[p.payer_type] || '#6b7280';
        const jobInfo = p.jobs;
        return (
          <div key={p.id} className="ar-timeline-item">
            <div className="ar-timeline-dot" style={{ background: dotColor }} />
            <div className="ar-timeline-content">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(p.amount)}</span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{fmtDate(p.payment_date)}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                {jobInfo?.job_number || '—'} · {PAYER_LABELS[p.payer_type] || p.payer_type || '—'}
                {p.payment_method ? ` · ${p.payment_method}` : ''}
                {p.reference_number ? ` #${p.reference_number}` : ''}
              </div>
              {p.notes && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2, fontStyle: 'italic' }}>{p.notes}</div>}
              <button
                className="btn btn-sm btn-ghost"
                style={{
                  marginTop: 4, fontSize: 11, height: 22, padding: '0 6px',
                  color: confirmDel === p.id ? '#dc2626' : 'var(--text-tertiary)',
                  background: confirmDel === p.id ? '#fef2f2' : 'transparent',
                }}
                onClick={() => handleDelete(p.id)}
                onBlur={() => setConfirmDel(null)}
              >
                {confirmDel === p.id ? 'Confirm Delete' : 'Delete'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
