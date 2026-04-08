import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';

const fmtDollar = (v) => {
  if (v == null) return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'has_balance', label: 'Has Balance' },
  { key: 'paid', label: 'Paid in Full' },
];

export default function CollectionsOverview({ db, navigate }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.select('billing_overview', 'order=outstanding.desc');
      setRows(data || []);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to load billing data', type: 'error' } }));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let result = rows;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        (r.client || '').toLowerCase().includes(q) ||
        (r.claim_number || '').toLowerCase().includes(q)
      );
    }
    if (filter === 'has_balance') result = result.filter(r => Number(r.outstanding) > 0);
    if (filter === 'paid') result = result.filter(r => Number(r.outstanding) <= 0);
    return result;
  }, [rows, search, filter]);

  const totals = useMemo(() => {
    const sum = (key) => filtered.reduce((s, r) => s + Number(r[key] || 0), 0);
    return {
      mit_invoiced: sum('mit_invoiced'),
      mit_collected: sum('mit_collected'),
      recon_invoiced: sum('recon_invoiced'),
      recon_collected: sum('recon_collected'),
      total_invoiced: sum('total_invoiced'),
      total_collected: sum('total_collected'),
      outstanding: sum('outstanding'),
    };
  }, [filtered]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading...</div>;
  }

  return (
    <div>
      {/* Controls */}
      <div className="ar-controls">
        <input
          className="input"
          placeholder="Search client or claim #..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <div className="ar-tabs" style={{ marginLeft: 'auto' }}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`ar-tab${filter === f.key ? ' active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop Table */}
      <div className="ar-desktop-table">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Claim #</th>
              <th>Carrier</th>
              <th style={{ textAlign: 'right' }}>Mit Inv</th>
              <th style={{ textAlign: 'right' }}>Mit Col</th>
              <th style={{ textAlign: 'right' }}>Recon Inv</th>
              <th style={{ textAlign: 'right' }}>Recon Col</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th style={{ textAlign: 'right' }}>Collected</th>
              <th style={{ textAlign: 'right' }}>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => {
              const isExpanded = expandedId === row.claim_id;
              const outstanding = Number(row.outstanding || 0);
              return (
                <Fragment key={row.claim_id}>
                  <tr
                    className="ar-row"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setExpandedId(isExpanded ? null : row.claim_id)}
                  >
                    <td style={{ fontWeight: 600 }}>{row.client || '—'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{row.claim_number || '—'}</td>
                    <td>{row.carrier || '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(row.mit_invoiced)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(row.mit_collected)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(row.recon_invoiced)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(row.recon_collected)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(row.total_invoiced)}</td>
                    <td style={{ textAlign: 'right', color: '#059669', fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(row.total_collected)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: outstanding > 0 ? '#dc2626' : '#059669' }}>
                      {fmtDollar(row.outstanding)}
                    </td>
                  </tr>
                  {isExpanded && row.jobs && (
                    <tr className="co-expand-row">
                      <td colSpan={10} style={{ padding: '12px 16px', background: 'var(--bg-secondary)' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {(typeof row.jobs === 'string' ? JSON.parse(row.jobs) : row.jobs).map(job => (
                            <div
                              key={job.job_id}
                              className="co-job-card"
                              onClick={e => { e.stopPropagation(); navigate(`/jobs/${job.job_id}`); }}
                            >
                              <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{job.job_number}</span>
                              <span className="ar-phase-pill">{job.division}</span>
                              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                                Inv: {fmtDollar(job.invoiced)} &middot; Col: {fmtDollar(job.collected)}
                              </span>
                              <span style={{
                                fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 'var(--radius-full)',
                                background: job.ar_status === 'paid' ? '#ecfdf5' : job.ar_status === 'partial' ? '#fffbeb' : '#eff6ff',
                                color: job.ar_status === 'paid' ? '#059669' : job.ar_status === 'partial' ? '#d97706' : '#2563eb',
                              }}>
                                {job.ar_status || 'open'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="co-totals-row">
              <td colSpan={3} style={{ fontWeight: 700 }}>Totals ({filtered.length} claims)</td>
              <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(totals.mit_invoiced)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(totals.mit_collected)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(totals.recon_invoiced)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(totals.recon_collected)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(totals.total_invoiced)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: '#059669', fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(totals.total_collected)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: totals.outstanding > 0 ? '#dc2626' : '#059669', fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(totals.outstanding)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="ar-mobile-cards">
        {filtered.map(row => {
          const outstanding = Number(row.outstanding || 0);
          const isExpanded = expandedId === row.claim_id;
          return (
            <div key={row.claim_id} className="ar-mobile-card" onClick={() => setExpandedId(isExpanded ? null : row.claim_id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{row.client || '—'}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{row.claim_number || ''}</span>
              </div>
              {row.carrier && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 8 }}>{row.carrier}</div>}
              <div className="ar-mobile-card-rows">
                <div className="ar-mobile-card-row"><span>Total Invoiced</span><span style={{ fontWeight: 600 }}>{fmtDollar(row.total_invoiced)}</span></div>
                <div className="ar-mobile-card-row"><span>Collected</span><span style={{ color: '#059669', fontWeight: 600 }}>{fmtDollar(row.total_collected)}</span></div>
                <div className="ar-mobile-card-row"><span>Outstanding</span><span style={{ color: outstanding > 0 ? '#dc2626' : '#059669', fontWeight: 700 }}>{fmtDollar(row.outstanding)}</span></div>
              </div>
              {isExpanded && row.jobs && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {(typeof row.jobs === 'string' ? JSON.parse(row.jobs) : row.jobs).map(job => (
                    <div
                      key={job.job_id}
                      className="co-job-card"
                      onClick={e => { e.stopPropagation(); navigate(`/jobs/${job.job_id}`); }}
                    >
                      <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{job.job_number}</span>
                      <span className="ar-phase-pill">{job.division}</span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                        {fmtDollar(job.invoiced)} / {fmtDollar(job.collected)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          No claims match your filters
        </div>
      )}
    </div>
  );
}
