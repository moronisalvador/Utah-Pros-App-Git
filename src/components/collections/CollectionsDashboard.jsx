import { useState, useEffect, useMemo, useCallback } from 'react';

const fmtDollar = (v) => {
  if (v == null) return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtKilo = (v) => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(0) + 'k';
  return '$' + Math.round(n);
};

const AR_STATUS_LABELS = {
  open: 'Open',
  invoiced: 'Invoiced',
  partial: 'Partial',
  paid: 'Paid',
  disputed: 'Disputed',
  written_off: 'Written Off',
};

export default function CollectionsDashboard({ db }) {
  const [billingData, setBillingData] = useState([]);
  const [arJobs, setArJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [billing, arJobsData] = await Promise.all([
        db.select('billing_overview', 'order=outstanding.desc'),
        db.select('jobs', 'select=ar_status,invoiced_value,collected_value&invoiced_value=gt.0'),
      ]);
      setBillingData(billing || []);
      setArJobs(arJobsData || []);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to load dashboard data', type: 'error' } }));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  // KPI aggregation
  const kpis = useMemo(() => {
    const sum = (key) => billingData.reduce((s, r) => s + Number(r[key] || 0), 0);
    const billed = sum('total_invoiced');
    const collected = sum('total_collected');
    const outstanding = sum('outstanding');
    return {
      billed,
      collected,
      outstanding,
      rate: billed > 0 ? Math.round((collected / billed) * 100) : 0,
      mitBilled: sum('mit_invoiced'),
      reconBilled: sum('recon_invoiced'),
    };
  }, [billingData]);

  // Carrier breakdown
  const carrierData = useMemo(() => {
    const map = {};
    billingData.forEach(r => {
      const key = (r.carrier || 'Unknown').toUpperCase().trim();
      if (!map[key]) map[key] = { carrier: key, claims: 0, billed: 0, collected: 0, outstanding: 0 };
      map[key].claims += 1;
      map[key].billed += Number(r.total_invoiced || 0);
      map[key].collected += Number(r.total_collected || 0);
      map[key].outstanding += Number(r.outstanding || 0);
    });
    return Object.values(map).sort((a, b) => b.outstanding - a.outstanding);
  }, [billingData]);

  // AR Status breakdown
  const arStatusData = useMemo(() => {
    const map = {};
    arJobs.forEach(j => {
      const status = j.ar_status || 'open';
      if (!map[status]) map[status] = { status, count: 0, invoiced: 0, collected: 0, outstanding: 0 };
      map[status].count += 1;
      const inv = Number(j.invoiced_value || 0);
      const col = Number(j.collected_value || 0);
      map[status].invoiced += inv;
      map[status].collected += col;
      map[status].outstanding += (inv - col);
    });
    return Object.values(map).sort((a, b) => b.outstanding - a.outstanding);
  }, [arJobs]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading...</div>;
  }

  return (
    <div>
      {/* KPI Strip */}
      <div className="ar-kpi-strip">
        <KPI label="Total Billed" value={fmtKilo(kpis.billed)} sub={fmtDollar(kpis.billed)} color="#2563eb" />
        <KPI label="Total Collected" value={fmtKilo(kpis.collected)} sub={fmtDollar(kpis.collected)} color="#059669" />
        <KPI label="Outstanding" value={fmtKilo(kpis.outstanding)} sub={fmtDollar(kpis.outstanding)} color="#dc2626" alert={kpis.outstanding > 0} />
        <KPI label="Collection Rate" value={`${kpis.rate}%`} sub={`${billingData.length} claims`} color="#d97706" />
        <KPI label="Mit Billed" value={fmtKilo(kpis.mitBilled)} sub={fmtDollar(kpis.mitBilled)} color="#60a5fa" />
        <KPI label="Recon Billed" value={fmtKilo(kpis.reconBilled)} sub={fmtDollar(kpis.reconBilled)} color="#34d399" />
      </div>

      {/* Two-column grid */}
      <div className="cd-grid">
        {/* Outstanding by Carrier */}
        <div className="card">
          <div className="card-header"><span className="card-title">Outstanding by Carrier</span></div>
          <div className="card-body" style={{ padding: 0 }}>
            <div className="ar-desktop-table">
              <table>
                <thead>
                  <tr>
                    <th>Carrier</th>
                    <th style={{ textAlign: 'right' }}># Claims</th>
                    <th style={{ textAlign: 'right' }}>Billed</th>
                    <th style={{ textAlign: 'right' }}>Collected</th>
                    <th style={{ textAlign: 'right' }}>Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {carrierData.map(c => (
                    <tr key={c.carrier} className="ar-row">
                      <td style={{ fontWeight: 600 }}>{c.carrier}</td>
                      <td style={{ textAlign: 'right' }}>{c.claims}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(c.billed)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#059669' }}>{fmtDollar(c.collected)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: c.outstanding > 0 ? '#dc2626' : '#059669' }}>{fmtDollar(c.outstanding)}</td>
                    </tr>
                  ))}
                  {carrierData.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: 'var(--text-tertiary)' }}>No data</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* AR Status Breakdown */}
        <div className="card">
          <div className="card-header"><span className="card-title">AR Status Breakdown</span></div>
          <div className="card-body" style={{ padding: 0 }}>
            <div className="ar-desktop-table">
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Count</th>
                    <th style={{ textAlign: 'right' }}>Invoiced</th>
                    <th style={{ textAlign: 'right' }}>Collected</th>
                    <th style={{ textAlign: 'right' }}>Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {arStatusData.map(s => (
                    <tr key={s.status} className="ar-row">
                      <td><span className="ar-phase-pill">{AR_STATUS_LABELS[s.status] || s.status}</span></td>
                      <td style={{ textAlign: 'right' }}>{s.count}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(s.invoiced)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#059669' }}>{fmtDollar(s.collected)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: s.outstanding > 0 ? '#dc2626' : '#059669' }}>{fmtDollar(s.outstanding)}</td>
                    </tr>
                  ))}
                  {arStatusData.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: 'var(--text-tertiary)' }}>No data</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value, sub, color, alert }) {
  return (
    <div className={`ar-kpi-card${alert ? ' ar-kpi-alert' : ''}`}>
      <div className="ar-kpi-label">{label}</div>
      <div className="ar-kpi-value" style={{ color }}>{value}</div>
      <div className="ar-kpi-sub">{sub}</div>
    </div>
  );
}
