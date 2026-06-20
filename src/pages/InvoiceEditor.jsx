import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import { canEditBilling } from '@/lib/claimUtils';

const toast = (m, t = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));
const fmt$ = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (v) => v ? new Date(v + (String(v).includes('T') ? '' : 'T00:00:00')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// Dedicated invoice editor — build line items (Item + Class per line) and push the invoice
// to QuickBooks. Intentional, guarded flow (vs. inline editing). Route: /invoices/:invoiceId.
export default function InvoiceEditor() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const { db, isFeatureEnabled, employee } = useAuth();
  const canEdit = canEditBilling(employee?.role);

  const [inv, setInv] = useState(null);
  const [job, setJob] = useState(null);
  const [claim, setClaim] = useState(null);
  const [contact, setContact] = useState(null);
  const [lines, setLines] = useState([]);
  const [qboItems, setQboItems] = useState([]);
  const [qboClasses, setQboClasses] = useState([]);
  const [catalogMsg, setCatalogMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const i = (await db.select('invoices', `id=eq.${invoiceId}&limit=1`))?.[0];
      if (!i) { toast('Invoice not found', 'error'); navigate('/collections', { replace: true }); return; }
      setInv(i);
      const j = i.job_id ? (await db.select('jobs', `id=eq.${i.job_id}&select=id,division,job_number,claim_id,primary_contact_id&limit=1`))?.[0] : null;
      setJob(j || null);
      setClaim(j?.claim_id ? (await db.select('claims', `id=eq.${j.claim_id}&select=claim_number,insurance_carrier&limit=1`))?.[0] || null : null);
      const cid = i.contact_id || j?.primary_contact_id;
      setContact(cid ? (await db.select('contacts', `id=eq.${cid}&select=name&limit=1`))?.[0] || null : null);
      setLines(await db.select('invoice_line_items', `invoice_id=eq.${invoiceId}&order=sort_order.asc,created_at.asc`) || []);
    } catch (e) {
      toast('Failed to load invoice: ' + (e.message || e), 'error');
    } finally {
      setLoading(false);
    }
  }, [db, invoiceId, navigate]);

  useEffect(() => { load(); }, [load]);

  const loadCatalog = useCallback(async () => {
    try {
      const auth = await getAuthHeader();
      const run = async (query) => {
        const res = await fetch('/api/qbo-query', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || res.statusText);
        return d.queryResponse || {};
      };
      const [itemsR, classesR] = await Promise.all([
        run('SELECT Id, Name FROM Item WHERE Active = true MAXRESULTS 200'),
        run('SELECT Id, Name FROM Class WHERE Active = true MAXRESULTS 200'),
      ]);
      setQboItems((itemsR.Item || []).map(i => ({ id: String(i.Id), name: i.Name })));
      setQboClasses((classesR.Class || []).map(c => ({ id: String(c.Id), name: c.Name })));
      setCatalogMsg('');
    } catch (e) {
      setCatalogMsg(/not connected/i.test(e.message || '') ? 'Connect QuickBooks (Dev Tools) to load items & classes.' : 'QuickBooks catalog unavailable.');
    }
  }, []);
  useEffect(() => { if (canEdit) loadCatalog(); }, [canEdit, loadCatalog]);

  const synced = !!inv?.qbo_invoice_id;
  const total = lines.reduce((s, l) => s + Number(l.line_total || 0), 0);

  // ── Line handlers ──
  const addLine = async () => {
    setBusy(true);
    try { await db.insert('invoice_line_items', { invoice_id: invoiceId, description: '', quantity: 1, unit_price: 0, line_total: 0, sort_order: lines.length }); await load(); }
    catch (e) { toast('Failed to add line: ' + (e.message || e), 'error'); }
    finally { setBusy(false); }
  };
  const setLineLocal = (lineId, patch) => {
    setLines(prev => prev.map(l => {
      if (l.id !== lineId) return l;
      const next = { ...l, ...patch };
      if ('quantity' in patch || 'unit_price' in patch) next.line_total = round2(Number(next.quantity || 0) * Number(next.unit_price || 0));
      return next;
    }));
  };
  const saveLine = async (line) => {
    try {
      await db.update('invoice_line_items', `id=eq.${line.id}`, {
        description: line.description || null,
        qbo_item_id: line.qbo_item_id || null, qbo_item_name: line.qbo_item_name || null,
        qbo_class_id: line.qbo_class_id || null, qbo_class_name: line.qbo_class_name || null,
        quantity: Number(line.quantity || 0), unit_price: Number(line.unit_price || 0), line_total: round2(line.line_total),
      });
      await load();
    } catch { toast('Failed to save line', 'error'); }
  };
  const removeLine = async (line) => {
    setBusy(true);
    try { await db.delete('invoice_line_items', `id=eq.${line.id}`); await load(); }
    catch { toast('Failed to remove line', 'error'); }
    finally { setBusy(false); }
  };

  // ── QBO actions ──
  const callWorker = async (body) => {
    const auth = await getAuthHeader();
    const res = await fetch('/api/qbo-invoice', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_id: invoiceId, ...body }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  };
  const syncToQbo = async () => {
    setBusy(true);
    try { const d = await callWorker({}); toast(d.mode === 'updated' ? 'Updated in QuickBooks' : `Sent to QuickBooks (#${d.qbo_invoice_id})`); await load(); }
    catch (e) { toast('QuickBooks: ' + e.message, 'error'); await load(); }
    finally { setBusy(false); }
  };
  const removeFromQbo = async () => {
    if (!confirmRemove) { setConfirmRemove(true); return; }
    setConfirmRemove(false); setBusy(true);
    try { await callWorker({ action: 'delete' }); toast('Removed from QuickBooks'); await load(); }
    catch (e) { toast('QuickBooks: ' + e.message, 'error'); }
    finally { setBusy(false); }
  };
  const deleteDraft = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setConfirmDelete(false); setBusy(true);
    try {
      for (const l of lines) await db.delete('invoice_line_items', `id=eq.${l.id}`);
      await db.delete('invoices', `id=eq.${invoiceId}`);
      toast('Draft invoice deleted');
      navigate(job?.claim_id ? `/collections/${job.claim_id}` : '/collections');
    } catch (e) { toast('Failed to delete: ' + (e.message || e), 'error'); setBusy(false); }
  };

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;
  if (!inv) return null;

  if (!isFeatureEnabled('feature:billing')) {
    return <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, color: 'var(--text-tertiary)' }}>Billing is turned off (feature flag <code>feature:billing</code>).</div>;
  }

  const division = job?.division ? String(job.division).replace(/_/g, ' ') : 'Job';
  const paid = Number(inv.amount_paid || 0);
  const statusLabel = synced ? (paid >= total && total > 0 ? 'Paid' : paid > 0 ? 'Partial' : 'Sent') : 'Draft';
  const statusColor = statusLabel === 'Paid' ? '#16a34a' : statusLabel === 'Partial' ? '#d97706' : statusLabel === 'Sent' ? 'var(--accent)' : 'var(--text-tertiary)';

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '20px', paddingBottom: 96 }}>
      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => (job?.claim_id ? navigate(`/collections/${job.claim_id}`) : navigate(-1))} style={{ gap: 4 }}>← Back</button>
        {synced && <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>QuickBooks #{inv.qbo_invoice_id}{inv.qbo_synced_at ? ' · synced ' + fmtDate(inv.qbo_synced_at) : ''}</span>}
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>{inv.invoice_number}</div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 2 }}>
            {contact?.name || 'Client'} · <span style={{ textTransform: 'capitalize' }}>{division}</span> {job?.job_number || ''}{claim?.claim_number ? ` · ${claim.claim_number}` : ''}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
            Sent {inv.sent_at ? fmtDate(inv.sent_at) : '—'} · Due {inv.due_date ? fmtDate(inv.due_date) : '—'}
          </div>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, padding: '4px 12px', borderRadius: 'var(--radius-full)', background: 'var(--bg-secondary)', color: statusColor, border: `1px solid ${statusColor}40` }}>{statusLabel}</span>
      </div>

      {inv.qbo_sync_error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>QuickBooks sync error: {inv.qbo_sync_error}</div>}
      {catalogMsg && canEdit && <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#d97706', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>{catalogMsg}</div>}

      {/* Line items */}
      <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginTop: 6 }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 720 }}>
            <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '10px 14px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <span>Item</span><span>Description</span><span>Class</span><span>Qty</span><span>Rate</span><span style={{ textAlign: 'right' }}>Amount</span>{canEdit && <span />}
            </div>
            {lines.length === 0 && <div style={{ padding: '20px 14px', color: 'var(--text-tertiary)', fontSize: 13 }}>No line items yet. {canEdit ? 'Add a line to build the invoice.' : ''}</div>}
            {lines.map(l => (
              <div key={l.id} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--border-light)', alignItems: 'center' }}>
                {canEdit ? (
                  <>
                    <select value={l.qbo_item_id || ''} disabled={!qboItems.length} onChange={e => { const it = qboItems.find(i => i.id === e.target.value); const patch = { qbo_item_id: it?.id || null, qbo_item_name: it?.name || null }; setLineLocal(l.id, patch); saveLine({ ...l, ...patch }); }} style={sel}>
                      <option value="">{qboItems.length ? 'Select item…' : '—'}</option>
                      {qboItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                    <input type="text" value={l.description || ''} placeholder="Description" onChange={e => setLineLocal(l.id, { description: e.target.value })} onBlur={() => saveLine(l)} style={inp} />
                    <select value={l.qbo_class_id || ''} disabled={!qboClasses.length} onChange={e => { const c = qboClasses.find(x => x.id === e.target.value); const patch = { qbo_class_id: c?.id || null, qbo_class_name: c?.name || null }; setLineLocal(l.id, patch); saveLine({ ...l, ...patch }); }} style={sel}>
                      <option value="">{qboClasses.length ? 'Class…' : '—'}</option>
                      {qboClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <input type="number" inputMode="decimal" value={l.quantity ?? ''} onChange={e => setLineLocal(l.id, { quantity: e.target.value })} onBlur={() => saveLine(l)} style={inp} />
                    <input type="number" inputMode="decimal" value={l.unit_price ?? ''} onChange={e => setLineLocal(l.id, { unit_price: e.target.value })} onBlur={() => saveLine(l)} style={inp} />
                    <span style={{ textAlign: 'right', fontWeight: 600, fontSize: 13 }}>{fmt$(l.line_total)}</span>
                    <button onClick={() => removeLine(l)} disabled={busy} title="Remove line" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 16 }}>✕</button>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 13 }}>{l.qbo_item_name || '—'}</span>
                    <span style={{ fontSize: 13 }}>{l.description || '—'}</span>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{l.qbo_class_name || '—'}</span>
                    <span style={{ fontSize: 13 }}>{Number(l.quantity || 0)}</span>
                    <span style={{ fontSize: 13 }}>{fmt$(l.unit_price)}</span>
                    <span style={{ textAlign: 'right', fontWeight: 600, fontSize: 13 }}>{fmt$(l.line_total)}</span>
                  </>
                )}
              </div>
            ))}
            {/* Total */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'var(--bg-secondary)' }}>
              {canEdit ? <button className="btn btn-secondary btn-sm" disabled={busy} onClick={addLine}>+ Add line</button> : <span />}
              <div style={{ fontSize: 16, fontWeight: 800 }}>Total: {fmt$(total)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Action bar */}
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 16 }}>
          <button className="btn btn-primary" disabled={busy || total <= 0} onClick={syncToQbo}>
            {busy ? 'Working…' : synced ? 'Update in QuickBooks' : 'Send to QuickBooks'}
          </button>
          {synced && (
            <button className="btn btn-sm" disabled={busy} onClick={removeFromQbo} onBlur={() => setConfirmRemove(false)}
              style={{ background: confirmRemove ? '#fef2f2' : 'var(--bg-tertiary)', color: confirmRemove ? '#dc2626' : 'var(--text-tertiary)', border: `1px solid ${confirmRemove ? '#fecaca' : 'var(--border-light)'}` }}>
              {confirmRemove ? 'Confirm remove' : 'Remove from QuickBooks'}
            </button>
          )}
          {!synced && paid <= 0 && (
            <button className="btn btn-sm" disabled={busy} onClick={deleteDraft} onBlur={() => setConfirmDelete(false)}
              style={{ marginLeft: 'auto', background: confirmDelete ? '#fef2f2' : 'transparent', color: confirmDelete ? '#dc2626' : 'var(--text-tertiary)', border: `1px solid ${confirmDelete ? '#fecaca' : 'var(--border-light)'}` }}>
              {confirmDelete ? 'Confirm delete' : 'Delete draft'}
            </button>
          )}
        </div>
      )}
      {canEdit && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>Line edits save automatically. Click <b>{synced ? 'Update' : 'Send'} in QuickBooks</b> to push the invoice. Record payments from the claim's A/R panel.</div>}
    </div>
  );
}

const GRID = '1.3fr 1.4fr 1fr 70px 100px 110px 30px';
const inp = { width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' };
const sel = { ...inp, cursor: 'pointer' };
