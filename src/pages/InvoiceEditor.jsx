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
  const [confirmEmail, setConfirmEmail] = useState(false);

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
      setContact(cid ? (await db.select('contacts', `id=eq.${cid}&select=name,email&limit=1`))?.[0] || null : null);
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
    // line_total is a generated column (quantity * unit_price) — never write it.
    try { await db.insert('invoice_line_items', { invoice_id: invoiceId, description: '', quantity: 1, unit_price: 0, sort_order: lines.length }); await load(); }
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
      // description is NOT NULL; line_total is generated (quantity * unit_price) — don't write it.
      await db.update('invoice_line_items', `id=eq.${line.id}`, {
        description: line.description || '',
        qbo_item_id: line.qbo_item_id || null, qbo_item_name: line.qbo_item_name || null,
        qbo_class_id: line.qbo_class_id || null, qbo_class_name: line.qbo_class_name || null,
        quantity: Number(line.quantity || 0), unit_price: Number(line.unit_price || 0),
      });
      await load();
    } catch (e) { toast('Failed to save line: ' + (e.message || e), 'error'); }
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
  // Save the invoice: flush any pending line edits to the DB, then record the invoice
  // (this also syncs it to QuickBooks under the hood — create on first save, update
  // thereafter, so existing invoices stay in sync on every save).
  const saveInvoice = async () => {
    setBusy(true);
    try {
      // Persist current line state first so the recorded invoice uses the latest amounts
      // (covers the field that hasn't blurred yet when Save is clicked).
      for (const l of lines) {
        await db.update('invoice_line_items', `id=eq.${l.id}`, {
          description: l.description || '',
          qbo_item_id: l.qbo_item_id || null, qbo_item_name: l.qbo_item_name || null,
          qbo_class_id: l.qbo_class_id || null, qbo_class_name: l.qbo_class_name || null,
          quantity: Number(l.quantity || 0), unit_price: Number(l.unit_price || 0),
        });
      }
      await callWorker({});
      toast('Invoice saved');
      await load();
    } catch (e) { toast('Couldn’t save invoice: ' + e.message, 'error'); await load(); }
    finally { setBusy(false); }
  };
  // Send the invoice to the customer by email. Two-click confirm — it's an outward-facing
  // send to the client. Requires the invoice to have been saved first.
  const emailInvoice = async () => {
    if (!confirmEmail) { setConfirmEmail(true); return; }
    setConfirmEmail(false); setBusy(true);
    try { const d = await callWorker({ action: 'send' }); toast(`Invoice sent to ${d.emailed_to}`); await load(); }
    catch (e) { toast('Couldn’t send invoice: ' + e.message, 'error'); }
    finally { setBusy(false); }
  };
  // Revert a saved invoice back to a draft (unrecords it, removing the QBO copy).
  const revertToDraft = async () => {
    if (!confirmRemove) { setConfirmRemove(true); return; }
    setConfirmRemove(false); setBusy(true);
    try { await callWorker({ action: 'delete' }); toast('Reverted to draft'); await load(); }
    catch (e) { toast('Couldn’t revert: ' + e.message, 'error'); }
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

  // ── Stripe pay-by-link (dormant until Stripe keys exist → worker returns 503) ──
  const createPayLink = async () => {
    setBusy(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/stripe-pay-link', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_id: invoiceId }) });
      const d = await res.json().catch(() => ({}));
      if (res.status === 503) { toast('Stripe is not set up yet — add keys in Payment Settings.', 'error'); return; }
      if (!res.ok) throw new Error(d.error || res.statusText);
      try { await navigator.clipboard.writeText(d.url); toast('Pay link created & copied'); }
      catch { toast('Pay link created'); }
      await load();
    } catch (e) { toast('Pay link: ' + (e.message || e), 'error'); }
    finally { setBusy(false); }
  };
  const copyPayLink = async () => {
    try { await navigator.clipboard.writeText(inv.stripe_payment_link_url); toast('Pay link copied'); }
    catch { toast('Copy failed — long-press the link to copy', 'error'); }
  };

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;
  if (!inv) return null;

  if (!isFeatureEnabled('feature:billing')) {
    return <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, color: 'var(--text-tertiary)' }}>Billing is turned off (feature flag <code>feature:billing</code>).</div>;
  }

  const division = job?.division ? String(job.division).replace(/_/g, ' ') : 'Job';
  const paid = Number(inv.amount_paid || 0);
  // Draft → Saved (recorded, not yet emailed) → Sent (emailed to customer) → Partial → Paid.
  const statusLabel = !synced ? 'Draft'
    : (paid >= total && total > 0) ? 'Paid'
    : paid > 0 ? 'Partial'
    : inv.qbo_emailed_at ? 'Sent'
    : 'Saved';
  const statusColor = statusLabel === 'Paid' ? '#16a34a' : statusLabel === 'Partial' ? '#d97706' : statusLabel === 'Sent' ? 'var(--accent)' : statusLabel === 'Saved' ? 'var(--text-secondary)' : 'var(--text-tertiary)';

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '20px', paddingBottom: 96 }}>
      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => (job?.claim_id ? navigate(`/collections/${job.claim_id}`) : navigate(-1))} style={{ gap: 4 }}>← Back</button>
        {synced && <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Invoice #{inv.qbo_doc_number || inv.invoice_number}{inv.qbo_synced_at ? ' · saved ' + fmtDate(inv.qbo_synced_at) : ''}</span>}
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>{inv.qbo_doc_number || inv.invoice_number}</div>
          {inv.qbo_doc_number && inv.qbo_doc_number !== inv.invoice_number && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>UPR ref {inv.invoice_number}</div>}
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 2 }}>
            {contact?.name || 'Client'} · <span style={{ textTransform: 'capitalize' }}>{division}</span> {job?.job_number || ''}{claim?.claim_number ? ` · ${claim.claim_number}` : ''}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
            Sent {inv.sent_at ? fmtDate(inv.sent_at) : '—'} · Due {inv.due_date ? fmtDate(inv.due_date) : '—'}
            {inv.qbo_emailed_at && <> · Emailed {fmtDate(inv.qbo_emailed_at)}</>}
          </div>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, padding: '4px 12px', borderRadius: 'var(--radius-full)', background: 'var(--bg-secondary)', color: statusColor, border: `1px solid ${statusColor}40` }}>{statusLabel}</span>
      </div>

      {inv.qbo_sync_error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>Couldn’t save invoice: {inv.qbo_sync_error}</div>}
      {catalogMsg && canEdit && <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#d97706', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>{catalogMsg}</div>}
      {inv.stripe_payment_link_url && <div style={{ background: 'var(--accent-light)', border: '1px solid #bfdbfe', color: 'var(--accent)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 13, marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>💳 Card pay link active — <a href={inv.stripe_payment_link_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', wordBreak: 'break-all' }}>{inv.stripe_payment_link_url}</a></div>}

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
          <button className="btn btn-primary" disabled={busy || total <= 0} onClick={saveInvoice}>
            {busy ? 'Saving…' : synced ? 'Save' : 'Save invoice'}
          </button>
          {synced && (
            <button className="btn btn-secondary" disabled={busy} onClick={emailInvoice} onBlur={() => setConfirmEmail(false)}
              title={contact?.email ? `Send to ${contact.email}` : 'No email on file — add one to the contact first'}
              style={confirmEmail ? { background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid #bfdbfe' } : undefined}>
              {confirmEmail ? 'Confirm send' : inv.qbo_emailed_at ? '✉ Resend invoice' : '✉ Send invoice to customer'}
            </button>
          )}
          {total > 0 && (
            inv.stripe_payment_link_url
              ? <button className="btn btn-secondary" disabled={busy} onClick={copyPayLink} title={inv.stripe_payment_link_url}>💳 Copy pay link</button>
              : <button className="btn btn-secondary" disabled={busy} onClick={createPayLink}>💳 Create pay link</button>
          )}
          {synced && (
            <button className="btn btn-sm" disabled={busy} onClick={revertToDraft} onBlur={() => setConfirmRemove(false)}
              style={{ background: confirmRemove ? '#fef2f2' : 'var(--bg-tertiary)', color: confirmRemove ? '#dc2626' : 'var(--text-tertiary)', border: `1px solid ${confirmRemove ? '#fecaca' : 'var(--border-light)'}` }}>
              {confirmRemove ? 'Confirm revert' : 'Revert to draft'}
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
      {canEdit && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>Line edits save as you type. Click <b>Save</b> to record the invoice{synced ? <>, then <b>Send invoice to customer</b> to email it</> : ''}. Record payments from the claim's A/R panel.</div>}
    </div>
  );
}

const GRID = '1.3fr 1.4fr 1fr 70px 100px 110px 30px';
const inp = { width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' };
const sel = { ...inp, cursor: 'pointer' };
