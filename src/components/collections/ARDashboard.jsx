import { useState, useEffect, useCallback, useMemo } from 'react';

// Global, invoice-centric A/R dashboard: total outstanding + aging buckets + an
// overdue worklist across all clients. Reads get_ar_invoices() (one row per invoice
// with client/claim/job context + balance). Rows drill into the claim's A/R panel.

const toast = (m, t = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));
const fmt$ = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmt$2 = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (v) => v ? new Date(v + (String(v).includes('T') ? '' : 'T00:00:00')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';
const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

const daysPastDue = (r, today) => r.due_date ? Math.floor((today - new Date(r.due_date + 'T00:00:00')) / 86400000) : null;

function statusOf(r, today) {
  const total = Number(r.total || 0), paid = Number(r.amount_paid || 0), bal = Number(r.balance || 0);
  if (total > 0 && bal <= 0.005) return { label: 'Paid', bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' };
  const d = daysPastDue(r, today);
  if (bal > 0 && d != null && d > 0) return { label: 'Overdue', bg: '#fef2f2', color: '#dc2626', border: '#fecaca' };
  if (paid > 0) return { label: 'Partial', bg: '#fffbeb', color: '#d97706', border: '#fde68a' };
  if (r.qbo_invoice_id || r.sent_at) return { label: 'Sent', bg: 'var(--accent-light)', color: 'var(--accent)', border: '#bfdbfe' };
  return { label: 'Draft', bg: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', border: 'var(--border-light)' };
}

function ageLabel(r, today) {
  const bal = Number(r.balance || 0);
  if (bal <= 0.005) return { text: '—', color: 'var(--text-tertiary)' };
  const d = daysPastDue(r, today);
  if (d == null) return { text: 'no due date', color: 'var(--text-tertiary)' };
  if (d > 0) return { text: `${d}d overdue`, color: '#dc2626' };
  if (d === 0) return { text: 'due today', color: '#d97706' };
  return { text: `due in ${-d}d`, color: 'var(--text-secondary)' };
}

const BUCKETS = [
  { key: 'current', label: 'Current', color: '#16a34a' },
  { key: 'b30', label: '1–30 days', color: '#d97706' },
  { key: 'b60', label: '31–60 days', color: '#ea580c' },
  { key: 'b90', label: '61–90 days', color: '#dc2626' },
  { key: 'b90p', label: '90+ days', color: '#991b1b' },
];
function bucketOf(r, today) {
  const d = daysPastDue(r, today);
  if (d == null || d <= 0) return 'current';
  if (d <= 30) return 'b30';
  if (d <= 60) return 'b60';
  if (d <= 90) return 'b90';
  return 'b90p';
}

export default function ARDashboard({ db, navigate }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState('open');           // open | overdue | all

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.rpc('get_ar_invoices');
      setRows(data || []);
    } catch (e) {
      toast('Failed to load A/R: ' + (e.message || e), 'error');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const today = midnight();

  const totals = useMemo(() => {
    const open = rows.filter(r => Number(r.balance) > 0.005);
    const t = { invoiced: 0, collected: 0, outstanding: 0, overdue: 0, openCount: open.length, aging: {} };
    BUCKETS.forEach(b => { t.aging[b.key] = { amount: 0, count: 0 }; });
    rows.forEach(r => { t.invoiced += Number(r.total || 0); t.collected += Number(r.amount_paid || 0); });
    open.forEach(r => {
      const bal = Number(r.balance || 0);
      t.outstanding += bal;
      const d = daysPastDue(r, today);
      if (d != null && d > 0) t.overdue += bal;
      const bk = bucketOf(r, today);
      t.aging[bk].amount += bal; t.aging[bk].count += 1;
    });
    return t;
  }, [rows, today]);

  const filtered = useMemo(() => {
    let r = rows;
    if (mode === 'open') r = r.filter(x => Number(x.balance) > 0.005);
    if (mode === 'overdue') r = r.filter(x => Number(x.balance) > 0.005 && (daysPastDue(x, today) || 0) > 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(x =>
        (x.client_name || '').toLowerCase().includes(q) ||
        (x.claim_number || '').toLowerCase().includes(q) ||
        (x.job_number || '').toLowerCase().includes(q) ||
        (x.invoice_number || '').toLowerCase().includes(q));
    }
    return r;
  }, [rows, mode, search, today]);

  if (loading) return <div style={{ padding: 24, color: 'var(--text-tertiary)' }}>Loading A/R…</div>;

  return (
    <div style={{ padding: '20px', maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>Collections — A/R</h1>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>Outstanding invoices across all clients. Click a row to open the claim.</p>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        <KPI label="Outstanding" value={fmt$(totals.outstanding)} color={totals.outstanding > 0 ? '#dc2626' : '#16a34a'} sub={`${totals.openCount} open`} />
        <KPI label="Overdue" value={fmt$(totals.overdue)} color={totals.overdue > 0 ? '#dc2626' : 'var(--text-tertiary)'} />
        <KPI label="Collected" value={fmt$(totals.collected)} color="#16a34a" />
        <KPI label="Invoiced" value={fmt$(totals.invoiced)} />
      </div>

      {/* Aging buckets */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 1, background: 'var(--border-color)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 16 }}>
        {BUCKETS.map(b => (
          <div key={b.key} style={{ background: 'var(--bg-primary)', padding: '10px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)' }}>{b.label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: totals.aging[b.key].amount > 0 ? b.color : 'var(--text-tertiary)' }}>{fmt$(totals.aging[b.key].amount)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{totals.aging[b.key].count} inv</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client, claim, job, invoice…"
          style={{ flex: '1 1 220px', minWidth: 180, padding: '8px 12px', fontSize: 13, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
        <div style={{ display: 'flex', gap: 1, background: 'var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {[['open', 'Open'], ['overdue', 'Overdue'], ['all', 'All']].map(([v, l]) => (
            <button key={v} onClick={() => setMode(v)} style={{ padding: '7px 14px', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)', cursor: 'pointer', border: 'none', background: mode === v ? 'var(--accent)' : 'var(--bg-primary)', color: mode === v ? '#fff' : 'var(--text-secondary)' }}>{l}</button>
          ))}
        </div>
      </div>

      {/* Invoice list */}
      {filtered.length === 0 ? (
        <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-tertiary)', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)' }}>
          {rows.length === 0 ? 'No invoices yet. Create one from a claim, then it shows here.' : 'Nothing matches this filter.'}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 820 }}>
              <Row cells={['Client', 'Claim · Job', 'Sent', 'Age', 'Total', 'Collected', 'Balance', 'Status']} />
              {filtered.map((r, i) => {
                const st = statusOf(r, today);
                const age = ageLabel(r, today);
                return (
                  <div key={r.invoice_id} onClick={() => r.claim_id && navigate(`/collections/${r.claim_id}`)}
                    style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '10px 14px', borderTop: i === 0 ? 'none' : '1px solid var(--border-light)', cursor: r.claim_id ? 'pointer' : 'default', background: 'var(--bg-primary)' }}>
                    <Cell>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.client_name || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{r.invoice_number}{r.qbo_sync_error ? ' · ⚠ QB' : r.qbo_invoice_id ? ' · ✓ QB' : ''}</div>
                    </Cell>
                    <Cell>
                      <div style={{ color: 'var(--text-secondary)' }}>{r.claim_number || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>{(r.division || '').replace(/_/g, ' ')} {r.job_number || ''}</div>
                    </Cell>
                    <Cell>{fmtDate(r.sent_at)}</Cell>
                    <Cell><span style={{ color: age.color, fontWeight: 600 }}>{age.text}</span></Cell>
                    <Cell num>{fmt$2(r.total)}</Cell>
                    <Cell num style={{ color: Number(r.amount_paid) > 0 ? '#16a34a' : 'var(--text-secondary)' }}>{fmt$2(r.amount_paid)}</Cell>
                    <Cell num><b style={{ color: Number(r.balance) > 0.005 ? '#dc2626' : '#16a34a' }}>{fmt$2(r.balance)}</b></Cell>
                    <Cell>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: st.bg, color: st.color, border: `1px solid ${st.border}`, whiteSpace: 'nowrap' }}>{st.label}</span>
                    </Cell>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const GRID = 'minmax(150px,1.4fr) minmax(120px,1.2fr) 80px 110px 100px 100px 100px 90px';

function Row({ cells }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: GRID, padding: '8px 14px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
      {cells.map((c, i) => <div key={i} style={{ textAlign: i >= 4 && i <= 6 ? 'right' : 'left' }}>{c}</div>)}
    </div>
  );
}

function Cell({ children, num, style }) {
  return <div style={{ fontSize: 13, textAlign: num ? 'right' : 'left', color: 'var(--text-primary)', ...style }}>{children}</div>;
}

function KPI({ label, value, color, sub }) {
  return (
    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{sub}</div>}
    </div>
  );
}
