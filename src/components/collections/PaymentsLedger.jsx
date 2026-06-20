import { useState, useEffect, useCallback, useMemo } from 'react';

// Global payments ledger (cash-in). Reads get_payments_ledger() — one row per payment
// with client/claim/job context + QBO sync state. Rows drill into the claim's A/R.

const toast = (m, t = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));
const fmt$ = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmt$2 = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (v) => v ? new Date(v + (String(v).includes('T') ? '' : 'T00:00:00')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';
const cap = (s) => s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';

const GRID = '84px minmax(140px,1.4fr) minmax(120px,1.2fr) 110px 150px 110px 70px';

export default function PaymentsLedger({ db, navigate }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.rpc('get_payments_ledger', { p_limit: 1000 });
      setRows(data || []);
    } catch (e) {
      toast('Failed to load payments: ' + (e.message || e), 'error');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const now = new Date();
    const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    let total = 0, month = 0, synced = 0;
    rows.forEach(r => {
      total += Number(r.amount || 0);
      if ((r.payment_date || '').startsWith(ym)) month += Number(r.amount || 0);
      if (r.qbo_payment_id) synced += 1;
    });
    return { total, month, synced, count: rows.length };
  }, [rows]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(r =>
      (r.client_name || '').toLowerCase().includes(q) ||
      (r.claim_number || '').toLowerCase().includes(q) ||
      (r.job_number || '').toLowerCase().includes(q) ||
      (r.invoice_number || '').toLowerCase().includes(q) ||
      (r.reference_number || '').toLowerCase().includes(q));
  }, [rows, search]);

  if (loading) return <div style={{ padding: 24, color: 'var(--text-tertiary)' }}>Loading payments…</div>;

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        <KPI label="Collected (all time)" value={fmt$(totals.total)} color="#16a34a" sub={`${totals.count} payments`} />
        <KPI label="This month" value={fmt$(totals.month)} color="#16a34a" />
        <KPI label="Synced to QuickBooks" value={`${totals.synced}/${totals.count}`} color={totals.synced === totals.count ? '#16a34a' : '#d97706'} />
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client, claim, job, invoice, reference…"
        style={{ width: '100%', maxWidth: 420, padding: '8px 12px', fontSize: 13, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)', color: 'var(--text-primary)', marginBottom: 10 }} />

      {filtered.length === 0 ? (
        <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-tertiary)', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)' }}>
          {rows.length === 0 ? 'No payments recorded yet.' : 'Nothing matches this search.'}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 760 }}>
              <div style={{ display: 'grid', gridTemplateColumns: GRID, padding: '8px 14px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                <div>Date</div><div>Client</div><div>Claim · Job</div><div>Invoice</div><div>Method / Source</div><div style={{ textAlign: 'right' }}>Amount</div><div style={{ textAlign: 'center' }}>QB</div>
              </div>
              {filtered.map((r, i) => (
                <div key={r.payment_id} onClick={() => r.claim_id && navigate(`/collections/${r.claim_id}`)}
                  style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '9px 14px', borderTop: i === 0 ? 'none' : '1px solid var(--border-light)', cursor: r.claim_id ? 'pointer' : 'default', background: 'var(--bg-primary)', fontSize: 13 }}>
                  <div style={{ color: 'var(--text-secondary)' }}>{fmtDate(r.payment_date)}</div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.client_name || '—'}</div>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    <div>{r.claim_number || '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>{(r.division || '').replace(/_/g, ' ')} {r.job_number || ''}</div>
                  </div>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{r.invoice_number || '—'}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                    {r.payment_method ? cap(r.payment_method) : '—'}{r.payer_type ? <span style={{ color: 'var(--text-tertiary)' }}> · {cap(r.payer_type)}</span> : ''}
                    {r.is_deductible ? <span style={{ color: '#d97706' }}> · Deductible</span> : ''}
                  </div>
                  <div style={{ textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{fmt$2(r.amount)}</div>
                  <div style={{ textAlign: 'center' }}>
                    {r.qbo_payment_id ? <span title="Synced to QuickBooks" style={{ color: '#16a34a' }}>✓</span>
                      : r.qbo_sync_error ? <span title={r.qbo_sync_error} style={{ color: '#dc2626', cursor: 'help' }}>!</span>
                      : <span title="Not synced to QuickBooks" style={{ color: 'var(--text-tertiary)' }}>—</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
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
