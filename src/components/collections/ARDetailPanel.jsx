import ARPaymentTimeline from './ARPaymentTimeline';

const fmtDollar = (v) => {
  if (v == null) return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const DIVISION_LABELS = {
  water: 'Water', mold: 'Mold', fire: 'Fire',
  reconstruction: 'Recon', contents: 'Contents', general: 'General',
};

const DIVISION_COLORS = {
  water: '#3b82f6', mold: '#ec4899', fire: '#ef4444',
  reconstruction: '#f59e0b', contents: '#10b981', general: '#6b7280',
};

export default function ARDetailPanel({ claim, payments, onRecordPayment, onJobClick, onDeletePayment, onClose }) {
  const invoiced = Number(claim.total_invoiced || 0);
  const collected = Number(claim.total_collected || 0);
  const outstanding = Number(claim.outstanding || 0);
  const pct = invoiced > 0 ? Math.round((collected / invoiced) * 100) : 0;
  const jobs = typeof claim.jobs === 'string' ? JSON.parse(claim.jobs) : (claim.jobs || []);

  return (
    <div className="ar-detail-panel">
      {/* Header */}
      <div className="ar-detail-header">
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {claim.claim_number || '—'}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{claim.client || 'Unknown'}</div>
          {claim.carrier && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{claim.carrier}</div>}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 18, padding: '0 4px', lineHeight: 1 }}>&times;</button>
      </div>

      {/* Summary strip */}
      <div className="ar-detail-summary">
        <div className="ar-detail-summary-item">
          <div className="ar-detail-summary-label">Invoiced</div>
          <div className="ar-detail-summary-value">{fmtDollar(invoiced)}</div>
        </div>
        <div className="ar-detail-summary-item">
          <div className="ar-detail-summary-label">Collected</div>
          <div className="ar-detail-summary-value" style={{ color: '#059669' }}>{fmtDollar(collected)}</div>
        </div>
        <div className="ar-detail-summary-item">
          <div className="ar-detail-summary-label">Outstanding</div>
          <div className="ar-detail-summary-value" style={{ color: outstanding > 0 ? '#dc2626' : '#059669' }}>{fmtDollar(outstanding)}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ padding: '0 20px 16px' }}>
        <div className="ar-claim-progress" style={{ height: 8 }}>
          <div className="ar-claim-progress-fill" style={{ width: `${Math.min(pct, 100)}%`, background: pct >= 100 ? '#10b981' : pct > 0 ? '#f59e0b' : 'var(--bg-tertiary)' }} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4, textAlign: 'right' }}>{pct}% collected</div>
      </div>

      {/* Jobs section */}
      <div className="ar-detail-section">
        <div className="ar-detail-section-title">Jobs ({jobs.length})</div>
        {jobs.map(job => {
          const jobInv = Number(job.invoiced || 0);
          const jobCol = Number(job.collected || 0);
          const jobBal = jobInv - jobCol;
          const jobPct = jobInv > 0 ? Math.round((jobCol / jobInv) * 100) : 0;
          return (
            <div key={job.job_id} className="ar-job-mini-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{ fontWeight: 700, fontSize: 13, cursor: 'pointer', color: 'var(--accent)' }}
                    onClick={() => onJobClick(job.job_id)}
                  >
                    {job.job_number}
                  </span>
                  <span className="ar-division-chip" style={{ background: `${DIVISION_COLORS[job.division] || '#6b7280'}15`, color: DIVISION_COLORS[job.division] || '#6b7280', border: `1px solid ${DIVISION_COLORS[job.division] || '#6b7280'}30`, fontSize: 10 }}>
                    {DIVISION_LABELS[job.division] || job.division}
                  </span>
                </div>
                <span style={{ fontWeight: 700, fontSize: 13, color: jobBal > 0 ? '#dc2626' : '#059669', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtDollar(jobBal)}
                </span>
              </div>
              <div className="ar-claim-progress" style={{ height: 4, marginBottom: 6 }}>
                <div className="ar-claim-progress-fill" style={{ width: `${Math.min(jobPct, 100)}%`, background: jobPct >= 100 ? '#10b981' : jobPct > 0 ? '#f59e0b' : 'var(--bg-tertiary)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  Inv: {fmtDollar(jobInv)} · Col: {fmtDollar(jobCol)}
                </span>
                <button
                  className="btn btn-sm btn-primary"
                  style={{ fontSize: 11, height: 26, padding: '0 10px' }}
                  onClick={() => onRecordPayment(job)}
                >
                  Record Payment
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Payment History */}
      <div className="ar-detail-section">
        <div className="ar-detail-section-title">Payment History</div>
        <ARPaymentTimeline payments={payments} onDelete={onDeletePayment} />
      </div>
    </div>
  );
}
