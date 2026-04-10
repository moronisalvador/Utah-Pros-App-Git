// ── Shared Claim UI Components ───────────────────────────────────────────────
// Used by ClaimPage (operational) and ClaimCollectionPage (financial)

export function IR({ label, value, href }) {
  return (
    <div className="job-page-info-row">
      <span className="job-page-info-label">{label}</span>
      {!value
        ? <span className="job-page-info-value" style={{ color: 'var(--text-tertiary)' }}>—</span>
        : href
          ? <a href={href} className="job-page-info-value" style={{ color: 'var(--brand-primary)', textDecoration: 'none' }}>{value}</a>
          : <span className="job-page-info-value">{value}</span>}
    </div>
  );
}

export function EF({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 0' }}>
      <span className="job-page-info-label">{label}</span>
      <input className="input" type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder || label} style={{ height: 34 }} />
    </div>
  );
}

export function ES({ label, value, onChange, options }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 0' }}>
      <span className="job-page-info-label">{label}</span>
      <select className="input" value={value || ''} onChange={e => onChange(e.target.value)} style={{ height: 34 }}>
        <option value="">—</option>
        {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
    </div>
  );
}

export function StatusBadge({ status }) {
  const map = {
    open:          { label: 'Open',          color: '#2563eb', bg: '#eff6ff' },
    in_progress:   { label: 'In Progress',   color: '#d97706', bg: '#fffbeb' },
    closed:        { label: 'Closed',        color: '#059669', bg: '#ecfdf5' },
    denied:        { label: 'Denied',        color: '#dc2626', bg: '#fef2f2' },
    settled:       { label: 'Settled',       color: '#059669', bg: '#ecfdf5' },
    supplementing: { label: 'Supplementing', color: '#7c3aed', bg: '#f5f3ff' },
  };
  const s = map[status] || { label: status || 'Open', color: '#6b7280', bg: '#f9fafb' };
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: s.bg, color: s.color, border: `1px solid ${s.color}30` }}>
      {s.label}
    </span>
  );
}

export function KPI({ label, value, sub, color, alert }) {
  return (
    <div className={`ar-kpi-card${alert ? ' ar-kpi-alert' : ''}`}>
      <div className="ar-kpi-label">{label}</div>
      <div className="ar-kpi-value" style={{ color }}>{value}</div>
      {sub && <div className="ar-kpi-sub">{sub}</div>}
    </div>
  );
}
