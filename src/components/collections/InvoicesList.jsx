/**
 * ════════════════════════════════════════════════
 * FILE: InvoicesList.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows every invoice in one searchable list — invoice number, customer, the
 *   claim/job it belongs to, the amounts, and a status badge. You can type to
 *   filter by customer, claim, job, or invoice number, narrow by status, and
 *   click any row to open that invoice (to view, edit, save, or send it).
 *
 * WHERE IT LIVES:
 *   Route:        rendered inside /collections (the "Invoices" tab)
 *   Rendered by:  src/pages/Collections.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  receives { db, navigate } from Collections.jsx; rows navigate to
 *              the invoice editor at /invoices/:invoiceId
 *   Data:      reads  → get_ar_invoices() RPC (one row per invoice with
 *                       client/claim/job context + balance)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Reuses the same get_ar_invoices() RPC the A/R tab uses, so the two tabs
 *     always agree on numbers/status. This tab shows ALL invoices (the A/R tab
 *     defaults to outstanding only).
 *   - Status mirrors ARDashboard for consistency across the Collections hub.
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

const toast = (m, t = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));
const fmt$ = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (v) => v ? new Date(v + (String(v).includes('T') ? '' : 'T00:00:00')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';
const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const daysPastDue = (r, today) => r.due_date ? Math.floor((today - new Date(r.due_date + 'T00:00:00')) / 86400000) : null;

// Status badge — same rules as the A/R dashboard so both Collections tabs agree.
function statusOf(r, today) {
  const total = Number(r.total || 0), paid = Number(r.amount_paid || 0), bal = Number(r.balance || 0);
  if (total > 0 && bal <= 0.005) return { label: 'Paid', bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' };
  const d = daysPastDue(r, today);
  if (bal > 0 && d != null && d > 0) return { label: 'Overdue', bg: '#fef2f2', color: '#dc2626', border: '#fecaca' };
  if (paid > 0) return { label: 'Partial', bg: '#fffbeb', color: '#d97706', border: '#fde68a' };
  if (r.qbo_invoice_id || r.sent_at) return { label: 'Sent', bg: 'var(--accent-light)', color: 'var(--accent)', border: '#bfdbfe' };
  return { label: 'Draft', bg: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', border: 'var(--border-light)' };
}

export default function InvoicesList({ db, navigate }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState('all');           // all | open | paid | draft

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.rpc('get_ar_invoices');
      setRows(data || []);
    } catch (e) {
      toast('Failed to load invoices: ' + (e.message || e), 'error');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const today = midnight();

  // ─── SECTION: Helpers ──────────────
  const filtered = useMemo(() => {
    let r = rows;
    if (mode === 'open')  r = r.filter(x => Number(x.balance) > 0.005);
    if (mode === 'paid')  r = r.filter(x => Number(x.total) > 0 && Number(x.balance) <= 0.005);
    if (mode === 'draft') r = r.filter(x => !x.qbo_invoice_id && !x.sent_at);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(x =>
        (x.client_name || '').toLowerCase().includes(q) ||
        (x.claim_number || '').toLowerCase().includes(q) ||
        (x.job_number || '').toLowerCase().includes(q) ||
        (x.invoice_number || '').toLowerCase().includes(q) ||
        (x.qbo_doc_number || '').toLowerCase().includes(q));
    }
    return r;
  }, [rows, mode, search]);

  if (loading) return <div style={{ padding: 24, color: 'var(--text-tertiary)' }}>Loading invoices…</div>;

  // ─── SECTION: Render ──────────────
  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, claim, job, invoice #…"
          style={{ flex: '1 1 220px', minWidth: 180, padding: '8px 12px', fontSize: 13, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
        <div style={{ display: 'flex', gap: 1, background: 'var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {[['all', 'All'], ['open', 'Open'], ['paid', 'Paid'], ['draft', 'Drafts']].map(([v, l]) => (
            <button key={v} onClick={() => setMode(v)} style={{ padding: '7px 14px', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)', cursor: 'pointer', border: 'none', background: mode === v ? 'var(--accent)' : 'var(--bg-primary)', color: mode === v ? '#fff' : 'var(--text-secondary)' }}>{l}</button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{filtered.length} invoice{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-tertiary)', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)' }}>
          {rows.length === 0 ? 'No invoices yet. Create one from a claim, then it shows here.' : 'Nothing matches this filter.'}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 800 }}>
              <Row cells={['Invoice', 'Customer', 'Claim · Job', 'Date', 'Total', 'Balance', 'Status']} />
              {filtered.map((r, i) => {
                const st = statusOf(r, today);
                return (
                  <div key={r.invoice_id} onClick={() => navigate(`/invoices/${r.invoice_id}`)}
                    style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '10px 14px', borderTop: i === 0 ? 'none' : '1px solid var(--border-light)', cursor: 'pointer', background: 'var(--bg-primary)' }}>
                    <Cell><span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.qbo_doc_number || r.invoice_number}</span></Cell>
                    <Cell>{r.client_name || '—'}</Cell>
                    <Cell>
                      <div style={{ color: 'var(--text-secondary)' }}>{r.claim_number || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>{(r.division || '').replace(/_/g, ' ')} {r.job_number || ''}</div>
                    </Cell>
                    <Cell>{fmtDate(r.invoice_date || r.sent_at)}</Cell>
                    <Cell num>{fmt$(r.total)}</Cell>
                    <Cell num><b style={{ color: Number(r.balance) > 0.005 ? '#dc2626' : '#16a34a' }}>{fmt$(r.balance)}</b></Cell>
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

const GRID = 'minmax(110px,1fr) minmax(140px,1.4fr) minmax(130px,1.3fr) 90px 110px 110px 90px';

function Row({ cells }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: GRID, padding: '8px 14px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
      {cells.map((c, i) => <div key={i} style={{ textAlign: i >= 4 && i <= 5 ? 'right' : 'left' }}>{c}</div>)}
    </div>
  );
}

function Cell({ children, num, style }) {
  return <div style={{ fontSize: 13, textAlign: num ? 'right' : 'left', color: 'var(--text-primary)', ...style }}>{children}</div>;
}
