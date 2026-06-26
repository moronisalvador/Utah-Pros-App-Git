/**
 * ════════════════════════════════════════════════
 * FILE: EstimateEditor.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The full estimate builder for one estimate (opened from the My Money /
 *   Collections "Estimates" tab). You build the line items (each with a QuickBooks
 *   Item + Class, a typed description, quantity and rate), see the running total,
 *   preview/print what the customer gets, save/send it to QuickBooks, and — once it's
 *   accepted — turn it into an invoice in one click. Mirrors the invoice builder.
 *
 * WHERE IT LIVES:
 *   Route:        /estimates/:estimateId
 *   Rendered by:  src/App.jsx (inside the Layout shell)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/components/collections/{collKit, collTokens, SearchSelect},
 *              @/components/AutoGrowTextarea, @/lib/realtime (getAuthHeader),
 *              @/lib/claimUtils (canEditBilling), @/contexts/AuthContext
 *   Data:      reads  → estimates, estimate_line_items, jobs, claims, contacts
 *              writes → estimate_line_items (add/edit/reorder/remove); estimates + QBO
 *                       estimate via /api/qbo-estimate; on convert, invoices via
 *                       convert_estimate_to_invoice RPC + /api/qbo-invoice
 *
 * NOTES / GOTCHAS:
 *   - estimate_line_items.line_total is a GENERATED column (quantity × unit_price) —
 *     never written.
 *   - dbRef keeps the latest Supabase client so load() runs once per estimate (not on
 *     every token refresh), preserving in-progress edits.
 *   - A CONVERTED estimate is read-only (it became an invoice). Convert copies the
 *     lines into the job's one invoice; if that invoice already has lines the RPC
 *     returns needs_confirm and the button asks for a second click.
 *   - Back button uses navigate(-1) so it returns to wherever you came from.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import { canEditBilling } from '@/lib/claimUtils';
import AutoGrowTextarea from '@/components/AutoGrowTextarea';
import SearchSelect from '@/components/collections/SearchSelect';
import ActionMenu from '@/components/collections/ActionMenu';
import { CollCard, GhostButton, PrimaryButton, Pill, MapPin } from '@/components/collections/collKit';
import { C, STATUS, fmt$2, fmtDate, mono, tnum, divLabel } from '@/components/collections/collTokens';

const toast = (m, t = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
// Compact saved stamp: "06-22-26 2:30 PM"
const fmtStamp = (iso) => {
  if (!iso) return '';
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getFullYear() % 100)} ${h}:${p(d.getMinutes())} ${ap}`;
};
const TYPE_LABEL = { initial: 'Initial', supplement: 'Supplement', change_order: 'Change order', final: 'Final' };
const EST_STATUS = { Converted: STATUS.success, Sent: STATUS.info, Saved: STATUS.neutral, Draft: STATUS.neutral };

export default function EstimateEditor() {
  const { estimateId } = useParams();
  const navigate = useNavigate();
  const { db, isFeatureEnabled, employee } = useAuth();
  const canEdit = canEditBilling(employee?.role);

  const dbRef = useRef(db);
  dbRef.current = db;

  // ─── SECTION: State & hooks ──────────────
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
  const [confirmEmail, setConfirmEmail] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const dragIdx = useRef(null);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    const d = dbRef.current;
    setLoading(true);
    try {
      const e = (await d.select('estimates', `id=eq.${estimateId}&limit=1`))?.[0];
      if (!e) { toast('Estimate not found', 'error'); navigate('/collections?tab=estimates', { replace: true }); return; }
      setEst(e);
      const j = e.job_id ? (await d.select('jobs', `id=eq.${e.job_id}&select=id,division,job_number,claim_id,primary_contact_id&limit=1`))?.[0] : null;
      setJob(j || null);
      setClaim(j?.claim_id ? (await d.select('claims', `id=eq.${j.claim_id}&select=claim_number,insurance_carrier,date_of_loss&limit=1`))?.[0] || null : null);
      const cid = e.contact_id || j?.primary_contact_id;
      setContact(cid ? (await d.select('contacts', `id=eq.${cid}&select=name,email&limit=1`))?.[0] || null : null);
      let ls = await d.select('estimate_line_items', `estimate_id=eq.${estimateId}&order=sort_order.asc,created_at.asc`) || [];
      // Start a fresh editable draft with one blank line so the builder opens ready to type.
      if (ls.length === 0 && canEdit && !e.converted_invoice_id && !e.qbo_estimate_id) {
        try {
          const created = await d.insert('estimate_line_items', { estimate_id: estimateId, description: '', quantity: 1, unit_price: 0, sort_order: 0 });
          const row = Array.isArray(created) ? created[0] : created;
          if (row) ls = [row];
        } catch { /* non-fatal — user can still + Add line */ }
      }
      setLines(ls);
    } catch (e) {
      toast('Failed to load estimate: ' + (e.message || e), 'error');
    } finally {
      setLoading(false);
    }
  }, [estimateId, navigate, canEdit]);

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
        run('SELECT Id, Name, Type FROM Item WHERE Active = true MAXRESULTS 200'),
        run('SELECT Id, Name FROM Class WHERE Active = true MAXRESULTS 200'),
      ]);
      // Drop QBO "Category" items: categories are organizational parents, NOT sellable
      // products/services. Referencing one on a line makes QBO reject the whole estimate
      // ("An item in this transaction is set up as a category instead of a product or
      // service."). QBO's query API can't filter Type server-side (Type != 'Category'
      // errors), so we filter here — only real products/services stay selectable.
      setQboItems((itemsR.Item || []).filter((i) => i.Type !== 'Category').map((i) => ({ id: String(i.Id), name: i.Name })));
      setQboClasses((classesR.Class || []).map((c) => ({ id: String(c.Id), name: c.Name })));
      setCatalogMsg('');
    } catch (e) {
      setCatalogMsg(/not connected/i.test(e.message || '') ? 'Connect QuickBooks (Dev Tools) to load items & classes.' : 'QuickBooks catalog unavailable.');
    }
  }, []);
  useEffect(() => { if (canEdit) loadCatalog(); }, [canEdit, loadCatalog]);

  // ─── SECTION: Line handlers ──────────────
  const addLine = async () => {
    setBusy(true);
    try { await db.insert('estimate_line_items', { estimate_id: estimateId, description: '', quantity: 1, unit_price: 0, sort_order: lines.length }); await load(); }
    catch (e) { toast('Failed to add line: ' + (e.message || e), 'error'); }
    finally { setBusy(false); }
  };
  const setLineLocal = (lineId, patch) => {
    setLines((prev) => prev.map((l) => {
      if (l.id !== lineId) return l;
      const next = { ...l, ...patch };
      if ('quantity' in patch || 'unit_price' in patch) next.line_total = round2(Number(next.quantity || 0) * Number(next.unit_price || 0));
      return next;
    }));
  };
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
  const onDropRow = async (toIdx) => {
    const from = dragIdx.current; dragIdx.current = null;
    if (from == null || from === toIdx) return;
    const next = [...lines];
    const [moved] = next.splice(from, 1);
    next.splice(toIdx, 0, moved);
    setLines(next);
    try { for (let i = 0; i < next.length; i++) if (next[i].sort_order !== i) await db.update('estimate_line_items', `id=eq.${next[i].id}`, { sort_order: i }); }
    catch { toast('Failed to reorder lines', 'error'); await load(); }
  };

  // ─── SECTION: QBO actions ──────────────
  const callWorker = async (body) => {
    const auth = await getAuthHeader();
    const res = await fetch('/api/qbo-estimate', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ estimate_id: estimateId, ...body }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  };
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
  const doRevert = async () => {
    setBusy(true);
    try { await callWorker({ action: 'delete' }); toast('Reverted to draft'); await load(); }
    catch (e) { toast('Couldn’t revert: ' + e.message, 'error'); }
    finally { setBusy(false); }
  };
  const doDelete = async () => {
    setBusy(true);
    try {
      for (const l of lines) await db.delete('estimate_line_items', `id=eq.${l.id}`);
      await db.delete('estimates', `id=eq.${estimateId}`);
      toast('Draft estimate deleted');
      navigate(-1);
    } catch (e) { toast('Failed to delete: ' + (e.message || e), 'error'); setBusy(false); }
  };

  // Convert an accepted estimate into the job's invoice (and link it in QuickBooks).
  const convertToInvoice = async () => {
    const force = confirmConvert;
    setBusy(true);
    try {
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

  // ─── SECTION: Derived values ──────────────
  if (loading) return <div className="loading-page"><div className="spinner" /></div>;
  if (!est) return null;
  if (!isFeatureEnabled('page:estimates')) {
    return <div style={{ maxWidth: 900, margin: '40px auto', padding: 24, color: C.muted }}>Estimates are turned off (feature flag <code>page:estimates</code>).</div>;
  }

  const synced = !!est.qbo_estimate_id;
  const converted = !!est.converted_invoice_id;
  const editable = canEdit && !converted;
  const division = divLabel(est.intended_division || job?.division) || 'Estimate';
  const subtotal = lines.reduce((s, l) => s + Number(l.line_total || 0), 0);
  const total = round2(subtotal);
  const docNumber = est.qbo_doc_number || est.estimate_number || 'New estimate';
  const statusLabel = converted ? 'Converted' : !synced ? 'Draft' : est.qbo_emailed_at ? 'Sent' : 'Saved';
  const st = EST_STATUS[statusLabel] || STATUS.neutral;
  const addr = est.property_address ? `${est.property_address}${est.property_city ? `, ${est.property_city}` : ''}${est.property_state ? `, ${est.property_state}` : ''}${est.property_zip ? ` ${est.property_zip}` : ''}` : '';
  const GRID = editable ? '22px 1.15fr 2.3fr 1fr 56px 92px 100px 26px' : '1.2fr 2.6fr 1fr 56px 92px 110px';

  // Lines whose saved Item is no longer a valid product/service (e.g. a QBO category
  // picked before categories were filtered out, or a since-deactivated item). These
  // still break the QBO push, and SearchSelect renders them as a blank Item cell — so
  // flag them so the user knows to re-pick. Only check once the catalog has loaded, or
  // we'd false-flag every line while qboItems is still empty.
  const invalidItemLines = qboItems.length
    ? lines.filter((l) => l.qbo_item_id && !qboItems.some((i) => i.id === String(l.qbo_item_id)))
    : [];
  const invalidItemNames = [...new Set(invalidItemLines.map((l) => l.qbo_item_name).filter(Boolean))];

  // ─── SECTION: Render ──────────────
  return (
    <div className="coll-page">
      <style>{`@media print { body * { visibility: hidden !important; } .est-print-doc, .est-print-doc * { visibility: visible !important; } .est-print-doc { position: absolute !important; left: 0; top: 0; width: 100%; box-shadow: none !important; border: none !important; } .est-no-print { display: none !important; } }`}</style>

      {/* Top bar — Back + QBO-style action toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <GhostButton onClick={() => navigate(-1)}>← Back</GhostButton>
        <div className="est-no-print" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {synced && est.qbo_synced_at && <span style={{ fontSize: 11.5, color: C.faint, marginRight: 2 }}>✓ {fmtStamp(est.qbo_synced_at)}</span>}
          {editable && (
            <PrimaryButton onClick={saveEstimate} style={{ opacity: (busy || subtotal <= 0) ? 0.6 : 1, pointerEvents: (busy || subtotal <= 0) ? 'none' : 'auto' }}>
              {busy ? 'Saving…' : synced ? 'Save' : 'Save estimate'}
            </PrimaryButton>
          )}
          {editable && synced && (
            <GhostButton onClick={emailEstimate} title={contact?.email ? `Send to ${contact.email}` : 'No email on file — add one to the contact first'}
              style={confirmEmail ? { background: STATUS.info.tint, color: STATUS.info.text, borderColor: STATUS.info.border } : undefined}>
              {confirmEmail ? 'Confirm send' : est.qbo_emailed_at ? '✉ Resend' : '✉ Send to customer'}
            </GhostButton>
          )}
          {editable && total > 0 && (
            <button type="button" onClick={convertToInvoice} onBlur={() => setConfirmConvert(false)} disabled={busy}
              title="Turn this accepted estimate into an invoice (and link it in QuickBooks)"
              style={confirmConvert
                ? { ...btnSm, background: STATUS.danger.tint, color: STATUS.danger.text, border: `1px solid ${STATUS.danger.border}` }
                : { ...btnSm, background: STATUS.success.tint, color: STATUS.success.text, border: `1px solid ${STATUS.success.border}` }}>
              {busy ? 'Working…' : confirmConvert ? 'Confirm — append to invoice' : '→ Convert to invoice'}
            </button>
          )}
          <GhostButton onClick={() => setShowPreview(true)}>⎙ Preview</GhostButton>
          {editable && (
            <ActionMenu items={[
              { key: 'revert', label: 'Revert to draft', onSelect: doRevert, confirm: true, danger: true, show: synced },
              { key: 'delete', label: 'Delete draft', onSelect: doDelete, confirm: true, danger: true, show: !synced },
            ]} />
          )}
        </div>
      </div>

      {/* Header card — number + prepared-for + details (no lateral panel) */}
      <CollCard style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.1em', color: C.faint, textTransform: 'uppercase' }}>Estimate</span>
          <Pill color={st.text} bg={st.tint} border={st.border} style={{ letterSpacing: '.04em' }}>{statusLabel.toUpperCase()}</Pill>
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: C.ink, letterSpacing: '-.02em', marginTop: 2, ...tnum }}>{docNumber}</div>
        {est.qbo_doc_number && est.qbo_doc_number !== est.estimate_number && <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>UPR ref {est.estimate_number}</div>}
        <div style={{ marginTop: 12 }}>
          <SectionLabel>Prepared for</SectionLabel>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{contact?.name || '—'}</div>
          {contact?.email && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 1 }}>{contact.email}</div>}
        </div>
        <div style={{ height: 1, background: C.hairline, margin: '14px 0' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px 20px' }}>
          <Field label="Type" value={TYPE_LABEL[est.estimate_type] || 'Estimate'} />
          <Field label="Carrier" value={claim?.insurance_carrier || '—'} />
          <Field label="Claim" value={claim?.claim_number || '—'} mono />
          <Field label="Job" value={job?.job_number ? `${job.job_number} · ${division}` : division} />
          {claim?.date_of_loss && <Field label="Date of loss" value={fmtDate(claim.date_of_loss)} />}
          <Field label="Sent" value={est.submitted_at ? fmtDate(est.submitted_at) : 'Not sent'} />
        </div>
        {addr && <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.muted, marginTop: 12 }}><MapPin /> {addr}</div>}
        <div style={{ fontSize: 10.5, color: C.faint2, marginTop: addr ? 6 : 8 }}>The customer memo is generated automatically when the estimate is sent to QuickBooks.</div>
      </CollCard>

      {/* Banners */}
      {est.qbo_sync_error && <div style={bannerStyle(STATUS.danger)}>Couldn’t save estimate: {est.qbo_sync_error}</div>}
      {catalogMsg && editable && <div style={bannerStyle(STATUS.warning)}>{catalogMsg}</div>}
      {editable && invalidItemLines.length > 0 && (
        <div style={bannerStyle(STATUS.warning)}>
          {invalidItemLines.length === 1 ? 'A line item is' : `${invalidItemLines.length} line items are`} set to a QuickBooks category{invalidItemNames.length ? ` (${invalidItemNames.join(', ')})` : ''}, which QuickBooks won’t accept on an estimate — only products or services can be billed. Re-pick a product/service for {invalidItemLines.length === 1 ? 'that line' : 'those lines'} (for a discount, use “Discounts and Adjustments”), then Save.
        </div>
      )}
      {converted && <div style={bannerStyle(STATUS.success)}>✓ Converted to an invoice. <button type="button" onClick={() => navigate(`/invoices/${est.converted_invoice_id}`)} style={{ background: 'none', border: 'none', color: STATUS.success.text, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit', fontSize: 13 }}>View invoice →</button></div>}

      {/* Single column: line items → actions (no lateral panel) */}
      <div>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <CollCard pad={0}>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: editable ? 660 : 560 }}>
                <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '11px 16px', background: C.headFill, borderBottom: `1px solid ${C.cardBorder}`, fontSize: 10.5, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  {editable && <span />}
                  <span>Item</span><span>Description</span><span>Class</span><span>Qty</span><span>Rate</span><span style={{ textAlign: 'right' }}>Amount</span>{editable && <span />}
                </div>

                {lines.length === 0 && (
                  <div style={{ padding: '28px 16px', textAlign: 'center', color: C.faint, fontSize: 13 }}>No line items yet.{editable ? ' Add a line to build the estimate.' : ''}</div>
                )}

                {lines.map((l, idx) => (
                  <div
                    key={l.id}
                    draggable={editable}
                    onDragStart={() => { dragIdx.current = idx; }}
                    onDragOver={(e) => { if (editable) e.preventDefault(); }}
                    onDrop={() => editable && onDropRow(idx)}
                    style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '8px 16px', borderBottom: `1px solid ${C.hairline}`, alignItems: 'start' }}
                  >
                    {editable ? (
                      <>
                        <span title="Drag to reorder" style={{ cursor: 'grab', color: C.faint2, fontSize: 15, lineHeight: '32px', userSelect: 'none', textAlign: 'center' }}>⠿</span>
                        <SearchSelect value={l.qbo_item_id || ''} options={qboItems} disabled={!qboItems.length} placeholder={qboItems.length ? 'Item…' : '—'}
                          onChange={(it) => { const patch = { qbo_item_id: it?.id || null, qbo_item_name: it?.name || null }; setLineLocal(l.id, patch); saveLine({ ...l, ...patch }); }} />
                        <AutoGrowTextarea value={l.description || ''} placeholder="Description / scope of work" onChange={(e) => setLineLocal(l.id, { description: e.target.value })} onBlur={() => saveLine(l)} style={cellTxt} />
                        <SearchSelect value={l.qbo_class_id || ''} options={qboClasses} disabled={!qboClasses.length} placeholder={qboClasses.length ? 'Class…' : '—'}
                          onChange={(c) => { const patch = { qbo_class_id: c?.id || null, qbo_class_name: c?.name || null }; setLineLocal(l.id, patch); saveLine({ ...l, ...patch }); }} />
                        <input type="number" inputMode="decimal" value={l.quantity ?? ''} onChange={(e) => setLineLocal(l.id, { quantity: e.target.value })} onBlur={() => saveLine(l)} style={cellInp} />
                        <input type="number" inputMode="decimal" value={l.unit_price ?? ''} onChange={(e) => setLineLocal(l.id, { unit_price: e.target.value })} onBlur={() => saveLine(l)} style={cellInp} />
                        <span style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, color: C.ink, lineHeight: '32px', ...tnum }}>{fmt$2(l.line_total)}</span>
                        <button onClick={() => removeLine(l)} disabled={busy} title="Remove line" style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.faint2, fontSize: 16, lineHeight: '32px' }}>✕</button>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: 13, color: C.ink }}>{l.qbo_item_name || '—'}</span>
                        <span style={{ fontSize: 13, color: C.body }}>{l.description || '—'}</span>
                        <span style={{ fontSize: 13, color: C.muted }}>{l.qbo_class_name || '—'}</span>
                        <span style={{ fontSize: 13, ...tnum }}>{Number(l.quantity || 0)}</span>
                        <span style={{ fontSize: 13, ...tnum }}>{fmt$2(l.unit_price)}</span>
                        <span style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, ...tnum }}>{fmt$2(l.line_total)}</span>
                      </>
                    )}
                  </div>
                ))}

                {/* Footer: add line + totals */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '12px 16px', background: C.headFill }}>
                  {editable ? <GhostButton onClick={addLine} style={{ opacity: busy ? 0.6 : 1 }}>+ Add line</GhostButton> : <span />}
                  <div style={{ minWidth: 200 }}>
                    <TotalRow label="Subtotal" value={fmt$2(subtotal)} />
                    <div style={{ height: 1, background: C.cardBorder, margin: '6px 0' }} />
                    <TotalRow label="Total" value={fmt$2(total)} strong />
                  </div>
                </div>
              </div>
            </div>
          </CollCard>

          {editable && <div className="est-no-print" style={{ fontSize: 11.5, color: C.faint }}>Line edits save as you type. Use <b>Save</b> (top) to record the estimate in QuickBooks{synced ? <>, <b>Send</b> to email it, or <b>Convert to invoice</b> once it’s accepted</> : ''}.</div>}
        </div>
      </div>

      {/* Customer preview overlay */}
      {showPreview && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(16,24,40,.45)', overflowY: 'auto', padding: '24px 16px' }} onClick={() => setShowPreview(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, margin: '0 auto' }}>
            <div className="est-no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 10 }}>
              <PrimaryButton onClick={() => window.print()}>⎙ Print / Save PDF</PrimaryButton>
              <GhostButton onClick={() => setShowPreview(false)} style={{ background: '#fff' }}>Close</GhostButton>
            </div>
            <div className="est-print-doc" style={{ background: '#fff', borderRadius: 12, padding: '36px 40px', boxShadow: '0 12px 40px rgba(16,24,40,.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.ink }}>Utah Pros Restoration</div>
                  <div style={{ fontSize: 12, color: C.muted }}>Estimate</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: '.04em' }}>ESTIMATE</div>
                  <div style={{ fontSize: 12.5, color: C.body, marginTop: 2 }}>#{docNumber}</div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginTop: 24 }}>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.faint }}>Prepared for</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, marginTop: 3 }}>{contact?.name || '—'}</div>
                  {contact?.email && <div style={{ fontSize: 12.5, color: C.muted }}>{contact.email}</div>}
                  {claim?.claim_number && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Claim {claim.claim_number}{claim.insurance_carrier ? ` · ${claim.insurance_carrier}` : ''}</div>}
                  {addr && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{addr}</div>}
                </div>
                <div style={{ textAlign: 'right', fontSize: 12.5, color: C.body }}>
                  <div>{TYPE_LABEL[est.estimate_type] || 'Estimate'}</div>
                  <div>{est.submitted_at ? `Sent ${fmtDate(est.submitted_at)}` : 'Draft'}</div>
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 24, fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${C.cardBorder}`, color: C.faint, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>Description</th>
                    <th style={{ textAlign: 'right', padding: '8px 6px', width: 60 }}>Qty</th>
                    <th style={{ textAlign: 'right', padding: '8px 6px', width: 90 }}>Rate</th>
                    <th style={{ textAlign: 'right', padding: '8px 6px', width: 100 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 && <tr><td colSpan={4} style={{ padding: '16px 6px', color: C.faint }}>No line items.</td></tr>}
                  {lines.map((l) => (
                    <tr key={l.id} style={{ borderBottom: `1px solid ${C.hairline}` }}>
                      <td style={{ padding: '9px 6px', color: C.ink }}>{l.qbo_item_name ? <b>{l.qbo_item_name}</b> : null}{l.qbo_item_name && l.description ? ' — ' : ''}{l.description}</td>
                      <td style={{ padding: '9px 6px', textAlign: 'right', ...tnum }}>{Number(l.quantity || 0)}</td>
                      <td style={{ padding: '9px 6px', textAlign: 'right', ...tnum }}>{fmt$2(l.unit_price)}</td>
                      <td style={{ padding: '9px 6px', textAlign: 'right', fontWeight: 600, ...tnum }}>{fmt$2(l.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <div style={{ minWidth: 240 }}>
                  <TotalRow label="Subtotal" value={fmt$2(subtotal)} />
                  <div style={{ height: 1, background: C.cardBorder, margin: '6px 0' }} />
                  <TotalRow label="Estimate total" value={fmt$2(total)} strong />
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: C.faint, marginTop: 28, borderTop: `1px solid ${C.hairline}`, paddingTop: 12 }}>This estimate is provided for your review. Amounts are estimated and may be adjusted as scope is finalized.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SECTION: Small presentational helpers ──────────────
function TotalRow({ label, value, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, padding: '2px 0' }}>
      <span style={{ fontSize: strong ? 14 : 12.5, fontWeight: strong ? 800 : 500, color: strong ? C.ink : C.muted }}>{label}</span>
      <span style={{ fontSize: strong ? 16 : 13, fontWeight: strong ? 800 : 600, color: C.ink, ...tnum }}>{value}</span>
    </div>
  );
}
function SectionLabel({ children }) {
  return <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.faint, marginBottom: 8 }}>{children}</div>;
}
function Field({ label, value, mono: isMono }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: C.faint, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, ...(isMono ? mono : null) }}>{value}</div>
    </div>
  );
}

const cellInp = { width: '100%', padding: '6px 8px', fontSize: 13, border: `1px solid ${C.inputBorder}`, borderRadius: 7, background: '#fff', color: C.ink, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };
// Same box metrics as the inputs so a 0/1-line description matches their height; grows on wrap.
const cellTxt = { ...cellInp, display: 'block' };
const btnSm = { fontSize: 12.5, fontWeight: 600, padding: '8px 13px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit' };
const bannerStyle = (s) => ({ background: s.tint, border: `1px solid ${s.border}`, color: s.text, borderRadius: 10, padding: '9px 13px', fontSize: 13, marginBottom: 12 });
