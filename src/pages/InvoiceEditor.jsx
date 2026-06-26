/**
 * ════════════════════════════════════════════════
 * FILE: InvoiceEditor.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The full invoice builder for one invoice (opened from the My Money / Collections
 *   list). You build the line items (each with a QuickBooks Item + Class, a typed
 *   description, quantity and rate), see the running Subtotal/Total, edit the due
 *   date, record payments, preview/print what the customer gets, and Save/Send the
 *   invoice to QuickBooks. Styled to match the My Money / Collections design.
 *
 * WHERE IT LIVES:
 *   Route:        /invoices/:invoiceId
 *   Rendered by:  src/App.jsx (inside the Layout shell)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/components/collections/{collKit, collTokens, SearchSelect},
 *              @/components/AutoGrowTextarea, @/lib/realtime (getAuthHeader),
 *              @/lib/claimUtils (canEditBilling), @/contexts/AuthContext
 *   Data:      reads  → invoices, invoice_line_items, jobs, claims, contacts, payments
 *              writes → invoice_line_items (add/edit/reorder/remove), payments (record/
 *                       delete), invoices.due_date; QBO push/send via /api/qbo-invoice,
 *                       payments via /api/qbo-payment, pay-link via /api/stripe-pay-link
 *
 * NOTES / GOTCHAS:
 *   - line_total is a GENERATED column (quantity × unit_price) — never written.
 *   - dbRef keeps the latest Supabase client so load() doesn't re-run (and clobber
 *     in-progress edits) every time the auth token refreshes on tab refocus.
 *   - Tax is UPR-side (invoices.tax, optional) and is shown read-only here; it is not
 *     sent to QuickBooks as a separate line. Editable memo/terms are a later phase.
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
import { CollCard, GhostButton, PrimaryButton, StatusBadge, ProgressBar, MapPin } from '@/components/collections/collKit';
import { C, STATUS, fmt$2, fmtDate, mono, tnum, invoiceStatusKind, divLabel } from '@/components/collections/collTokens';

const toast = (m, t = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
// Compact saved stamp: "06-22-26 2:30 PM"
const fmtStamp = (iso) => {
  if (!iso) return '';
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getFullYear() % 100)} ${h}:${p(d.getMinutes())} ${ap}`;
};

const PAYER_TYPES = [['insurance', 'Insurance'], ['homeowner', 'Homeowner'], ['other', 'Other']];
const METHODS = [['check', 'Check'], ['eft', 'EFT / ACH'], ['credit_card', 'Credit card'], ['cash', 'Cash'], ['other', 'Other']];

export default function InvoiceEditor() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const { db, isFeatureEnabled, employee } = useAuth();
  const canEdit = canEditBilling(employee?.role);

  const dbRef = useRef(db);
  dbRef.current = db;

  // ─── SECTION: State & hooks ──────────────
  const [inv, setInv] = useState(null);
  const [job, setJob] = useState(null);
  const [claim, setClaim] = useState(null);
  const [contact, setContact] = useState(null);
  const [lines, setLines] = useState([]);
  const [payments, setPayments] = useState([]);
  const [qboItems, setQboItems] = useState([]);
  const [qboClasses, setQboClasses] = useState([]);
  const [catalogMsg, setCatalogMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState(false);
  const [payForm, setPayForm] = useState(null); // null = closed, else the draft object (.id set when editing)
  const [delPayArmed, setDelPayArmed] = useState(false);
  const [hoverPay, setHoverPay] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const dragIdx = useRef(null);
  const paymentsRef = useRef(null);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    const d = dbRef.current;
    setLoading(true);
    try {
      const i = (await d.select('invoices', `id=eq.${invoiceId}&limit=1`))?.[0];
      if (!i) { toast('Invoice not found', 'error'); navigate('/collections', { replace: true }); return; }
      setInv(i);
      const j = i.job_id ? (await d.select('jobs', `id=eq.${i.job_id}&select=id,division,job_number,claim_id,primary_contact_id,address,city,state,zip&limit=1`))?.[0] : null;
      setJob(j || null);
      setClaim(j?.claim_id ? (await d.select('claims', `id=eq.${j.claim_id}&select=claim_number,insurance_carrier,date_of_loss,loss_address,loss_city,loss_state,loss_zip&limit=1`))?.[0] || null : null);
      const cid = i.contact_id || j?.primary_contact_id;
      setContact(cid ? (await d.select('contacts', `id=eq.${cid}&select=name,email&limit=1`))?.[0] || null : null);
      let ls = await d.select('invoice_line_items', `invoice_id=eq.${invoiceId}&order=sort_order.asc,created_at.asc`) || [];
      // Start a fresh editable draft with one blank line so the builder opens ready to type.
      if (ls.length === 0 && canEdit && !i.qbo_invoice_id) {
        try {
          const created = await d.insert('invoice_line_items', { invoice_id: invoiceId, description: '', quantity: 1, unit_price: 0, sort_order: 0 });
          const row = Array.isArray(created) ? created[0] : created;
          if (row) ls = [row];
        } catch { /* non-fatal — user can still + Add line */ }
      }
      setLines(ls);
      setPayments(await d.select('payments', `invoice_id=eq.${invoiceId}&order=payment_date.desc,created_at.desc`) || []);
    } catch (e) {
      toast('Failed to load invoice: ' + (e.message || e), 'error');
    } finally {
      setLoading(false);
    }
  }, [invoiceId, navigate, canEdit]);

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
      setQboItems((itemsR.Item || []).map((i) => ({ id: String(i.Id), name: i.Name })));
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
    try { await db.insert('invoice_line_items', { invoice_id: invoiceId, description: '', quantity: 1, unit_price: 0, sort_order: lines.length }); await load(); }
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
  // Persist a line on blur/select WITHOUT reloading — local state already reflects it.
  const saveLine = async (line) => {
    try {
      await db.update('invoice_line_items', `id=eq.${line.id}`, {
        description: line.description || '',
        qbo_item_id: line.qbo_item_id || null, qbo_item_name: line.qbo_item_name || null,
        qbo_class_id: line.qbo_class_id || null, qbo_class_name: line.qbo_class_name || null,
        quantity: Number(line.quantity || 0), unit_price: Number(line.unit_price || 0),
      });
    } catch (e) { toast('Failed to save line: ' + (e.message || e), 'error'); }
  };
  const removeLine = async (line) => {
    setBusy(true);
    try { await db.delete('invoice_line_items', `id=eq.${line.id}`); await load(); }
    catch { toast('Failed to remove line', 'error'); }
    finally { setBusy(false); }
  };
  // Drag-reorder: move the dragged row, then persist each line's new sort_order.
  const onDropRow = async (toIdx) => {
    const from = dragIdx.current; dragIdx.current = null;
    if (from == null || from === toIdx) return;
    const next = [...lines];
    const [moved] = next.splice(from, 1);
    next.splice(toIdx, 0, moved);
    setLines(next);
    try { for (let i = 0; i < next.length; i++) if (next[i].sort_order !== i) await db.update('invoice_line_items', `id=eq.${next[i].id}`, { sort_order: i }); }
    catch { toast('Failed to reorder lines', 'error'); await load(); }
  };

  // ─── SECTION: QBO actions ──────────────
  const callWorker = async (body) => {
    const auth = await getAuthHeader();
    const res = await fetch('/api/qbo-invoice', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_id: invoiceId, ...body }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  };
  const flushAndPush = async () => {
    for (const l of lines) {
      await db.update('invoice_line_items', `id=eq.${l.id}`, {
        description: l.description || '',
        qbo_item_id: l.qbo_item_id || null, qbo_item_name: l.qbo_item_name || null,
        qbo_class_id: l.qbo_class_id || null, qbo_class_name: l.qbo_class_name || null,
        quantity: Number(l.quantity || 0), unit_price: Number(l.unit_price || 0),
      });
    }
    await callWorker({});
  };
  const saveInvoice = async () => {
    setBusy(true);
    try { await flushAndPush(); toast('Invoice saved'); await load(); }
    catch (e) { toast('Couldn’t save invoice: ' + e.message, 'error'); await load(); }
    finally { setBusy(false); }
  };
  const emailInvoice = async () => {
    if (!confirmEmail) { setConfirmEmail(true); return; }
    setConfirmEmail(false); setBusy(true);
    try {
      await flushAndPush();
      const d = await callWorker({ action: 'send' });
      toast(`Invoice sent to ${d.emailed_to}`); await load();
    }
    catch (e) { toast('Couldn’t send invoice: ' + e.message, 'error'); await load(); }
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
      for (const l of lines) await db.delete('invoice_line_items', `id=eq.${l.id}`);
      await db.delete('invoices', `id=eq.${invoiceId}`);
      toast('Draft invoice deleted');
      navigate(-1);
    } catch (e) { toast('Failed to delete: ' + (e.message || e), 'error'); setBusy(false); }
  };

  // ─── SECTION: Due date + payments ──────────────
  const updateDueDate = async (val) => {
    setInv((prev) => ({ ...prev, due_date: val || null }));
    try { await db.update('invoices', `id=eq.${invoiceId}`, { due_date: val || null }); }
    catch (e) { toast('Failed to update due date: ' + (e.message || e), 'error'); }
  };
  const recordPayment = async () => {
    const amt = Number(payForm?.amount);
    if (!(amt > 0)) { toast('Enter a payment amount', 'error'); return; }
    const editing = !!payForm.id;
    setBusy(true);
    try {
      if (editing) {
        await db.update('payments', `id=eq.${payForm.id}`, {
          amount: amt, payment_date: payForm.date || today(),
          payer_type: payForm.payer_type || 'insurance', payment_method: payForm.method || null,
          reference_number: payForm.reference || null,
        });
        // QBO has no payment-update endpoint → delete the old mirror + recreate so it reflects the edit.
        if (inv.qbo_invoice_id) {
          try {
            const auth = await getAuthHeader();
            if (payForm.qbo_payment_id) {
              await fetch('/api/qbo-payment', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ payment_id: payForm.id, action: 'delete' }) });
            }
            const res = await fetch('/api/qbo-payment', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ payment_id: payForm.id }) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || res.statusText);
            toast('Payment updated & re-synced to QuickBooks');
          } catch (e) { toast('Payment updated — QuickBooks re-sync failed: ' + e.message, 'error'); }
        } else {
          toast('Payment updated');
        }
      } else {
        const inserted = await db.insert('payments', {
          invoice_id: invoiceId, job_id: job?.id || null, contact_id: inv.contact_id || null,
          amount: amt, payment_date: payForm.date || today(),
          payer_type: payForm.payer_type || 'insurance', payment_method: payForm.method || null,
          reference_number: payForm.reference || null, recorded_by: employee?.id || null,
        });
        const row = Array.isArray(inserted) ? inserted[0] : inserted;
        if (inv.qbo_invoice_id && row?.id) {
          try {
            const auth = await getAuthHeader();
            const res = await fetch('/api/qbo-payment', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ payment_id: row.id }) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || res.statusText);
            toast(`Payment of ${fmt$2(amt)} recorded & synced to QuickBooks`);
          } catch (e) { toast('Payment recorded — QuickBooks sync failed: ' + e.message, 'error'); }
        } else {
          toast(`Payment of ${fmt$2(amt)} recorded${inv.qbo_invoice_id ? '' : ' (save to QuickBooks first to sync)'}`);
        }
      }
      setPayForm(null); setDelPayArmed(false); await load();
    } catch (e) { toast('Failed to save payment: ' + (e.message || e), 'error'); }
    finally { setBusy(false); }
  };
  // Click a payment row → open the form pre-filled to edit it (QBO-style click-to-edit).
  const editPayment = (p) => {
    setDelPayArmed(false);
    setPayForm({
      id: p.id, qbo_payment_id: p.qbo_payment_id || null,
      amount: String(p.amount ?? ''), date: p.payment_date ? String(p.payment_date).slice(0, 10) : today(),
      payer_type: p.payer_type || 'insurance', method: p.payment_method || 'check', reference: p.reference_number || '',
    });
    setTimeout(() => paymentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  const deleteEditingPayment = async () => {
    if (!payForm?.id) return;
    if (!delPayArmed) { setDelPayArmed(true); return; }
    setDelPayArmed(false); setBusy(true);
    try {
      if (payForm.qbo_payment_id) {
        try { const auth = await getAuthHeader(); await fetch('/api/qbo-payment', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ payment_id: payForm.id, action: 'delete' }) }); }
        catch (e) { toast('QuickBooks removal failed: ' + e.message, 'error'); }
      }
      await db.delete('payments', `id=eq.${payForm.id}`); toast('Payment deleted'); setPayForm(null); await load();
    } catch { toast('Failed to delete payment', 'error'); }
    finally { setBusy(false); }
  };
  // Open a fresh record-payment form (triggered from the top toolbar) and bring it into view.
  const receivePayment = () => {
    const inviced = Number(inv?.adjusted_total ?? inv?.total ?? 0);
    const bal = Math.max(0, round2(inviced - Number(inv?.amount_paid || 0)));
    setDelPayArmed(false);
    setPayForm({ amount: bal > 0 ? bal.toFixed(2) : '', date: today(), payer_type: 'insurance', method: 'check', reference: '' });
    setTimeout(() => paymentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  // ─── SECTION: Stripe pay-by-link (dormant until keys exist) ──────────────
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

  // ─── SECTION: Derived values ──────────────
  if (loading) return <div className="loading-page"><div className="spinner" /></div>;
  if (!inv) return null;
  if (!isFeatureEnabled('feature:billing')) {
    return <div style={{ maxWidth: 900, margin: '40px auto', padding: 24, color: C.muted }}>Billing is turned off (feature flag <code>feature:billing</code>).</div>;
  }

  const synced = !!inv.qbo_invoice_id;
  const division = divLabel(job?.division) || 'Job';
  const addr = ([job?.address, job?.city, job?.state, job?.zip].filter(Boolean).join(', '))
    || ([claim?.loss_address, claim?.loss_city, claim?.loss_state, claim?.loss_zip].filter(Boolean).join(', '));
  const subtotal = lines.reduce((s, l) => s + Number(l.line_total || 0), 0);
  const tax = Number(inv.tax || 0);
  const liveTotal = round2(subtotal + tax);
  const invoiced = Number(inv.adjusted_total ?? inv.total ?? liveTotal);
  const collected = Number(inv.amount_paid || 0);
  const balance = round2(invoiced - collected);
  const docNumber = inv.qbo_doc_number || inv.invoice_number;
  const stKind = invoiceStatusKind({ total: invoiced, amount_paid: collected, balance, due_date: inv.due_date, sent_at: inv.sent_at, qbo_invoice_id: inv.qbo_invoice_id, status: inv.status });
  const GRID = canEdit ? '22px 1.15fr 2.3fr 1fr 56px 92px 100px 26px' : '1.2fr 2.6fr 1fr 56px 92px 110px';

  // ─── SECTION: Render ──────────────
  return (
    <div className="coll-page">
      <style>{`@media print { body * { visibility: hidden !important; } .inv-print-doc, .inv-print-doc * { visibility: visible !important; } .inv-print-doc { position: absolute !important; left: 0; top: 0; width: 100%; box-shadow: none !important; border: none !important; } .inv-no-print { display: none !important; } }`}</style>

      {/* Top bar — Back + QBO-style action toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <GhostButton onClick={() => navigate(-1)}>← Back</GhostButton>
        <div className="inv-no-print" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {synced && inv.qbo_synced_at && <span style={{ fontSize: 11.5, color: C.faint, marginRight: 2 }}>✓ {fmtStamp(inv.qbo_synced_at)}</span>}
          {canEdit && (
            <PrimaryButton onClick={saveInvoice} style={{ opacity: (busy || subtotal <= 0) ? 0.6 : 1, pointerEvents: (busy || subtotal <= 0) ? 'none' : 'auto' }}>
              {busy ? 'Saving…' : synced ? 'Save' : 'Save invoice'}
            </PrimaryButton>
          )}
          {canEdit && synced && (
            <GhostButton onClick={emailInvoice} title={contact?.email ? `Send to ${contact.email}` : 'No email on file — add one to the contact first'}
              style={confirmEmail ? { background: STATUS.info.tint, color: STATUS.info.text, borderColor: STATUS.info.border } : undefined}>
              {confirmEmail ? 'Confirm send' : inv.qbo_emailed_at ? '✉ Resend' : '✉ Send to customer'}
            </GhostButton>
          )}
          {canEdit && balance > 0.005 && (
            <GhostButton onClick={receivePayment} leftIcon={<span aria-hidden="true">💵</span>}>Receive payment</GhostButton>
          )}
          {canEdit && liveTotal > 0 && (
            inv.stripe_payment_link_url
              ? <GhostButton onClick={copyPayLink} title={inv.stripe_payment_link_url}>💳 Copy pay link</GhostButton>
              : <GhostButton onClick={createPayLink}>💳 Create pay link</GhostButton>
          )}
          <GhostButton onClick={() => setShowPreview(true)}>⎙ Preview</GhostButton>
          {canEdit && (
            <ActionMenu items={[
              { key: 'revert', label: 'Revert to draft', onSelect: doRevert, confirm: true, danger: true, show: synced },
              { key: 'delete', label: 'Delete draft', onSelect: doDelete, confirm: true, danger: true, show: !synced && collected <= 0 },
            ]} />
          )}
        </div>
      </div>

      {/* Header card — number + bill-to + details (no lateral panel) */}
      <CollCard style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.1em', color: C.faint, textTransform: 'uppercase' }}>Invoice</span>
          <StatusBadge kind={stKind} />
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: C.ink, letterSpacing: '-.02em', marginTop: 2, ...tnum }}>{docNumber}</div>
        {inv.qbo_doc_number && inv.qbo_doc_number !== inv.invoice_number && <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>UPR ref {inv.invoice_number}</div>}
        <div style={{ marginTop: 12 }}>
          <SectionLabel>Bill to</SectionLabel>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{contact?.name || '—'}</div>
          {contact?.email && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 1 }}>{contact.email}</div>}
        </div>
        <div style={{ height: 1, background: C.hairline, margin: '14px 0' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px 20px' }}>
          <Field label="Carrier" value={claim?.insurance_carrier || '—'} />
          <Field label="Claim" value={claim?.claim_number || '—'} mono />
          <Field label="Job" value={job?.job_number ? `${job.job_number} · ${division}` : division} />
          {claim?.date_of_loss && <Field label="Date of loss" value={fmtDate(claim.date_of_loss)} />}
          <Field label="Sent" value={inv.sent_at ? fmtDate(inv.sent_at) : 'Not sent'} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: C.faint, marginBottom: 3 }}>Due date</div>
            {canEdit
              ? <input type="date" value={inv.due_date ? String(inv.due_date).slice(0, 10) : ''} onChange={(e) => updateDueDate(e.target.value)} style={{ fontSize: 12.5, padding: '5px 8px', border: `1px solid ${C.inputBorder}`, borderRadius: 7, background: '#fff', color: C.ink, fontFamily: 'inherit' }} />
              : <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{inv.due_date ? fmtDate(inv.due_date) : '—'}</div>}
          </div>
        </div>
        {addr && <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.muted, marginTop: 12 }}><MapPin /> {addr}</div>}
        <div style={{ fontSize: 10.5, color: C.faint2, marginTop: addr ? 6 : 12 }}>The customer memo is generated automatically when the invoice is sent to QuickBooks.</div>
      </CollCard>

      {/* Banners */}
      {inv.qbo_sync_error && <div style={bannerStyle(STATUS.danger)}>Couldn’t save invoice: {inv.qbo_sync_error}</div>}
      {catalogMsg && canEdit && <div style={bannerStyle(STATUS.warning)}>{catalogMsg}</div>}
      {inv.stripe_payment_link_url && <div style={bannerStyle(STATUS.info)}>💳 Card pay link active — <a href={inv.stripe_payment_link_url} target="_blank" rel="noopener noreferrer" style={{ color: STATUS.info.text, wordBreak: 'break-all' }}>{inv.stripe_payment_link_url}</a></div>}

      {/* Single column: line items → actions → payments (no lateral panel) */}
      <div>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <CollCard pad={0}>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: canEdit ? 660 : 560 }}>
                <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '11px 16px', background: C.headFill, borderBottom: `1px solid ${C.cardBorder}`, fontSize: 10.5, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  {canEdit && <span />}
                  <span>Item</span><span>Description</span><span>Class</span><span>Qty</span><span>Rate</span><span style={{ textAlign: 'right' }}>Amount</span>{canEdit && <span />}
                </div>

                {lines.length === 0 && (
                  <div style={{ padding: '28px 16px', textAlign: 'center', color: C.faint, fontSize: 13 }}>No line items yet.{canEdit ? ' Add a line to build the invoice.' : ''}</div>
                )}

                {lines.map((l, idx) => (
                  <div
                    key={l.id}
                    draggable={canEdit}
                    onDragStart={() => { dragIdx.current = idx; }}
                    onDragOver={(e) => { if (canEdit) e.preventDefault(); }}
                    onDrop={() => canEdit && onDropRow(idx)}
                    style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '8px 16px', borderBottom: `1px solid ${C.hairline}`, alignItems: 'start' }}
                  >
                    {canEdit ? (
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
                  {canEdit ? <GhostButton onClick={addLine} style={{ opacity: busy ? 0.6 : 1 }}>+ Add line</GhostButton> : <span />}
                  <div style={{ minWidth: 200 }}>
                    <TotalRow label="Subtotal" value={fmt$2(subtotal)} />
                    {tax > 0 && <TotalRow label="Tax" value={fmt$2(tax)} />}
                    <div style={{ height: 1, background: C.cardBorder, margin: '6px 0' }} />
                    <TotalRow label="Total" value={fmt$2(liveTotal)} strong />
                  </div>
                </div>
              </div>
            </div>
          </CollCard>

          {canEdit && <div className="inv-no-print" style={{ fontSize: 11.5, color: C.faint }}>Line edits save as you type. Use <b>Save</b> (top) to record the invoice in QuickBooks{synced ? <>, then <b>Send to customer</b> to email it</> : ''}.</div>}

          {/* Payments — full width, below the builder (form opens from the top "Receive payment") */}
          <div ref={paymentsRef}>
          <CollCard style={{ marginTop: 2 }}>
            <SectionLabel>Payments</SectionLabel>
            <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
              <Stat label="Invoiced" value={fmt$2(invoiced)} />
              <Stat label="Collected" value={fmt$2(collected)} color={collected > 0 ? STATUS.success.text : C.ink} />
              <Stat label="Balance" value={fmt$2(balance)} color={balance > 0.005 ? STATUS.danger.text : STATUS.success.text} />
            </div>
            <div style={{ marginTop: 10 }}><ProgressBar pct={invoiced > 0 ? (collected / invoiced) * 100 : 0} /></div>

            {payments.length > 0 && (
              <div style={{ marginTop: 12, border: `1px solid ${C.hairline}`, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: PAY_GRID, gap: 8, padding: '8px 12px', background: C.headFill, fontSize: 10, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  <span>Date</span><span>Type</span><span style={{ textAlign: 'right' }}>Amount</span><span>Note</span>
                </div>
                {payments.map((p, i) => {
                  const net = Number(p.amount || 0) - Number(p.refunded_amount || 0);
                  const typeTxt = [p.payer_type, p.payment_method ? String(p.payment_method).replace('_', ' ') : null].filter(Boolean).join(' · ') || '—';
                  const noteTxt = [p.reference_number, p.qbo_payment_id ? '✓ QB' : null].filter(Boolean).join(' · ') || '—';
                  const cells = (
                    <>
                      <span style={{ color: C.body, ...tnum }}>{fmtDate(p.payment_date)}</span>
                      <span style={{ color: C.muted, textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{typeTxt}</span>
                      <span style={{ textAlign: 'right', fontWeight: 700, color: STATUS.success.text, ...tnum }}>{fmt$2(net)}</span>
                      <span style={{ color: C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{noteTxt}</span>
                    </>
                  );
                  const base = { display: 'grid', gridTemplateColumns: PAY_GRID, gap: 8, alignItems: 'center', padding: '9px 12px', fontSize: 12.5, borderTop: i === 0 ? 'none' : `1px solid ${C.hairline}` };
                  return canEdit ? (
                    <button key={p.id} type="button" onClick={() => editPayment(p)} title="Click to edit"
                      onMouseEnter={() => setHoverPay(p.id)} onMouseLeave={() => setHoverPay(null)}
                      style={{ ...base, width: '100%', textAlign: 'left', border: 'none', borderTop: i === 0 ? 'none' : `1px solid ${C.hairline}`, background: hoverPay === p.id ? C.rowHover : 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
                      {cells}
                    </button>
                  ) : (
                    <div key={p.id} style={base}>{cells}</div>
                  );
                })}
              </div>
            )}

            {canEdit && payForm && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, padding: 12, background: C.headFill, border: `1px solid ${C.cardBorder}`, borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{payForm.id ? 'Edit payment' : 'Record payment'}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <label style={fieldWrap}><span style={fieldLbl}>Amount</span><input type="number" inputMode="decimal" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} style={fieldInp} /></label>
                  <label style={fieldWrap}><span style={fieldLbl}>Date</span><input type="date" value={payForm.date} onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))} style={fieldInp} /></label>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <label style={fieldWrap}><span style={fieldLbl}>From</span><select value={payForm.payer_type} onChange={(e) => setPayForm((f) => ({ ...f, payer_type: e.target.value }))} style={fieldInp}>{PAYER_TYPES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
                  <label style={fieldWrap}><span style={fieldLbl}>Method</span><select value={payForm.method} onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))} style={fieldInp}>{METHODS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
                </div>
                <label style={fieldWrap}><span style={fieldLbl}>Reference (optional)</span><input value={payForm.reference} onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))} placeholder="Check # / ACH trace" style={fieldInp} /></label>
                <div style={{ display: 'flex', gap: 8, marginTop: 2, alignItems: 'center' }}>
                  <PrimaryButton onClick={recordPayment} style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }}>{payForm.id ? 'Update payment' : 'Save payment'}</PrimaryButton>
                  <GhostButton onClick={() => { setPayForm(null); setDelPayArmed(false); }}>Cancel</GhostButton>
                  {payForm.id && (
                    <button type="button" onClick={deleteEditingPayment} onBlur={() => setDelPayArmed(false)} disabled={busy}
                      style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 600, padding: '8px 13px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', background: delPayArmed ? STATUS.danger.tint : '#fff', color: delPayArmed ? STATUS.danger.text : C.muted, border: `1px solid ${delPayArmed ? STATUS.danger.border : C.cardBorder}` }}>
                      {delPayArmed ? 'Confirm delete' : 'Delete'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </CollCard>
          </div>
        </div>
      </div>

      {/* Customer preview overlay */}
      {showPreview && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(16,24,40,.45)', overflowY: 'auto', padding: '24px 16px' }} onClick={() => setShowPreview(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, margin: '0 auto' }}>
            <div className="inv-no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 10 }}>
              <PrimaryButton onClick={() => window.print()}>⎙ Print / Save PDF</PrimaryButton>
              <GhostButton onClick={() => setShowPreview(false)} style={{ background: '#fff' }}>Close</GhostButton>
            </div>
            <div className="inv-print-doc" style={{ background: '#fff', borderRadius: 12, padding: '36px 40px', boxShadow: '0 12px 40px rgba(16,24,40,.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.ink }}>Utah Pros Restoration</div>
                  <div style={{ fontSize: 12, color: C.muted }}>Accounts Receivable</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: '.04em' }}>INVOICE</div>
                  <div style={{ fontSize: 12.5, color: C.body, marginTop: 2 }}>#{docNumber}</div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginTop: 24 }}>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.faint }}>Bill to</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, marginTop: 3 }}>{contact?.name || '—'}</div>
                  {contact?.email && <div style={{ fontSize: 12.5, color: C.muted }}>{contact.email}</div>}
                  {claim?.claim_number && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Claim {claim.claim_number}{claim.insurance_carrier ? ` · ${claim.insurance_carrier}` : ''}</div>}
                </div>
                <div style={{ textAlign: 'right', fontSize: 12.5, color: C.body }}>
                  <div>Sent: {inv.sent_at ? fmtDate(inv.sent_at) : '—'}</div>
                  <div>Due: {inv.due_date ? fmtDate(inv.due_date) : '—'}</div>
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
                  {tax > 0 && <TotalRow label="Tax" value={fmt$2(tax)} />}
                  <div style={{ height: 1, background: C.cardBorder, margin: '6px 0' }} />
                  <TotalRow label="Total due" value={fmt$2(liveTotal)} strong />
                  {collected > 0 && <><TotalRow label="Collected" value={fmt$2(collected)} /><TotalRow label="Balance" value={fmt$2(balance)} strong /></>}
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: C.faint, marginTop: 28, borderTop: `1px solid ${C.hairline}`, paddingTop: 12 }}>Thank you for your business. Please remit payment by the due date above.</div>
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
function Stat({ label, value, color = C.ink }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: C.faint }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, ...tnum, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
    </div>
  );
}

const PAY_GRID = '92px minmax(0,1fr) 96px minmax(0,1.1fr)';
const cellInp = { width: '100%', padding: '6px 8px', fontSize: 13, border: `1px solid ${C.inputBorder}`, borderRadius: 7, background: '#fff', color: C.ink, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };
// Same box metrics as the inputs so a 0/1-line description matches their height; grows on wrap.
const cellTxt = { ...cellInp, display: 'block' };
const bannerStyle = (s) => ({ background: s.tint, border: `1px solid ${s.border}`, color: s.text, borderRadius: 10, padding: '9px 13px', fontSize: 13, marginBottom: 12 });
const fieldWrap = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 };
const fieldLbl = { fontSize: 10.5, fontWeight: 600, color: C.muted };
const fieldInp = { width: '100%', padding: '6px 8px', fontSize: 12.5, border: `1px solid ${C.inputBorder}`, borderRadius: 7, background: '#fff', color: C.ink, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };
