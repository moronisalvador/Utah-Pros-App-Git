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

function getAgingColor(claim) {
  const ref = claim.last_updated || claim.date_of_loss;
  if (!ref) return '#ef4444';
  const days = Math.floor((Date.now() - new Date(ref).getTime()) / 86400000);
  if (days <= 30) return '#10b981';
  if (days <= 60) return '#f59e0b';
  return '#ef4444';
}

function getStatusLabel(claim) {
  const jobs = typeof claim.jobs === 'string' ? JSON.parse(claim.jobs) : (claim.jobs || []);
  const statuses = jobs.map(j => j.ar_status || 'open');
  if (statuses.every(s => s === 'paid')) return { label: 'Paid', color: '#059669', bg: '#ecfdf5' };
  if (statuses.some(s => s === 'partial')) return { label: 'Partial', color: '#d97706', bg: '#fffbeb' };
  if (statuses.some(s => s === 'disputed')) return { label: 'Disputed', color: '#dc2626', bg: '#fef2f2' };
  if (statuses.every(s => s === 'invoiced')) return { label: 'Invoiced', color: '#2563eb', bg: '#eff6ff' };
  return { label: 'Open', color: '#6b7280', bg: '#f3f4f6' };
}

function getDivisions(claim) {
  const jobs = typeof claim.jobs === 'string' ? JSON.parse(claim.jobs) : (claim.jobs || []);
  const divs = [...new Set(jobs.map(j => j.division).filter(Boolean))];
  return divs;
}

export default function ARClaimCard({ claim, isSelected, isExpanded, onClick, onRecordPayment, onJobClick, onViewClaim }) {
  const outstanding = Number(claim.outstanding || 0);
  const invoiced = Number(claim.total_invoiced || 0);
  const collected = Number(claim.total_collected || 0);
  const pct = invoiced > 0 ? Math.round((collected / invoiced) * 100) : 0;
  const agingColor = getAgingColor(claim);
  const status = getStatusLabel(claim);
  const divisions = getDivisions(claim);
  const jobs = typeof claim.jobs === 'string' ? JSON.parse(claim.jobs) : (claim.jobs || []);

  const progressColor = pct === 0 ? 'var(--bg-tertiary)' : pct >= 100 ? '#10b981' : pct >= 50 ? '#10b981' : '#f59e0b';

  return (
    <div className={`ar-claim-card${isSelected ? ' selected' : ''}`} style={{ '--card-accent': agingColor }} onClick={onClick}>
      {/* Header: client + outstanding */}
      <div className="ar-claim-card-header">
        <div className="ar-claim-card-client">{claim.client || 'Unknown'}</div>
        <div className="ar-claim-card-amount" style={{ color: outstanding > 0 ? '#dc2626' : '#059669' }}>
          {fmtDollar(outstanding)}
        </div>
      </div>

      {/* Meta: claim# + carrier */}
      <div className="ar-claim-card-meta">
        {claim.claim_number || '—'}
        {claim.carrier ? ` · ${claim.carrier}` : ''}
      </div>

      {/* Progress bar */}
      <div className="ar-claim-progress">
        <div
          className="ar-claim-progress-fill"
          style={{ width: `${Math.min(pct, 100)}%`, background: progressColor }}
        />
      </div>
      <div className="ar-claim-card-progress-label">
        <span>Inv: {fmtDollar(invoiced)}</span>
        <span>Col: {fmtDollar(collected)} ({pct}%)</span>
      </div>

      {/* Footer: division chips + status badge */}
      <div className="ar-claim-card-footer">
        <div className="ar-claim-card-chips">
          {divisions.map(d => (
            <span key={d} className="ar-division-chip" style={{ background: `${DIVISION_COLORS[d] || '#6b7280'}15`, color: DIVISION_COLORS[d] || '#6b7280', border: `1px solid ${DIVISION_COLORS[d] || '#6b7280'}30` }}>
              {DIVISION_LABELS[d] || d}
            </span>
          ))}
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{claim.job_count || jobs.length} job{(claim.job_count || jobs.length) !== 1 ? 's' : ''}</span>
        </div>
        <span className="ar-status-pill" style={{ background: status.bg, color: status.color }}>
          {status.label}
        </span>
      </div>

      {/* Expanded: show jobs */}
      {isExpanded && (
        <div className="ar-claim-card-expanded" onClick={e => e.stopPropagation()}>
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
                <div className="ar-claim-progress" style={{ height: 4, marginBottom: 4 }}>
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
          {onViewClaim && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ width: '100%', marginTop: 8, fontSize: 12 }}
              onClick={() => onViewClaim(claim.claim_id)}
            >
              View Full Claim →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
