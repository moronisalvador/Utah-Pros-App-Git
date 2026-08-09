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
 *   Route:        /tech/admin/invoice/:invoiceId  — served by AdminMobileRoutes on
 *                 web, and by its own IS_NATIVE route in App.jsx on iOS (same path,
 *                 so adminInvoiceHref works unchanged in both builds).
 *   Rendered by:  src/pages/tech/admin/AdminMobileRoutes.jsx (web) · src/App.jsx (native)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/components/admin-mobile/{AdminMobilePage,MoneyStatCard} (concrete
 *              paths — NEVER the barrel; see the import comment below),
 *              @/components/admin-mobile/invoice/{recordPayment,invoiceMath,PaymentSheet},
 *              @/components/TabLoading, @/lib/realtime (getAuthHeader),
 *              @/lib/qboInvoiceWorker (callQboInvoiceWorker), @/contexts/AuthContext
 *   Data:      reads  → invoices, jobs, claims, contacts, invoice_line_items, payments
 *              writes → payments (record — safe column set ONLY, finding F-1);
 *                       send via POST /api/qbo-invoice {action:'send'} (call-only);
 *                       QBO payment mirror via POST /api/qbo-payment (call-only)
 *
 * NOTES / GOTCHAS:
 *   - MONEY PATH (finding F-1): the payment insert lives in
 *     ../../../components/admin-mobile/invoice/recordPayment.js and is
 *     test-covered. Never write amount_paid/insurance_paid/homeowner_paid/
 *     status/paid_at — trg_payment_update_invoice recomputes them from payments.
 *     That module also owns the idempotency key (AGENTS.md §15): one recorder
 *     per screen, so DON'T rebuild it on re-render or the retry memory is lost.
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
import { callQboInvoiceWorker } from '@/lib/qboInvoiceWorker';
import { toast } from '@/lib/toast';
import TabLoading from '@/components/TabLoading';
import ErrorState from '@/components/ui/ErrorState';
// Concrete modules, not the '@/components/admin-mobile' barrel — the native build
// aliases that barrel to a denying shim, so a barrel import arrives `undefined` and
// this screen would render BLANK with the build green and the graph guard silent.
import AdminMobilePage from '@/components/admin-mobile/AdminMobilePage';
import MoneyStatCard from '@/components/admin-mobile/MoneyStatCard';
import { createPaymentRecorder } from '@/components/admin-mobile/invoice/recordPayment';
import { invoiceTotals, invoiceStatusKind, STATUS_LABELS, fmtMoney, fmtDate } from '@/components/admin-mobile/invoice/invoiceMath';
import PaymentSheet from '@/components/admin-mobile/invoice/PaymentSheet';
import { invoiceEmailState, qboBillEmailMismatch, qboBillEmailMismatchText } from '@/lib/invoiceEmailStatus';

const PAYER_LABELS = { insurance: 'Insurance', homeowner: 'Homeowner', other: 'Other' };
const METHOD_LABELS = { check: 'Check', eft: 'EFT / ACH', ach: 'EFT / ACH', credit_card: 'Card', cash: 'Cash', other: 'Other' };

