/**
 * ════════════════════════════════════════════════
 * FILE: JobsClosed.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The drill-down page you land on when you click the "New Jobs Closed" tile on
 *   the Overview dashboard. It shows the actual list of jobs that were SOLD in the
 *   chosen time period — the same jobs the tile counted — so you can see exactly
 *   which deals make up that number. You can switch the period (this month, last
 *   30 days, this quarter, etc.) and tap any job to open it.
 *
 * WHERE IT LIVES:
 *   Route:        /jobs/closed   (?period=MTD|Prev mo|Last 30|QTD|YTD)
 *   Rendered by:  src/App.jsx (inside the Layout shell)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext (useAuth → db), @/lib/jobsClosed
 *              (fetchJobsClosed — the canonical sold-jobs-in-period query),
 *              @/lib/reportPeriods (period list + sublabels),
 *              @/components/DivisionIcons, @/components/PullToRefresh
 *   Data:      reads → get_jobs_closed() RPC + jobs table (via fetchJobsClosed)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is a THIN drill-down, deliberately built to fold into the future
 *     reporting tool: all the data logic lives in @/lib/jobsClosed +
 *     @/lib/reportPeriods, so a report can reuse the exact same query. This file
 *     is just presentation.
 *   - The list matches the dashboard tile by construction (same RPC + same period
 *     math). If the count ever looks off, fix the definition in the RPC, not here.
 *   - Reuses the existing .jobs-page / .job-list-card CSS vocabulary from the Jobs
 *     page so it needs no new styles.
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { fetchJobsClosed } from '@/lib/jobsClosed';
import { REPORT_PERIODS, PERIOD_SUBTITLE } from '@/lib/reportPeriods';
import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';
import PullToRefresh from '@/components/PullToRefresh';

// ─── SECTION: Helpers ──────────────

function formatDate(val) {
  if (!val) return null;
  return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCurrency(val) {
  if (val === null || val === undefined || val === 0) return null;
  return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Normalize a "sale source" code (real_job_source) into a short human badge.
const SOURCE_LABELS = {
  work_authorization: 'Work auth signed',
  reconstruction_agreement: 'Recon agreement',
  qbo_invoice: 'Invoiced',
  invoice: 'Invoiced',
  estimate_approved: 'Estimate approved',
};
function sourceLabel(src) {
  if (!src) return null;
  return SOURCE_LABELS[src] || src.replace(/_/g, ' ');
}

// ─── SECTION: Component ──────────────

export default function JobsClosed() {
  const { db } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Period comes from the URL (so the dashboard tile can deep-link the exact
  // period it's showing). Fall back to MTD for a missing/unknown value.
  const rawPeriod = searchParams.get('period');
  const period = REPORT_PERIODS.includes(rawPeriod) ? rawPeriod : 'MTD';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { rows: r } = await fetchJobsClosed(db, period);
      setRows(r);
    } catch (e) {
      console.error('JobsClosed load error:', e);
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [db, period]);

  useEffect(() => { load(); }, [load]);

  const setPeriod = (p) => {
    // Keep the period in the URL so the view is shareable/back-button friendly.
    setSearchParams((prev) => { prev.set('period', p); return prev; }, { replace: true });
  };

  // ─── SECTION: Render ──────────────

  return (
    <div className="jobs-page">
      {/* Header */}
      <div className="jobs-header">
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')} style={{ marginBottom: 6, paddingLeft: 0 }}>
            ← Overview
          </button>
          <h1 className="page-title">Jobs Closed</h1>
          <p className="page-subtitle">
            {loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'job' : 'jobs'} sold`} · {PERIOD_SUBTITLE[period]}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="input jobs-filter-select" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ minWidth: 130 }}>
            {REPORT_PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="loading-page"><div className="spinner" /></div>
      ) : error ? (
        <div style={{ padding: '24px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>Failed to load jobs closed</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 16 }}>{error}</div>
          <button className="btn btn-primary btn-sm" onClick={load}>Retry</button>
        </div>
      ) : (
        <PullToRefresh onRefresh={load} className="job-card-list">
          {rows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <div className="empty-state-text">No jobs closed in this period</div>
              <div className="empty-state-sub">Try a wider period like QTD or YTD</div>
            </div>
          ) : (
            rows.map((job) => (
              <ClosedJobCard key={job.id} job={job} onClick={() => navigate(`/jobs/${job.id}`)} />
            ))
          )}
        </PullToRefresh>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CLOSED JOB CARD  (compact — mirrors the Jobs page list card)
// ═══════════════════════════════════════════════════════════════

function ClosedJobCard({ job, onClick }) {
  const divColor = DIVISION_COLORS[job.division] || '#6b7280';
  const saleDate = formatDate(job.sale_date);
  const value = formatCurrency(job.approved_value) || formatCurrency(job.invoiced_value) || formatCurrency(job.estimated_value);
  const src = sourceLabel(job.sale_source);

  return (
    <div className="job-list-card" onClick={onClick}
      style={{ borderLeft: `3px solid ${divColor}`, borderRadius: 'var(--radius-md)' }}>
      <div className="job-list-card-body">
        {/* Row 1: Name + sale-source badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span className="job-list-card-name" style={{ flex: 1 }}>{job.insured_name || 'Unknown Client'}</span>
          {src && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
              background: '#ecfdf5', color: '#059669', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {src}
            </span>
          )}
        </div>

        {/* Row 2: Job number + division */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          {job.job_number && <span className="job-list-card-jobnumber">{job.job_number}</span>}
          {job.division && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-tertiary)' }}>
              <DivisionIcon type={job.division} size={12} />
              {job.division}
            </span>
          )}
        </div>

        {/* Row 3: Address */}
        {job.address && (
          <div className="job-list-card-address">{job.address}{job.city ? `, ${job.city}` : ''}{job.state ? `, ${job.state}` : ''}</div>
        )}

        {/* Row 4: Meta — sold date + insurer + value */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
          {saleDate && <span>Sold: {saleDate}</span>}
          {saleDate && job.insurance_company && <span style={{ color: 'var(--border-color)' }}>·</span>}
          {job.insurance_company && <span>{job.insurance_company}</span>}
          {value && (saleDate || job.insurance_company) && <span style={{ color: 'var(--border-color)' }}>·</span>}
          {value && <span>{value}</span>}
        </div>
      </div>
    </div>
  );
}
