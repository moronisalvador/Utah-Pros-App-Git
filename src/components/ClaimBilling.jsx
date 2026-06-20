import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';

const toast = (m, t = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));
const fmt$ = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';
const todayMidnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

const PAYER_TYPES = [['insurance', 'Insurance'], ['homeowner', 'Homeowner'], ['other', 'Other']];
const METHODS = [['check', 'Check'], ['eft', 'EFT / ACH'], ['credit_card', 'Credit card'], ['cash', 'Cash'], ['other', 'Other']];

const invTotal = (inv) => Number(inv.adjusted_total ?? inv.total ?? 0);
const invPaid  = (inv) => Number(inv.amount_paid ?? 0);
const invBal   = (inv) => invTotal(inv) - invPaid(inv);

// Status pill (derived — covers Overdue, which isn't a stored status).
function statusChip(inv) {
  const total = invTotal(inv), bal = invBal(inv);
  if (!inv.qbo_invoice_id && invPaid(inv) <= 0) return { label: 'Draft',   bg: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', border: 'var(--border-light)' };
  if (total > 0 && bal <= 0.005)                 return { label: 'Paid',    bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' };
  if (invPaid(inv) > 0)                          return { label: 'Partial', bg: '#fffbeb', color: '#d97706', border: '#fde68a' };
  if (inv.due_date && new Date(inv.due_date + 'T00:00:00') < todayMidnight() && bal > 0)
                                                 return { label: 'Overdue', bg: '#fef2f2', color: '#dc2626', border: '#fecaca' };
  return { label: 'Sent', bg: 'var(--accent-light)', color: 'var(--accent)', border: '#bfdbfe' };
}

function dueLabel(inv) {
  if (invBal(inv) <= 0.005 && invTotal(inv) > 0) return { text: 'Paid', color: '#16a34a' };
  if (!inv.due_date) return { text: '—', color: 'var(--text-tertiary)' };
  const days = Math.floor((todayMidnight() - new Date(inv.due_date + 'T00:00:00')) / 86400000);
  if (days > 0)  return { text: `${days}d overdue`, color: '#dc2626' };
  if (days === 0) return { text: 'Due today', color: '#d97706' };
  return { text: `Due in ${-days}d`, color: 'var(--text-secondary)' };
}

// Claim-page A/R panel: one invoice per job (= division) → QuickBooks, with sent/aging/
// collected/balance and invoice-linked payment recording that pushes to QBO (one-way).
export default function ClaimBilling({ jobs, db, canEdit }) {
  const { employee } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [paysByInv, setPaysByInv] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);              // id currently acting on
  const [amounts, setAmounts] = useState({});          // invoice_id -> amount input
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [confirmDelPay, setConfirmDelPay] = useState(null);
  const [payOpen, setPayOpen] = useState(null);        // invoice_id with the pay form open
  const [payDraft, setPayDraft] = useState({});

  const jobIds = (jobs || []).map(j => j.id);
  const jobIdsKey = jobIds.join(',');

  const load = useCallback(async () => {
    if (!jobIdsKey) { setInvoices([]); setPaysByInv({}); setLoading(false); return; }
    setLoading(true);
    try {
      const invs = await db.select('invoices', `job_id=in.(${jobIdsKey})&select=*&order=created_at.asc`) || [];
      setInvoices(invs);
      const invIds = invs.map(i => i.id);
      const pays = invIds.length
        ? (await db.select('payments', `invoice_id=in.(${invIds.join(',')})&select=*&order=payment_date.desc,created_at.desc`) || [])
        : [];
      const grouped = {};
      pays.forEach(p => { (grouped[p.invoice_id] ||= []).push(p); });
      setPaysByInv(grouped);
    } catch {
      toast('Failed to load billing', 'error');
    } finally {
      setLoading(false);
    }
  }, [db, jobIdsKey]);

  useEffect(() => { load(); }, [load]);

  const invByJob = {};
  invoices.forEach(inv => { if (!invByJob[inv.job_id]) invByJob[inv.job_id] = inv; });

  // ── Invoice actions ──────────────────────────────────────────────────────────
  const createInvoice = async (jobId) => {
    setBusy(jobId);
    try {
      await db.rpc('create_invoice_for_job', { p_job_id: jobId });
      await load();
      toast('Draft invoice created — enter an amount to send it to QuickBooks');
    } catch (e) { toast('Failed to create invoice: ' + (e.message || e), 'error'); }
    finally { setBusy(null); }
  };

  const postInvoice = async (inv, body) => {
    const auth = await getAuthHeader();
    const res = await fetch('/api/qbo-invoice', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_id: inv.id, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  };

  // Edits to an ALREADY-synced invoice auto-sync; a new invoice is saved locally and
  // pushed only on the deliberate "Send to QuickBooks" click.
  const saveAndSync = async (inv) => {
    const raw = amounts[inv.id];
    if (raw == null || raw === '') return;
    const amt = Number(raw);
    if (!(amt >= 0)) { toast('Enter a valid amount', 'error'); return; }
    const synced = !!inv.qbo_invoice_id;
    const changed = Number(inv.total) !== amt;
    if (!changed && !(synced && inv.qbo_sync_error)) {
      setAmounts(a => { const n = { ...a }; delete n[inv.id]; return n; });
      return;
    }
    setBusy(inv.id);
    try {
      if (changed) await db.update('invoices', `id=eq.${inv.id}`, { subtotal: amt, total: amt });
      setAmounts(a => { const n = { ...a }; delete n[inv.id]; return n; });
      if (synced) {
        const data = await postInvoice(inv, {});
        toast(data.mode === 'updated' ? 'Updated in QuickBooks' : `Pushed to QuickBooks (#${data.qbo_invoice_id})`);
      } else if (amt > 0) {
        toast('Amount saved — click “Send to QuickBooks” to create the invoice');
      }
      await load();
    } catch (e) { toast('QuickBooks: ' + e.message, 'error'); await load(); }
    finally { setBusy(null); }
  };

  const sendToQbo = async (inv) => {
    const raw = amounts[inv.id];
    const amt = (raw != null && raw !== '') ? Number(raw) : Number(inv.total);
    if (!(amt > 0)) { toast('Enter an amount above $0 first', 'error'); return; }
    setBusy(inv.id);
    try {
      if (Number(inv.total) !== amt) await db.update('invoices', `id=eq.${inv.id}`, { subtotal: amt, total: amt });
      setAmounts(a => { const n = { ...a }; delete n[inv.id]; return n; });
      const data = await postInvoice(inv, {});
      toast(`Sent to QuickBooks (#${data.qbo_invoice_id})`);
      await load();
    } catch (e) { toast('QuickBooks: ' + e.message, 'error'); await load(); }
    finally { setBusy(null); }
  };

  const removeFromQbo = async (inv) => {
    if (confirmRemove !== inv.id) { setConfirmRemove(inv.id); return; }
    setConfirmRemove(null);
    setBusy(inv.id);
    try {
      await postInvoice(inv, { action: 'delete' });
      toast('Removed from QuickBooks');
      await load();
    } catch (e) { toast('QuickBooks: ' + e.message, 'error'); }
    finally { setBusy(null); }
  };

  // ── Payment actions ──────────────────────────────────────────────────────────
  const openPay = (inv) => {
    setPayOpen(inv.id);
    setPayDraft({ amount: invBal(inv) > 0 ? String(invBal(inv).toFixed(2)) : '', date: new Date().toISOString().slice(0, 10), payer_type: 'insurance', method: 'check', reference: '' });
  };

  const recordPayment = async (inv, job) => {
    const amt = Number(payDraft.amount);
    if (!(amt > 0)) { toast('Enter a payment amount', 'error'); return; }
    setBusy(inv.id);
    try {
      const inserted = await db.insert('payments', {
        invoice_id: inv.id,
        job_id: job.id,
        contact_id: inv.contact_id || null,
        amount: amt,
        payment_date: payDraft.date || new Date().toISOString().slice(0, 10),
        payer_type: payDraft.payer_type || 'insurance',
        payment_method: payDraft.method || null,
        reference_number: payDraft.reference || null,
        recorded_by: employee?.id || null,
      });
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      if (inv.qbo_invoice_id && row?.id) {
        try {
          const auth = await getAuthHeader();
          const res = await fetch('/api/qbo-payment', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ payment_id: row.id }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || res.statusText);
          toast(`Payment of ${fmt$(amt)} recorded & synced to QuickBooks`);
        } catch (e) {
          toast('Payment recorded — QuickBooks sync failed: ' + e.message, 'error');
        }
      } else {
        toast(`Payment of ${fmt$(amt)} recorded${inv.qbo_invoice_id ? '' : ' (send the invoice to QuickBooks to sync it)'}`);
      }
      setPayOpen(null); setPayDraft({});
      await load();
    } catch (e) { toast('Failed to record payment: ' + (e.message || e), 'error'); }
    finally { setBusy(null); }
  };

  const deletePayment = async (pay) => {
    if (confirmDelPay !== pay.id) { setConfirmDelPay(pay.id); return; }
    setConfirmDelPay(null);
    setBusy('pay-' + pay.id);
    try {
      if (pay.qbo_payment_id) {
        try {
          const auth = await getAuthHeader();
          await fetch('/api/qbo-payment', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ payment_id: pay.id, action: 'delete' }) });
        } catch (e) { toast('QuickBooks removal failed: ' + e.message, 'error'); }
      }
      await db.delete('payments', `id=eq.${pay.id}`);
      toast('Payment deleted');
      await load();
    } catch { toast('Failed to delete payment', 'error'); }
    finally { setBusy(null); }
  };

  if (loading) return <div style={{ padding: 12, color: 'var(--text-tertiary)', fontSize: 13 }}>Loading billing…</div>;
  if (!jobs?.length) return <div style={{ padding: 12, color: 'var(--text-tertiary)', fontSize: 13 }}>No jobs on this claim yet.</div>;

  const sums = invoices.reduce((a, inv) => {
    a.invoiced += invTotal(inv); a.collected += invPaid(inv); a.balance += invBal(inv); return a;
  }, { invoiced: 0, collected: 0, balance: 0 });

  const kpi = (label, value, color) => (
    <div style={{ flex: 1, padding: '8px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: color || 'var(--text-primary)' }}>{value}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Claim A/R summary */}
      {invoices.length > 0 && (
        <div style={{ display: 'flex', gap: 1, background: 'var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <div style={{ background: 'var(--bg-secondary)', flex: 1 }}>{kpi('Invoiced', fmt$(sums.invoiced))}</div>
          <div style={{ background: 'var(--bg-secondary)', flex: 1 }}>{kpi('Collected', fmt$(sums.collected), '#16a34a')}</div>
          <div style={{ background: 'var(--bg-secondary)', flex: 1 }}>{kpi('Balance', fmt$(sums.balance), sums.balance > 0.005 ? '#dc2626' : '#16a34a')}</div>
        </div>
      )}

      {jobs.map(job => {
        const inv = invByJob[job.id];
        const synced = !!inv?.qbo_invoice_id;
        const isBusy = busy === inv?.id;
        const division = job.division ? String(job.division).replace(/_/g, ' ') : 'Job';
        const chip = isBusy ? { label: 'Syncing…', bg: 'var(--accent-light)', color: 'var(--accent)', border: '#bfdbfe' }
          : inv?.qbo_sync_error ? { label: 'Sync error', bg: '#fef2f2', color: '#dc2626', border: '#fecaca', title: inv.qbo_sync_error }
          : inv ? statusChip(inv) : null;
        const due = inv ? dueLabel(inv) : null;
        const pays = (inv && paysByInv[inv.id]) || [];

        return (
          <div key={job.id} style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                  {division} · {job.job_number || '—'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {inv ? `${inv.invoice_number}${synced ? ' · QuickBooks #' + inv.qbo_invoice_id : ''}` : 'No invoice yet'}
                </div>
              </div>
              {chip && (
                <span title={chip.title} style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: chip.bg, color: chip.color, border: `1px solid ${chip.border}`, cursor: chip.title ? 'help' : 'default', whiteSpace: 'nowrap' }}>
                  {chip.label}
                </span>
              )}
            </div>

            {/* A/R detail */}
            {inv && (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: 12 }}>
                <ARField label="Sent" value={inv.sent_at ? fmtDate(inv.sent_at) : 'Not sent'} />
                <ARField label="Due" value={due.text} color={due.color} />
                <ARField label="Total" value={fmt$(invTotal(inv))} />
                <ARField label="Collected" value={fmt$(invPaid(inv))} color={invPaid(inv) > 0 ? '#16a34a' : undefined} />
                <ARField label="Balance" value={fmt$(invBal(inv))} color={invBal(inv) > 0.005 ? '#dc2626' : '#16a34a'} bold />
              </div>
            )}

            {/* Payment history */}
            {pays.length > 0 && (
              <div style={{ marginTop: 8, borderTop: '1px solid var(--border-light)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {pays.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    <span style={{ color: '#16a34a', fontWeight: 700 }}>{fmt$(p.amount)}</span>
                    <span>{fmtDate(p.payment_date)}</span>
                    <span style={{ textTransform: 'capitalize' }}>{(p.payer_type || '').replace(/_/g, ' ')}{p.payment_method ? ' · ' + String(p.payment_method).replace(/_/g, ' ') : ''}</span>
                    {p.qbo_payment_id ? <span title="Synced to QuickBooks" style={{ color: '#16a34a' }}>✓ QB</span>
                      : p.qbo_sync_error ? <span title={p.qbo_sync_error} style={{ color: '#dc2626', cursor: 'help' }}>! QB</span> : null}
                    {canEdit && (
                      <button onClick={() => deletePayment(p)} onBlur={() => setConfirmDelPay(null)} disabled={busy === 'pay-' + p.id}
                        style={{ marginLeft: 'auto', fontSize: 10.5, fontFamily: 'var(--font-sans)', cursor: 'pointer', padding: '1px 7px', borderRadius: 'var(--radius-full)', border: `1px solid ${confirmDelPay === p.id ? '#fecaca' : 'var(--border-light)'}`, background: confirmDelPay === p.id ? '#fef2f2' : 'transparent', color: confirmDelPay === p.id ? '#dc2626' : 'var(--text-tertiary)' }}>
                        {confirmDelPay === p.id ? 'Confirm' : 'Delete'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Edit controls */}
            {canEdit && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {!inv ? (
                  <button className="btn btn-secondary btn-sm" disabled={busy === job.id} onClick={() => createInvoice(job.id)}>
                    {busy === job.id ? 'Creating…' : 'Create invoice'}
                  </button>
                ) : (
                  <>
                    <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>$</span>
                    <input
                      type="number" inputMode="decimal" placeholder={String(inv.total || 0)}
                      value={amounts[inv.id] ?? ''} disabled={isBusy}
                      onChange={e => setAmounts(a => ({ ...a, [inv.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      onBlur={() => saveAndSync(inv)}
                      style={{ width: 110, padding: '6px 8px', fontSize: 13, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                    />
                    {!synced && Number(amounts[inv.id] ?? inv.total) > 0 && (
                      <button className="btn btn-primary btn-sm" disabled={isBusy} onClick={() => sendToQbo(inv)}>
                        {isBusy ? 'Sending…' : 'Send to QuickBooks'}
                      </button>
                    )}
                    {invTotal(inv) > 0 && (
                      <button className="btn btn-secondary btn-sm" disabled={isBusy} onClick={() => (payOpen === inv.id ? setPayOpen(null) : openPay(inv))}>
                        + Record payment
                      </button>
                    )}
                    {synced && (
                      <button className="btn btn-sm" disabled={isBusy} onClick={() => removeFromQbo(inv)} onBlur={() => setConfirmRemove(null)}
                        style={{ background: confirmRemove === inv.id ? '#fef2f2' : 'var(--bg-tertiary)', color: confirmRemove === inv.id ? '#dc2626' : 'var(--text-tertiary)', border: `1px solid ${confirmRemove === inv.id ? '#fecaca' : 'var(--border-light)'}` }}>
                        {isBusy ? '…' : confirmRemove === inv.id ? 'Confirm remove' : 'Remove from QuickBooks'}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Inline payment form */}
            {canEdit && payOpen === inv?.id && (
              <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
                <PayInput label="Amount">
                  <input type="number" inputMode="decimal" value={payDraft.amount} onChange={e => setPayDraft(d => ({ ...d, amount: e.target.value }))}
                    style={inputStyle(110)} />
                </PayInput>
                <PayInput label="Date">
                  <input type="date" value={payDraft.date} onChange={e => setPayDraft(d => ({ ...d, date: e.target.value }))} style={inputStyle(140)} />
                </PayInput>
                <PayInput label="From">
                  <select value={payDraft.payer_type} onChange={e => setPayDraft(d => ({ ...d, payer_type: e.target.value }))} style={inputStyle(120)}>
                    {PAYER_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </PayInput>
                <PayInput label="Method">
                  <select value={payDraft.method} onChange={e => setPayDraft(d => ({ ...d, method: e.target.value }))} style={inputStyle(120)}>
                    {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </PayInput>
                <PayInput label="Reference (optional)">
                  <input type="text" value={payDraft.reference} placeholder="Check #, txn…" onChange={e => setPayDraft(d => ({ ...d, reference: e.target.value }))} style={inputStyle(130)} />
                </PayInput>
                <button className="btn btn-primary btn-sm" disabled={isBusy} onClick={() => recordPayment(inv, job)}>
                  {isBusy ? 'Saving…' : 'Save payment'}
                </button>
                <button className="btn btn-secondary btn-sm" disabled={isBusy} onClick={() => { setPayOpen(null); setPayDraft({}); }}>Cancel</button>
              </div>
            )}
          </div>
        );
      })}

      {canEdit && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '2px 2px 0' }}>
          Enter an amount → <b>Send to QuickBooks</b>; edits to a sent invoice re-sync automatically. Record payments here — they post to QuickBooks against the invoice.
        </div>
      )}
    </div>
  );
}

function ARField({ label, value, color, bold }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: bold ? 800 : 600, color: color || 'var(--text-primary)', marginTop: 1 }}>{value}</div>
    </div>
  );
}

function PayInput({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)' }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = (w) => ({ width: w, padding: '6px 8px', fontSize: 13, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' });
