/**
 * ════════════════════════════════════════════════
 * FILE: AdminInvoiceDetail.jsx  (Admin Mobile — invoice view + send)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows one invoice as a phone-first financial document. Admins can review
 *   the balance and payment history, open one line in a focused editor, confirm
 *   a QuickBooks email, and push into the dedicated receipt-ledger payment flow.
 *
 * WHERE IT LIVES:
 *   Route: /tech/admin/invoice/:invoiceId on web and native builds.
 *
 * DEPENDS ON:
 *   Internal: AdminMobilePage, SendInvoiceSheet, invoice math/link helpers,
 *             AuthContext, QuickBooks invoice Worker, company-date/back-nav.
 *   Data: reads invoices, jobs, claims, contacts, invoice_line_items, payments.
 *         Writes only through the existing call-only QuickBooks send seam.
 *
 * NOTES / GOTCHAS:
 *   - Line rows push to a separate editor whose explicit Save-to-QuickBooks
 *     button preserves the desktop human gate. Typing never calls QuickBooks.
 *     Send and payment controls still require an existing qbo_invoice_id.
 *   - Record payment navigates to `/pay`, whose POST uses the durable grouped
 *     receipt ledger. This screen never inserts a `payments` row directly.
 *   - Concrete admin-mobile imports are mandatory because the native build
 *     deliberately denies the broad admin-mobile barrel.
 * ════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import TabLoading from '@/components/TabLoading';
import ErrorState from '@/components/ui/ErrorState';
import EmptyState from '@/components/ui/EmptyState';
import IconButton from '@/components/ui/IconButton';
import StatusPill from '@/components/ui/StatusPill';
import AdminMobilePage from '@/components/admin-mobile/AdminMobilePage';
import { IconChevronRight, IconSend } from '@/components/admin-mobile/icons';
import SendInvoiceSheet from '@/components/admin-mobile/invoice/SendInvoiceSheet';
import {
  fmtDate,
  fmtMoney,
  invoiceDaysPastDue,
  invoiceStatusKind,
  invoiceTotals,
  STATUS_LABELS,
} from '@/components/admin-mobile/invoice/invoiceMath';
import { adminInvoiceLineHref, adminInvoicePaymentHref } from '@/components/admin-mobile/href';
import { goBackOr } from '@/lib/backNav';
import { todayInCompanyTimeZone } from '@/lib/companyDate';
import { invoiceEmailState, qboBillEmailMismatch, qboBillEmailMismatchText } from '@/lib/invoiceEmailStatus';
import { impact, notify } from '@/lib/nativeHaptics';
import { callQboInvoiceWorker } from '@/lib/qboInvoiceWorker';
import { getAuthHeader } from '@/lib/realtime';
import { err, ok } from '@/lib/toast';

const PAYER_LABELS = { insurance: 'Insurance', homeowner: 'Homeowner', other: 'Other' };
const METHOD_LABELS = {
  check: 'Check',
  eft: 'EFT / ACH',
  ach: 'EFT / ACH',
  credit_card: 'Card',
  cash: 'Cash',
  wire: 'Wire',
  insurance_direct: 'Insurance direct',
  other: 'Other',
};
const INVOICE_FALLBACK = '/tech/admin/collections?tab=invoices';

export default function AdminInvoiceDetail() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const { db, isFeatureEnabled, user } = useAuth();
  const billingEnabled = isFeatureEnabled('feature:billing');
  const dbRef = useRef(db);
  const loadRequestRef = useRef(0);
  const sendInFlightRef = useRef(false);
  // A completed mutation belongs to the route that started it. Keep this
  // separate from loadRequestRef: a reload must not make a live send stale,
  // while changing :invoiceId must make every prior send UI completion stale.
  const sendRouteRef = useRef({ invoiceId, epoch: 0, token: 0, activeToken: null });
  if (sendRouteRef.current.invoiceId !== invoiceId) {
    sendRouteRef.current = {
      ...sendRouteRef.current,
      invoiceId,
      epoch: sendRouteRef.current.epoch + 1,
      activeToken: null,
    };
    sendInFlightRef.current = false;
  }
  dbRef.current = db;

  const [inv, setInv] = useState(null);
  const [job, setJob] = useState(null);
  const [claim, setClaim] = useState(null);
  const [contact, setContact] = useState(null);
  const [lines, setLines] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sendOpen, setSendOpen] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);

  const goBack = useCallback(
    () => goBackOr(navigate, INVOICE_FALLBACK),
    [navigate],
  );

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    if (!billingEnabled) {
      setLoading(false);
      return;
    }
    const requestedInvoiceId = invoiceId;
    const activeDb = dbRef.current;
    try {
      const invoice = (await activeDb.select('invoices', `id=eq.${requestedInvoiceId}&limit=1`))?.[0];
      if (requestId !== loadRequestRef.current) return;
      if (!invoice) {
        err('Invoice not found');
        setInv(null);
        setLoadError('This invoice could not be found.');
        return;
      }

      const invoiceJob = invoice.job_id
        ? (await activeDb.select(
          'jobs',
          `id=eq.${invoice.job_id}&select=id,division,job_number,claim_id,primary_contact_id,address,city,state,zip&limit=1`,
        ))?.[0] || null
        : null;
      const contactId = invoice.contact_id || invoiceJob?.primary_contact_id;
      const [invoiceClaim, invoiceContact, invoiceLines, invoicePayments] = await Promise.all([
        invoiceJob?.claim_id
          ? activeDb.select('claims', `id=eq.${invoiceJob.claim_id}&select=id,claim_number,insurance_carrier&limit=1`)
          : Promise.resolve([]),
        contactId
          ? activeDb.select('contacts', `id=eq.${contactId}&select=id,name,email&limit=1`)
          : Promise.resolve([]),
        activeDb.select('invoice_line_items', `invoice_id=eq.${requestedInvoiceId}&order=sort_order.asc,created_at.asc`),
        activeDb.select('payments', `invoice_id=eq.${requestedInvoiceId}&order=payment_date.desc,created_at.desc`),
      ]);

      if (requestId !== loadRequestRef.current) return;
      setInv(invoice);
      setJob(invoiceJob);
      setClaim(invoiceClaim?.[0] || null);
      setContact(invoiceContact?.[0] || null);
      setLines(invoiceLines || []);
      setPayments(invoicePayments || []);
      setLoadError('');
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      const message = error?.message || String(error);
      err(`Failed to load invoice: ${message}`);
      setInv(null);
      setLoadError(message);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [billingEnabled, invoiceId]);

  useEffect(() => {
    loadRequestRef.current += 1;
    setInv(null);
    setJob(null);
    setClaim(null);
    setContact(null);
    setLines([]);
    setPayments([]);
    setLoadError('');
    setLoading(true);
    setSendBusy(false);
    load();
    return () => { loadRequestRef.current += 1; };
  }, [load]);

  const retryLoad = useCallback(() => {
    setLoadError('');
    setLoading(true);
    load();
  }, [load]);

  const sendInvoice = async () => {
    if (!billingEnabled || sendInFlightRef.current) return;
    const route = sendRouteRef.current;
    const token = ++route.token;
    const routeEpoch = route.epoch;
    const isCurrentRoute = () => {
      const current = sendRouteRef.current;
      return current.invoiceId === invoiceId && current.epoch === routeEpoch && current.activeToken === token;
    };
    sendInFlightRef.current = true;
    route.activeToken = token;
    impact('light');
    setSendBusy(true);
    try {
      const authHeaders = await getAuthHeader();
      // Do not start a provider request for an invoice the user has left
      // while auth was resolving.
      if (!isCurrentRoute()) return;
      const data = await callQboInvoiceWorker({
        ownerId: user?.id,
        invoiceId,
        authHeaders,
        body: { action: 'send' },
      });
      if (!isCurrentRoute()) return;
      ok(`Invoice sent to ${data.emailed_to || 'the billing email on file'}`);
      notify('success');
      setSendOpen(false);
      await load();
    } catch (error) {
      if (!isCurrentRoute()) return;
      notify('error');
      err(`Couldn’t send invoice: ${error?.message || error}`);
    } finally {
      if (isCurrentRoute()) {
        sendInFlightRef.current = false;
        sendRouteRef.current.activeToken = null;
        setSendBusy(false);
      }
    }
  };

  if (!billingEnabled) {
    return (
      <AdminMobilePage title="Invoice" back={goBack}>
        <div className="am-stub">Billing is turned off (feature flag <code>feature:billing</code>).</div>
      </AdminMobilePage>
    );
  }
  if (loading) {
    return (
      <AdminMobilePage title="Invoice" back={goBack}>
        <TabLoading />
      </AdminMobilePage>
    );
  }
  if (!inv && loadError) {
    return (
      <AdminMobilePage title="Invoice" back={goBack}>
        <ErrorState
          message={`This invoice didn’t load. ${loadError}`}
          onRetry={retryLoad}
        />
      </AdminMobilePage>
    );
  }
  if (!inv) {
    return (
      <AdminMobilePage title="Invoice" back={goBack}>
        <ErrorState message="This invoice is unavailable." onRetry={retryLoad} />
      </AdminMobilePage>
    );
  }
  const totals = invoiceTotals(inv, lines);
  const { invoiced, collected, balance } = totals;
  const overdueDays = balance > 0.005
    ? invoiceDaysPastDue(inv.due_date, todayInCompanyTimeZone())
    : null;
  const kind = overdueDays > 0 ? 'overdue' : invoiceStatusKind(inv, totals);
  const synced = Boolean(inv.qbo_invoice_id);
  const canAct = !inv.locked;
  const canRecord = canAct
    && synced
    && balance > 0.005
    && isFeatureEnabled('feature:qbo_receive_payment');
  const docNumber = inv.qbo_doc_number || inv.invoice_number || 'Invoice';
  const subtotal = lines.reduce((sum, line) => sum + Number(line.line_total || 0), 0);
  const tax = Number(inv.tax || 0);
  const address = [job?.address, job?.city, job?.state, job?.zip].filter(Boolean).join(', ');
  const emailState = invoiceEmailState(inv);
  const billEmailMismatch = qboBillEmailMismatch(inv, contact?.email);
  const sendAction = synced && canAct ? (
    <IconButton
      size="lg"
      onClick={() => setSendOpen(true)}
      disabled={sendBusy}
      label={inv.qbo_emailed_at ? 'Resend invoice to customer' : 'Send invoice to customer'}
    >
      <IconSend width={20} height={20} aria-hidden="true" />
    </IconButton>
  ) : null;

  return (
    <AdminMobilePage
      title="Invoice"
      subtitle={docNumber}
      back={goBack}
      action={sendAction}
      bodyClassName={canRecord ? 'am-page-body--with-dock' : ''}
    >
      {overdueDays > 0 && (
        <div className="am-alert am-alert--danger" role="status">
          <strong>{overdueDays} {overdueDays === 1 ? 'day' : 'days'} overdue</strong>
          <span>Payment was due {fmtDate(inv.due_date)}.</span>
        </div>
      )}

      {inv.qbo_sync_error && (
        <div className="am-alert am-alert--danger" role="status">
          <strong>QuickBooks sync error</strong>
          <span>{inv.qbo_sync_error}</span>
        </div>
      )}

      {billEmailMismatch && (
        <div className="am-alert am-alert--warning" role="status">
          <strong>Billing email differs</strong>
          <span>{qboBillEmailMismatchText(billEmailMismatch)}</span>
        </div>
      )}

      <section className="am-section am-invoice-context" aria-labelledby="invoice-customer-title">
        <div className="am-section-heading">
          <h2 id="invoice-customer-title" className="am-section-label">Customer</h2>
          <div className="am-invoice-statuses">
            <StatusPill status={kind} label={STATUS_LABELS[kind]} />
            {inv.locked && <StatusPill tone="neutral" label="Locked" />}
          </div>
        </div>
        <div className="am-invoice-customer-name">{contact?.name || 'Customer not assigned'}</div>
        <div className="am-invoice-context-meta">
          {contact?.email && <span>{contact.email}</span>}
          {claim?.id && (
            <Link
              to={`/tech/claims/${claim.id}`}
              className="am-invoice-claim-link"
              onClick={() => impact('light')}
            >
              Claim {claim.claim_number || 'details'}
              <IconChevronRight width={16} height={16} aria-hidden="true" />
            </Link>
          )}
        </div>
      </section>

      <section className="am-section am-money" aria-labelledby="invoice-balance-title">
        <h2 id="invoice-balance-title" className="am-section-label">Balance due</h2>
        <div className="am-money-hero">{fmtMoney(balance)}</div>
        <div className="am-money-pair">
          <div>
            <span>Invoiced</span>
            <strong>{fmtMoney(invoiced)}</strong>
          </div>
          <div>
            <span>Collected</span>
            <strong>{fmtMoney(collected)}</strong>
          </div>
        </div>
      </section>

      {!synced && canAct && balance > 0.005 && (
        <div className="am-section-note">Draft — edit a line item and save to QuickBooks before sending or recording payment.</div>
      )}

      <section className="am-section" aria-labelledby="invoice-details-title">
        <div className="am-section-heading">
          <h2 id="invoice-details-title" className="am-section-label">Invoice details</h2>
        </div>
        <div className="am-detail-list">
          {contact?.email && <DetailRow label="Customer email" value={contact.email} />}
          {claim?.insurance_carrier && <DetailRow label="Carrier" value={claim.insurance_carrier} />}
          {claim?.claim_number && <DetailRow label="Claim" value={claim.claim_number} />}
          {job?.job_number && <DetailRow label="Job" value={job.job_number} />}
          <DetailRow label="Due" value={inv.due_date ? fmtDate(inv.due_date) : '—'} />
          <DetailRow
            label="Emailed"
            value={emailState.kind === 'upr-sent' ? fmtDate(emailState.at) : emailState.label}
          />
          <DetailRow label="In QuickBooks" value={synced ? (inv.sent_at ? fmtDate(inv.sent_at) : 'Synced') : 'Not synced'} />
          {address && <DetailRow label="Address" value={address} multiline />}
        </div>
      </section>

      <section className="am-section" aria-labelledby="invoice-lines-title">
        <div className="am-section-heading">
          <h2 id="invoice-lines-title" className="am-section-label">Line items</h2>
          <span>{lines.length}</span>
        </div>
        {lines.length === 0 && (
          <EmptyState
            className="am-invoice-empty"
            title="No line items."
          />
        )}
        {lines.map((line) => {
          const lineName = line.description || line.qbo_item_name || 'Untitled line item';
          const row = (
            <>
              <div className="am-data-row-main">
                <strong>{lineName}</strong>
                <span>{Number(line.quantity || 0)} × {fmtMoney(line.unit_price)}</span>
              </div>
              <strong className="am-data-row-money">{fmtMoney(line.line_total)}</strong>
              {!inv.locked && <IconChevronRight className="am-data-row-chevron" width={18} height={18} aria-hidden="true" />}
            </>
          );
          return inv.locked ? (
            <div key={line.id} className="am-data-row am-data-row--readonly">{row}</div>
          ) : (
            <Link
              key={line.id}
              to={adminInvoiceLineHref(invoiceId, line.id)}
              className="am-data-row am-data-row--link"
              aria-label={`Edit line item ${lineName}, quantity ${Number(line.quantity || 0)}, rate ${fmtMoney(line.unit_price)}, total ${fmtMoney(line.line_total)}`}
              onClick={() => impact('light')}
            >
              {row}
            </Link>
          );
        })}
        <div className="am-total-list">
          <DetailRow label="Subtotal" value={fmtMoney(subtotal)} />
          {tax > 0 && <DetailRow label="Tax" value={fmtMoney(tax)} />}
          <DetailRow label="Total" value={fmtMoney(invoiced)} strong />
        </div>
      </section>

      <section className="am-section" aria-labelledby="invoice-payments-title">
        <div className="am-section-heading">
          <h2 id="invoice-payments-title" className="am-section-label">Payments</h2>
          <span>{payments.length}</span>
        </div>
        {payments.length === 0 && (
          <EmptyState
            className="am-invoice-empty"
            title="No payments recorded yet."
          />
        )}
        {payments.map((payment) => (
          <div key={payment.id} className="am-data-row">
            <div className="am-data-row-main">
              <strong>
                {PAYER_LABELS[payment.payer_type] || payment.payer_type || 'Payment'}
                {payment.payment_method
                  ? ` · ${METHOD_LABELS[payment.payment_method] || payment.payment_method}`
                  : ''}
              </strong>
              <span>
                {fmtDate(payment.payment_date)}
                {payment.reference_number ? ` · Ref ${payment.reference_number}` : ''}
                {payment.qbo_payment_id ? ' · QBO ✓' : ''}
              </span>
            </div>
            <strong className="am-data-row-money">{fmtMoney(payment.amount)}</strong>
          </div>
        ))}
      </section>

      {canRecord && (
        <div className="am-dock">
          <button
            type="button"
            className="am-dock-button"
            onClick={() => {
              impact('light');
              navigate(adminInvoicePaymentHref(invoiceId));
            }}
          >
            <span>Record payment</span>
            <strong>{fmtMoney(balance)}</strong>
          </button>
        </div>
      )}

      <SendInvoiceSheet
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        onSend={sendInvoice}
        busy={sendBusy}
        invoiceNumber={docNumber}
        recipient={contact?.email}
        previouslySent={Boolean(inv.qbo_emailed_at)}
      />
    </AdminMobilePage>
  );
}

function DetailRow({ label, value, multiline = false, strong = false }) {
  return (
    <div className={`am-detail-row${multiline ? ' am-detail-row--multiline' : ''}`}>
      <span>{label}</span>
      <strong className={strong ? 'am-detail-row-strong' : ''}>{value}</strong>
    </div>
  );
}
