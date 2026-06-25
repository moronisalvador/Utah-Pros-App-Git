/**
 * ════════════════════════════════════════════════
 * FILE: EstimateEditor.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The page where you build an estimate for a job, line by line. Each line has a
 *   QuickBooks item, an optional class, a description, a quantity and a price, and
 *   the page adds them up. From here you can save the estimate to QuickBooks, email
 *   it to the customer, and — when it's accepted — turn it into an invoice with one
 *   button (which also links it in QuickBooks). It mirrors the invoice editor.
 *
 * WHERE IT LIVES:
 *   Route:        /estimates/:estimateId
 *   Rendered by:  src/App.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext (db, isFeatureEnabled, employee),
 *              @/lib/realtime (getAuthHeader), @/lib/claimUtils (canEditBilling)
 *   Data:      reads  → estimates, estimate_line_items, jobs, claims, contacts;
 *                       QBO Item/Class catalog via /api/qbo-query
 *              writes → estimate_line_items (insert/update/delete); estimates +
 *                       QBO estimate via /api/qbo-estimate; on convert, invoices +
 *                       invoice_line_items via convert_estimate_to_invoice RPC and
 *                       /api/qbo-invoice
 *
 * NOTES / GOTCHAS:
 *   - estimate_line_items.line_total is a GENERATED column (quantity * unit_price) —
 *     never write it.
 *   - load() reads via a db ref so it runs once per estimate, not on every Supabase
 *     token refresh (same fix as InvoiceEditor — keeps in-progress edits alive).
 *   - Convert: runs convert_estimate_to_invoice (copies lines into the job's one
 *     invoice). If that invoice already has lines the RPC returns needs_confirm and
 *     the button asks for a second click. After converting it pushes the invoice to
 *     QBO, which carries LinkedTxn → the QBO estimate to complete the conversion there.
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import { canEditBilling } from '@/lib/claimUtils';
import AutoGrowTextarea from '@/components/AutoGrowTextarea';

const toast = (m, t = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));
const fmt$ = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (v) => v ? new Date(v + (String(v).includes('T') ? '' : 'T00:00:00')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const TYPE_LABEL = { initial: 'Initial', supplement: 'Supplement', change_order: 'Change order', final: 'Final' };

// Dedicated estimate editor — build line items (Item + Class per line), push to
// QuickBooks, email it, and convert to an invoice once accepted. Route: /estimates/:estimateId.
export default function EstimateEditor() {
  const { estimateId } = useParams();
  const navigate = useNavigate();
  const { db, isFeatureEnabled, employee } = useAuth();
  const canEdit = canEditBilling(employee?.role);

  // Keep the latest db client in a ref so load() runs once per estimate, not on every
  // token refresh / tab refocus (which would clobber in-progress edits). See InvoiceEditor.
  const dbRef = useRef(db);
  dbRef.current = db;

  const [est, setEst] = useState(null);
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
  const [confirmConvert, setConfirmConvert] = useState(false);

  const load = useCallback(async () => {
    const d = dbRef.current;
    setLoading(true);
    try {
      const e = (await d.select('estimates', `id=eq.${estimateId}&limit=1`))?.[0];
      if (!e) { toast('Estimate not found', 'error'); navigate('/estimates', { replace: true }); return; }
      setEst(e);
      const j = e.job_id ? (await d.select('jobs', `id=eq.${e.job_id}&select=id,division,job_number,claim_id,primary_contact_id&limit=1`))?.[0] : null;
      setJob(j || null);
      setClaim(j?.claim_id ? (await d.select('claims', `id=eq.${j.claim_id}&select=claim_number,insurance_carrier&limit=1`))?.[0] || null : null);
      const cid = e.contact_id || j?.primary_contact_id;
      setContact(cid ? (await d.select('contacts', `id=eq.${cid}&select=name,email&limit=1`))?.[0] || null : null);
      setLines(await d.select('estimate_line_items', `estimate_id=eq.${estimateId}&order=sort_order.asc,created_at.asc`) || []);
    } catch (e) {
      toast('Failed to load estimate: ' + (e.message || e), 'error');
    } finally {
      setLoading(false);
    }
  }, [estimateId, navigate]);

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

  const synced = !!est?.qbo_estimate_id;
  const converted = !!est?.converted_invoice_id;
  const total = lines.reduce((s, l) => s + Number(l.line_total || 0), 0);

  // ── Line handlers ──
  const addLine = async () => {
    setBusy(true);
    // line_total is a generated column (quantity * unit_price) — never write it.
    try { await db.insert('estimate_line_items', { estimate_id: estimateId, description: '', quantity: 1, unit_price: 0, sort_order: lines.length }); await load(); }
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
  // Persist a line on blur WITHOUT reloading — local state already reflects the edit.
  const saveLine = async (line) => {
    try {
      await db.update('estimate_line_items', `id=eq.${line.id}`, {
        description: line.description || '',
        qbo_item_id: line.qbo_item_id || null, qbo_item_name: line.qbo_item_name || null,
        qbo_class_id: line.qbo_class_id || null, qbo_class_name: line.qbo_class_name || null,
        quantity: Number(line.quantity || 0), unit_price: Number(line.unit_price || 0),
      });
    } catch (e) { toast('Failed to save line: ' + (e.message || e), 'error'); }
  };
  const removeLine = async (line) => {
    setBusy(true);
    try { await db.delete('estimate_line_items', `id=eq.${line.id}`); await load(); }
    catch { toast('Failed to remove line', 'error'); }
    finally { setBusy(false); }
  };

  // ── QBO actions ──
  const callWorker = async (body) => {
    const auth = await getAuthHeader();
    const res = await fetch('/api/qbo-estimate', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ estimate_id: estimateId, ...body }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  };
  // Persist current line state then push the latest amounts to QuickBooks — create on
  // first save, update thereafter, so the QBO copy always matches what's on screen.
  const flushAndPush = async () => {
    for (const l of lines) {
      await db.update('estimate_line_items', `id=eq.${l.id}`, {
        description: l.description || '',
        qbo_item_id: l.qbo_item_id || null, qbo_item_name: l.qbo_item_name || null,
        qbo_class_id: l.qbo_class_id || null, qbo_class_name: l.qbo_class_name || null,
        quantity: Number(l.quantity || 0), unit_price: Number(l.unit_price || 0),
      });
    }
    await callWorker({});
  };
  const saveEstimate = async () => {
    setBusy(true);
    try { await flushAndPush(); toast('Estimate saved'); await load(); }
    catch (e) { toast('Couldn’t save estimate: ' + e.message, 'error'); await load(); }
    finally { setBusy(false); }
  };
  // Email the estimate to the customer via QuickBooks. Two-click confirm (outward-facing).
  const emailEstimate = async () => {
    if (!confirmEmail) { setConfirmEmail(true); return; }
    setConfirmEmail(false); setBusy(true);
    try {
      await flushAndPush();
      const d = await callWorker({ action: 'send' });
      toast(`Estimate sent to ${d.emailed_to}`); await load();
    }
    catch (e) { toast('Couldn’t send estimate: ' + e.message, 'error'); await load(); }
    finally { setBusy(false); }
  };
  // Revert a saved estimate back to a draft (removes the QBO copy).
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
      for (const l of lines) await db.delete('estimate_line_items', `id=eq.${l.id}`);
      await db.delete('estimates', `id=eq.${estimateId}`);
      toast('Draft estimate deleted');
      navigate(job?.claim_id ? `/collections/${job.claim_id}` : '/estimates');
    } catch (e) { toast('Failed to delete: ' + (e.message || e), 'error'); setBusy(false); }
  };

  // ── Convert to invoice ──
  // Copies the estimate's lines into the job's (single) invoice and links them, then
  // pushes the invoice to QBO so the conversion completes there too (LinkedTxn → the
  // QBO estimate). If the invoice already has lines the RPC asks for a second click.
  const convertToInvoice = async () => {
    const force = confirmConvert;
    setBusy(true);
    try {
      // Make sure the estimate exists in QBO first so the invoice can link to it (best-effort).
      if (!est.qbo_estimate_id && total > 0) {
        try { await flushAndPush(); await load(); } catch { /* QBO may be off — convert in UPR anyway */ }
      }
      const res = await db.rpc('convert_estimate_to_invoice', { p_estimate_id: estimateId, p_force: force });
      const r = Array.isArray(res) ? res[0] : res;
      if (r?.needs_confirm) {
        setConfirmConvert(true);
        toast(`That job's invoice already has ${r.existing_line_count} line(s) — click again to append.`, 'error');
        setBusy(false);
        return;
      }
      const invId = r?.invoice_id;
      if (!invId) throw new Error('Convert did not return an invoice');
      setConfirmConvert(false);
      // Complete the conversion in QuickBooks: push the invoice (carries LinkedTxn → estimate).
      try {
        const auth = await getAuthHeader();
        const pr = await fetch('/api/qbo-invoice', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_id: invId }) });
        if (!pr.ok) { const d = await pr.json().catch(() => ({})); throw new Error(d.error || pr.statusText); }
        toast('Estimate converted to invoice & linked in QuickBooks');
      } catch (e) {
        toast('Converted to invoice — finish the QuickBooks push from the invoice: ' + e.message, 'error');
      }
      navigate(`/invoices/${invId}`);
    } catch (e) {
      toast('Convert failed: ' + (e.message || e), 'error');
      setBusy(false);
    }
  };

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;
  if (!est) return null;

  if (!isFeatureEnabled('page:estimates')) {
    return <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, color: 'var(--text-tertiary)' }}>Estimates are turned off (feature flag <code>page:estimates</code>).</div>;
  }

  const division = (est.intended_division || job?.division) ? String(est.intended_division || job?.division).replace(/_/g, ' ') : 'Estimate';
  // Draft → Sent (in QuickBooks / emailed) → Converted (turned into an invoice).
  const statusLabel = converted ? 'Converted' : !synced ? 'Draft' : est.qbo_emailed_at ? 'Sent' : 'Saved';
  const statusColor = statusLabel === 'Converted' ? '#16a34a' : statusLabel === 'Sent' ? 'var(--accent)' : statusLabel === 'Saved' ? 'var(--text-secondary)' : 'var(--text-tertiary)';

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '20px', paddingBottom: 96 }}>
      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/estimates')} style={{ gap: 4 }}>← Estimates</button>
        {synced && <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Estimate #{est.qbo_doc_number || est.estimate_number}{est.qbo_synced_at ? ' · saved ' + fmtDate(est.qbo_synced_at) : ''}</span>}
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>{est.qbo_doc_number || est.estimate_number || 'New estimate'}</div>
          {est.qbo_doc_number && est.qbo_doc_number !== est.estimate_number && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>UPR ref {est.estimate_number}</div>}
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 2 }}>
            {contact?.name || 'Client'} · <span style={{ textTransform: 'capitalize' }}>{division}</span> {job?.job_number || ''}{claim?.claim_number ? ` · ${claim.claim_number}` : ''}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
            {TYPE_LABEL[est.estimate_type] || 'Estimate'}{est.submitted_at ? ` · Sent ${fmtDate(est.submitted_at)}` : ''}
            {est.qbo_emailed_at && <> · Emailed {fmtDate(est.qbo_emailed_at)}</>}
          </div>
          {est.property_address && (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
              📍 {est.property_address}{est.property_city ? `, ${est.property_city}` : ''}{est.property_state ? `, ${est.property_state}` : ''}{est.property_zip ? ` ${est.property_zip}` : ''}
            </div>
          )}
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, padding: '4px 12px', borderRadius: 'var(--radius-full)', background: 'var(--bg-secondary)', color: statusColor, border: `1px solid ${statusColor}40` }}>{statusLabel}</span>
      </div>

      {est.qbo_sync_error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>Couldn’t save estimate: {est.qbo_sync_error}</div>}
      {catalogMsg && canEdit && <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#d97706', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>{catalogMsg}</div>}
      {converted && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#16a34a', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 13, marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>✓ Converted to an invoice. <button className="btn btn-sm" onClick={() => navigate(`/invoices/${est.converted_invoice_id}`)} style={{ background: '#fff', border: '1px solid #bbf7d0', color: '#16a34a' }}>View invoice →</button></div>}

      {/* Line items */}
      <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginTop: 6 }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 720 }}>
            <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '10px 14px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <span>Item</span><span>Description</span><span>Class</span><span>Qty</span><span>Rate</span><span style={{ textAlign: 'right' }}>Amount</span>{canEdit && !converted && <span />}
            </div>
            {lines.length === 0 && <div style={{ padding: '20px 14px', color: 'var(--text-tertiary)', fontSize: 13 }}>No line items yet. {canEdit ? 'Add a line to build the estimate.' : ''}</div>}
            {lines.map(l => (
              <div key={l.id} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--border-light)', alignItems: 'flex-start' }}>
                {canEdit && !converted ? (
                  <>
                    <select value={l.qbo_item_id || ''} disabled={!qboItems.length} onChange={e => { const it = qboItems.find(i => i.id === e.target.value); const patch = { qbo_item_id: it?.id || null, qbo_item_name: it?.name || null }; setLineLocal(l.id, patch); saveLine({ ...l, ...patch }); }} style={sel}>
                      <option value="">{qboItems.length ? 'Select item…' : '—'}</option>
                      {qboItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                    <AutoGrowTextarea value={l.description || ''} placeholder="Description / scope of work" onChange={e => setLineLocal(l.id, { description: e.target.value })} onBlur={() => saveLine(l)} style={txt} />
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
              {canEdit && !converted ? <button className="btn btn-secondary btn-sm" disabled={busy} onClick={addLine}>+ Add line</button> : <span />}
              <div style={{ fontSize: 16, fontWeight: 800 }}>Total: {fmt$(total)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Action bar */}
      {canEdit && !converted && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 16 }}>
          <button className="btn btn-primary" disabled={busy || total <= 0} onClick={saveEstimate}>
            {busy ? 'Saving…' : synced ? 'Save' : 'Save estimate'}
          </button>
          {synced && (
            <button className="btn btn-secondary" disabled={busy} onClick={emailEstimate} onBlur={() => setConfirmEmail(false)}
              title={contact?.email ? `Send to ${contact.email}` : 'No email on file — add one to the contact first'}
              style={confirmEmail ? { background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid #bfdbfe' } : undefined}>
              {confirmEmail ? 'Confirm send' : est.qbo_emailed_at ? '✉ Resend estimate' : '✉ Send estimate to customer'}
            </button>
          )}
          {total > 0 && (
            <button className="btn btn-secondary" disabled={busy} onClick={convertToInvoice} onBlur={() => setConfirmConvert(false)}
              title="Turn this accepted estimate into an invoice (and link it in QuickBooks)"
              style={confirmConvert ? { background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' } : { background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
              {busy ? 'Working…' : confirmConvert ? 'Confirm — append to invoice' : '→ Convert to invoice'}
            </button>
          )}
          {synced && (
            <button className="btn btn-sm" disabled={busy} onClick={revertToDraft} onBlur={() => setConfirmRemove(false)}
              style={{ background: confirmRemove ? '#fef2f2' : 'var(--bg-tertiary)', color: confirmRemove ? '#dc2626' : 'var(--text-tertiary)', border: `1px solid ${confirmRemove ? '#fecaca' : 'var(--border-light)'}` }}>
              {confirmRemove ? 'Confirm revert' : 'Revert to draft'}
            </button>
          )}
          {!synced && (
            <button className="btn btn-sm" disabled={busy} onClick={deleteDraft} onBlur={() => setConfirmDelete(false)}
              style={{ marginLeft: 'auto', background: confirmDelete ? '#fef2f2' : 'transparent', color: confirmDelete ? '#dc2626' : 'var(--text-tertiary)', border: `1px solid ${confirmDelete ? '#fecaca' : 'var(--border-light)'}` }}>
              {confirmDelete ? 'Confirm delete' : 'Delete draft'}
            </button>
          )}
        </div>
      )}
      {canEdit && !converted && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>Line edits save as you type. Click <b>Save</b> to record the estimate in QuickBooks{synced ? <>, <b>Send</b> to email it, or <b>Convert to invoice</b> once it’s accepted</> : ''}.</div>}
    </div>
  );
}

// Description takes the most room (scope of work goes here); minWidth keeps mobile
// horizontally scrollable exactly as before.
const GRID = '1.1fr 2.6fr 0.9fr 60px 100px 115px 28px';
const inp = { width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' };
const sel = { ...inp, cursor: 'pointer' };
// Description textarea: matches the inputs on the first line, then grows downward.
const txt = { ...inp, lineHeight: 1.4, minHeight: 32, display: 'block' };
