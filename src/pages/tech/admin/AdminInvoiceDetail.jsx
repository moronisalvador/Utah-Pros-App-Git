/**
 * ════════════════════════════════════════════════
 * FILE: AdminInvoiceDetail.jsx  (Admin Mobile — invoice view + send + record payment)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The single-invoice screen inside the field-tech app for admins. It shows
 *   who's billed, the line items (read-only), what's been collected and what's
 *   still owed, lets the admin email the invoice to the customer, and record a
 *   payment that just came in — all from a phone in the field.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/invoice/:invoiceId  (inside AdminMobileRoutes)
 *   Rendered by:  src/pages/tech/admin/AdminMobileRoutes.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/components/admin-mobile (AdminMobilePage, MoneyStatCard),
 *              @/components/admin-mobile/invoice/{recordPayment,invoiceMath,PaymentSheet},
 *              @/components/TabLoading, @/lib/realtime (getAuthHeader),
 *              @/contexts/AuthContext
 *   Data:      reads  → invoices, jobs, claims, contacts, invoice_line_items, payments
 *              writes → payments (record — safe column set ONLY, finding F-1);
 *                       send via POST /api/qbo-invoice {action:'send'} (call-only);
 *                       QBO payment mirror via POST /api/qbo-payment (call-only)
 *
 * NOTES / GOTCHAS:
 *   - MONEY PATH (finding F-1): the payment insert lives in
 *     ../../../components/admin-mobile/invoice/recordPayment.js and is
 *     test-covered. Never write amount_paid/insurance_paid/homeowner_paid/
 *     status/paid_at — a DB trigger recomputes them from payments.
 *   - Send appears ONLY when the invoice is already in QuickBooks
 *     (qbo_invoice_id) — mobile never pushes an invoice to QBO; the human
 *     Save→QBO gate stays on desktop. Line items are strictly read-only here.
 *   - inv.locked hides both money actions (mirrors the desktop guard).
 *   - dbRef keeps the latest client so load() doesn't re-run (and close an
 *     in-progress payment form) when the auth token refreshes on refocus.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import TabLoading from '@/components/TabLoading';
import { AdminMobilePage, MoneyStatCard } from '@/components/admin-mobile';
import { createPaymentRecorder } from '@/components/admin-mobile/invoice/recordPayment';
import { invoiceTotals, invoiceStatusKind, STATUS_LABELS, fmtMoney, fmtDate } from '@/components/admin-mobile/invoice/invoiceMath';
import PaymentSheet from '@/components/admin-mobile/invoice/PaymentSheet';

const toast = (m, t = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));

const PAYER_LABELS = { insurance: 'Insurance', homeowner: 'Homeowner', other: 'Other' };
const METHOD_LABELS = { check: 'Check', eft: 'EFT / ACH', ach: 'EFT / ACH', credit_card: 'Card', cash: 'Cash', other: 'Other' };

export default function AdminInvoiceDetail() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const { db, employee, isFeatureEnabled } = useAuth();

  const dbRef = useRef(db);
  dbRef.current = db;

  // ─── SECTION: State & hooks ──────────────
  const [inv, setInv] = useState(null);
  const [job, setJob] = useState(null);
  const [claim, setClaim] = useState(null);
  const [contact, setContact] = useState(null);
  const [lines, setLines] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  // One recorder per screen — its closure is the double-submit latch (F-1).
  // Reads dbRef at call time so a token refresh never stales the client.
  const recorderRef = useRef(null);
  if (!recorderRef.current) {
    recorderRef.current = createPaymentRecorder({
      db: { insert: (...a) => dbRef.current.insert(...a) },
      getAuthHeader,
    });
  }

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    const d = dbRef.current;
    try {
      const i = (await d.select('invoices', `id=eq.${invoiceId}&limit=1`))?.[0];
      if (!i) { toast('Invoice not found', 'error'); navigate(-1); return; }
      setInv(i);
      const j = i.job_id
        ? (await d.select('jobs', `id=eq.${i.job_id}&select=id,division,job_number,claim_id,primary_contact_id,address,city,state,zip&limit=1`))?.[0]
        : null;
      setJob(j || null);
      setClaim(j?.claim_id
        ? (await d.select('claims', `id=eq.${j.claim_id}&select=claim_number,insurance_carrier&limit=1`))?.[0] || null
        : null);
      const cid = i.contact_id || j?.primary_contact_id;
      setContact(cid
        ? (await d.select('contacts', `id=eq.${cid}&select=name,email&limit=1`))?.[0] || null
        : null);
      setLines(await d.select('invoice_line_items', `invoice_id=eq.${invoiceId}&order=sort_order.asc,created_at.asc`) || []);
      setPayments(await d.select('payments', `invoice_id=eq.${invoiceId}&order=payment_date.desc,created_at.desc`) || []);
    } catch (e) {
      toast('Failed to load invoice: ' + (e.message || e), 'error');
    } finally {
      setLoading(false);
    }
  }, [invoiceId, navigate]);

  useEffect(() => { load(); }, [load]);

  // ─── SECTION: Event handlers ──────────────
  // Send the (already-synced) invoice to the customer via QuickBooks —
  // two-click confirm, mirrors desktop emailInvoice minus the push (view-only here).
  const sendInvoice = async () => {
    if (!confirmSend) { setConfirmSend(true); return; }
    setConfirmSend(false);
    setBusy(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/qbo-invoice', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: invoiceId, action: 'send' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      toast(`Invoice sent to ${data.emailed_to}`);
      await load();
    } catch (e) {
      toast('Couldn’t send invoice: ' + (e.message || e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitPayment = async (form) => {
    setBusy(true);
    try {
      const res = await recorderRef.current({ invoice: inv, job, employee, form });
      if (!res.ok) {
        if (res.reason === 'invalid_amount') toast('Enter a payment amount', 'error');
        else if (res.reason === 'insert_failed') toast('Failed to save payment: ' + res.error, 'error');
        // 'in_flight' → the first tap is still saving; say nothing, do nothing.
        return;
      }
      const amt = fmtMoney(form.amount);
      if (res.qboSynced) toast(`Payment of ${amt} recorded & synced to QuickBooks`);
      else if (res.qboError) toast('Payment recorded — QuickBooks sync failed: ' + res.qboError, 'error');
      else toast(`Payment of ${amt} recorded (save to QuickBooks first to sync)`);
      setPayOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  // ─── SECTION: Render ──────────────
  if (loading) {
    return (
      <AdminMobilePage title="Invoice" back={() => navigate(-1)}>
        <TabLoading />
      </AdminMobilePage>
    );
  }
  if (!inv) return null;
  if (!isFeatureEnabled('feature:billing')) {
    return (
      <AdminMobilePage title="Invoice" back={() => navigate(-1)}>
        <div className="am-stub">Billing is turned off (feature flag <code>feature:billing</code>).</div>
      </AdminMobilePage>
    );
  }

  const { invoiced, collected, balance } = invoiceTotals(inv, lines);
  const kind = invoiceStatusKind(inv, { invoiced, collected, balance });
  const synced = !!inv.qbo_invoice_id;
  const canAct = !inv.locked; // page is admin-only already (AdminMobileRoute)
  const docNumber = inv.qbo_doc_number || inv.invoice_number;
  const subtotal = lines.reduce((s, l) => s + Number(l.line_total || 0), 0);
  const tax = Number(inv.tax || 0);
  const addr = [job?.address, job?.city, job?.state, job?.zip].filter(Boolean).join(', ');

  return (
    <AdminMobilePage title="Invoice" subtitle={docNumber} back={() => navigate(-1)}>
      {/* Header — status + bill-to + claim details */}
      <div className="am-inv-card">
        <div className="am-inv-head">
          <div className="am-inv-number">{docNumber}</div>
          <span className={`am-inv-chip am-inv-chip--${kind}`}>{STATUS_LABELS[kind]}</span>
          {inv.locked && <span className="am-inv-chip am-inv-chip--draft">Locked</span>}
        </div>
        <div className="am-inv-billto">
          <div className="am-inv-billto-name">{contact?.name || '—'}</div>
          {contact?.email && <div className="am-inv-billto-email">{contact.email}</div>}
        </div>
        <div className="am-inv-meta">
          {claim?.insurance_carrier && <MetaRow label="Carrier" value={claim.insurance_carrier} />}
          {claim?.claim_number && <MetaRow label="Claim" value={claim.claim_number} />}
          {job?.job_number && <MetaRow label="Job" value={job.job_number} />}
          <MetaRow label="Due" value={inv.due_date ? fmtDate(inv.due_date) : '—'} />
          <MetaRow label="Sent" value={inv.sent_at ? fmtDate(inv.sent_at) : 'Not sent'} />
          {addr && <MetaRow label="Address" value={addr} />}
        </div>
      </div>

      {/* Money summary — Invoiced / Collected / Balance (desktop calc, F-1) */}
      <div className="am-inv-stats">
        <MoneyStatCard label="Invoiced" value={fmtMoney(invoiced)} muted />
        <MoneyStatCard label="Collected" value={fmtMoney(collected)} muted />
        <MoneyStatCard label="Balance" value={fmtMoney(balance)} />
      </div>

      {/* QBO sync error banner (stored by the workers, read-only here) */}
      {inv.qbo_sync_error && (
        <div className="am-inv-banner am-inv-banner--error">QuickBooks sync error: {inv.qbo_sync_error}</div>
      )}

      {/* Actions — send (synced only, two-click) + record payment */}
      {canAct && (
        <div className="am-inv-actions">
          {synced && (
            <button
              type="button"
              className={`am-inv-btn am-inv-btn--primary${confirmSend ? ' am-inv-btn--confirm' : ''}`}
              onClick={sendInvoice}
              disabled={busy}
              title={contact?.email ? `Send to ${contact.email}` : 'No email on file — add one to the contact first'}
            >
              {busy ? 'Working…' : confirmSend ? 'Confirm send' : inv.qbo_emailed_at ? 'Resend to customer' : 'Send to customer'}
            </button>
          )}
          {!synced && (
            <div className="am-inv-hint">Draft — save it to QuickBooks on desktop before sending.</div>
          )}
          {balance > 0.005 && !payOpen && (
            <button type="button" className="am-inv-btn am-inv-btn--ghost" onClick={() => { setConfirmSend(false); setPayOpen(true); }} disabled={busy}>
              Record payment
            </button>
          )}
        </div>
      )}

      {/* Inline record-payment form (no modal — tech-mobile-ux) */}
      {payOpen && canAct && (
        <PaymentSheet
          balance={balance}
          busy={busy}
          onSubmit={submitPayment}
          onCancel={() => setPayOpen(false)}
        />
      )}

      {/* Line items — strictly read-only on mobile */}
      <div className="am-inv-card am-inv-card--flush">
        <div className="am-inv-card-title">Line items</div>
        {lines.length === 0 && <div className="am-inv-empty">No line items.</div>}
        {lines.map((l) => (
          <div key={l.id} className="am-inv-line">
            <div className="am-inv-line-main">
              <div className="am-inv-line-desc">{l.description || l.qbo_item_name || '—'}</div>
              <div className="am-inv-line-sub">{Number(l.quantity || 0)} × {fmtMoney(l.unit_price)}</div>
            </div>
            <div className="am-inv-line-amt">{fmtMoney(l.line_total)}</div>
          </div>
        ))}
        <div className="am-inv-totals">
          <div className="am-inv-total-row"><span>Subtotal</span><span>{fmtMoney(subtotal)}</span></div>
          {tax > 0 && <div className="am-inv-total-row"><span>Tax</span><span>{fmtMoney(tax)}</span></div>}
          <div className="am-inv-total-row am-inv-total-row--grand"><span>Total</span><span>{fmtMoney(invoiced)}</span></div>
        </div>
      </div>

      {/* Payments — read-only history (editing stays on desktop) */}
      <div className="am-inv-card am-inv-card--flush">
        <div className="am-inv-card-title">Payments</div>
        {payments.length === 0 && <div className="am-inv-empty">No payments recorded yet.</div>}
        {payments.map((p) => (
          <div key={p.id} className="am-inv-line">
            <div className="am-inv-line-main">
              <div className="am-inv-line-desc">
                {PAYER_LABELS[p.payer_type] || p.payer_type || '—'}
                {p.payment_method ? ` · ${METHOD_LABELS[p.payment_method] || p.payment_method}` : ''}
              </div>
              <div className="am-inv-line-sub">
                {fmtDate(p.payment_date)}
                {p.reference_number ? ` · Ref ${p.reference_number}` : ''}
                {p.qbo_payment_id ? ' · QBO ✓' : ''}
              </div>
            </div>
            <div className="am-inv-line-amt">{fmtMoney(p.amount)}</div>
          </div>
        ))}
      </div>
    </AdminMobilePage>
  );
}

function MetaRow({ label, value }) {
  return (
    <div className="am-inv-meta-row">
      <span className="am-inv-meta-label">{label}</span>
      <span className="am-inv-meta-value">{value}</span>
    </div>
  );
}
