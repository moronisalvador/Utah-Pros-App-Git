const fmtDollar = (v) => {
  if (v == null) return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtKilo = (v) => {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(0) + 'k';
  return '$' + Math.round(n);
};

export default function ARKpiStrip({ kpis }) {
  return (
    <div className="ar-kpi-strip">
      <div className={`ar-kpi-card${kpis.outstanding > 0 ? ' ar-kpi-alert' : ''}`}>
        <div className="ar-kpi-label">Outstanding</div>
        <div className="ar-kpi-value" style={{ color: '#dc2626' }}>{fmtKilo(kpis.outstanding)}</div>
        <div className="ar-kpi-sub">{fmtDollar(kpis.outstanding)}</div>
      </div>
      <div className="ar-kpi-card">
        <div className="ar-kpi-label">Collection Rate</div>
        <div className="ar-kpi-value" style={{ color: '#d97706' }}>{kpis.rate}%</div>
        <div className="ar-kpi-sub">{kpis.claimCount} claims</div>
      </div>
      <div className="ar-kpi-card">
        <div className="ar-kpi-label">Total Invoiced</div>
        <div className="ar-kpi-value" style={{ color: '#2563eb' }}>{fmtKilo(kpis.invoiced)}</div>
        <div className="ar-kpi-sub">{fmtDollar(kpis.invoiced)}</div>
      </div>
      <div className="ar-kpi-card">
        <div className="ar-kpi-label">Total Collected</div>
        <div className="ar-kpi-value" style={{ color: '#059669' }}>{fmtKilo(kpis.collected)}</div>
        <div className="ar-kpi-sub">{fmtDollar(kpis.collected)}</div>
      </div>
      <div className="ar-kpi-card ar-kpi-desktop-only">
        <div className="ar-kpi-label">Mit Outstanding</div>
        <div className="ar-kpi-value" style={{ color: '#60a5fa' }}>{fmtKilo(kpis.mitOutstanding)}</div>
        <div className="ar-kpi-sub">{fmtDollar(kpis.mitOutstanding)}</div>
      </div>
      <div className="ar-kpi-card ar-kpi-desktop-only">
        <div className="ar-kpi-label">Recon Outstanding</div>
        <div className="ar-kpi-value" style={{ color: '#34d399' }}>{fmtKilo(kpis.reconOutstanding)}</div>
        <div className="ar-kpi-sub">{fmtDollar(kpis.reconOutstanding)}</div>
      </div>
    </div>
  );
}