export default function AdminInvoiceDetail() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const { db, employee, isFeatureEnabled, user } = useAuth();

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
  // Without this, a failed load left `inv` null and the render fell through to
  // `if (!inv) return null` — a fully blank screen with no shell, header or back
  // button, on a phone, in the field (loading-error-states.md §1).
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  // One recorder per screen — its closure holds the double-submit latch AND the
  // per-payment idempotency memory (F-1). `select` is what lets a retry ask the
  // server whether the previous attempt actually landed, so it is required.
  // Reads dbRef at call time so a token refresh never stales the client.
  const recorderRef = useRef(null);
  if (!recorderRef.current) {
    recorderRef.current = createPaymentRecorder({
      db: {
        insert: (...a) => dbRef.current.insert(...a),
        select: (...a) => dbRef.current.select(...a),
      },
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
      setLoadError('');
    } catch (e) {
      toast('Failed to load invoice: ' + (e.message || e), 'error');
      setLoadError(e?.message || String(e));
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
      const data = await callQboInvoiceWorker({
        ownerId: user?.id,
        invoiceId,
        authHeaders: auth,
        body: { action: 'send' },
      });
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
        // We could not find out whether the earlier attempt saved. Say exactly
        // that — inventing an answer either loses the payment or doubles it.
        else if (res.reason === 'probe_failed') toast('Couldn’t confirm whether that payment saved. Check the Payments list below before trying again.', 'error');
        // 'in_flight' → the first tap is still saving; say nothing, do nothing.
        return;
      }
      const amt = fmtMoney(form.amount);
      // `deduped` = this exact payment was already recorded by an earlier attempt
      // whose answer never came back, so we adopted that row instead of writing
      // a second one. Worth saying plainly; a silent success reads as a new payment.
      if (res.deduped) toast(`That payment of ${amt} was already recorded — not recorded twice`);
      else if (res.qboSynced) toast(`Payment of ${amt} recorded & synced to QuickBooks`);
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
  // Keeps the page shell (and the back button) when the load failed, instead of
  // returning null into a blank screen. The `!inv` fallback below now only covers
  // the genuine mid-navigation case, where load() already navigated away.
  if (!inv && loadError) {
    return (
      <AdminMobilePage title="Invoice" back={() => navigate(-1)}>
        <ErrorState message={`This invoice didn’t load. ${loadError}`} onRetry={load} />
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
  const emailState = invoiceEmailState(inv);
  const billEmailMismatch = qboBillEmailMismatch(inv, contact?.email);
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
          {/* 'saved' (in QuickBooks, not emailed) borrows the 'sent' chip tone — both are
              live-and-awaiting-payment. Only the word differs, which is the honest part. */}
          <span className={`am-inv-chip am-inv-chip--${kind === 'saved' ? 'sent' : kind}`}>{STATUS_LABELS[kind]}</span>
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
          {/* sent_at is stamped on the FIRST save to QuickBooks (qbo-invoice.js), never on
              send, so "Sent" overstated it. qbo_emailed_at is the real customer-email time.
              QBO-created invoices mirrored into UPR have qbo_invoice_id but no sent_at, so
              sync truth is `synced`. A QBO-side email never reaches qbo_emailed_at either,
              so the label comes from invoiceEmailState, which also reads what QuickBooks
              itself reported (qbo_email_status). */}
          <MetaRow label="Emailed" value={emailState.kind === 'upr-sent' ? fmtDate(emailState.at) : emailState.label} />
          <MetaRow label="In QuickBooks" value={synced ? (inv.sent_at ? fmtDate(inv.sent_at) : 'Synced') : 'Not synced'} />
          {addr && <MetaRow label="Address" value={addr} />}
        </div>
      </div>

      {/* Money summary — Invoiced / Collected / Balance (desktop calc, F-1) */}
      <div className="am-inv-stats">
        <MoneyStatCard label="Balance due" value={fmtMoney(balance)} />
        <MoneyStatCard label="Invoiced" value={fmtMoney(invoiced)} muted />
        <MoneyStatCard label="Collected" value={fmtMoney(collected)} muted />
      </div>

      {/* QBO sync error banner (stored by the workers, read-only here) */}
      {inv.qbo_sync_error && (
        <div className="am-inv-banner am-inv-banner--error">QuickBooks sync error: {inv.qbo_sync_error}</div>
      )}

      {/* QuickBooks emails BillEmail, not the contact email UPR holds. A disagreement means
          the customer may not be getting our invoices — worth seeing from the field too. */}
      {billEmailMismatch && (
        <div role="status" className="am-inv-banner am-inv-banner--warn">{qboBillEmailMismatchText(billEmailMismatch)}</div>
      )}

      {/* Actions — send (synced only, two-click) + record payment */}
      {canAct && (
        <div className="am-inv-actions">
          {synced && (
            <button
              type="button"
              className={`am-inv-btn am-inv-btn--primary${confirmSend ? ' am-inv-btn--confirm' : ''}`}
              onClick={sendInvoice}
              onBlur={() => setConfirmSend(false)}
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
