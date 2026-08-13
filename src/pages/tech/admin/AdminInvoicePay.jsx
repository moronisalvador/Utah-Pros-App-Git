/**
 * ════════════════════════════════════════════════
 * FILE: AdminInvoicePay.jsx  (Admin Mobile — receive payment for one invoice)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Loads one QBO-linked invoice and its customer’s protected receipt options,
 *   then presents the single-invoice payment flow. The QBO Worker remains the
 *   only writer and validates authorization, balance and idempotency server-side.
 *
 * DEPENDS ON:
 *   Packages: react, react-router-dom
 *   Internal: AuthContext, AdminMobilePage, ErrorState, TabLoading, getAuthHeader,
 *             invoicePayment, InvoicePaymentFlow, toast
 *   Data: reads invoices/contacts and GET /api/qbo-receive-payment; writes only
 *         through POST /api/qbo-receive-payment.
 * ════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import { goBackOr } from '@/lib/backNav';
import { notify } from '@/lib/nativeHaptics';
import { err, ok } from '@/lib/toast';
import TabLoading from '@/components/TabLoading';
import ErrorState from '@/components/ui/ErrorState';
import AdminMobilePage from '@/components/admin-mobile/AdminMobilePage';
import { adminInvoiceHref } from '@/components/admin-mobile/href';
import {
  clearPendingInvoicePaymentIdentity,
  findInvoiceOption,
} from '@/components/admin-mobile/invoice/invoicePayment';
import InvoicePaymentFlow from '@/components/admin-mobile/invoice/InvoicePaymentFlow';

export default function AdminInvoicePay() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const { db, employee, isFeatureEnabled } = useAuth();
  const billingEnabled = isFeatureEnabled('feature:billing');
  const receivePaymentsEnabled = isFeatureEnabled('feature:qbo_receive_payment');
  const dbRef = useRef(db);
  const loadRequestRef = useRef(0);
  const paymentRouteRef = useRef({ invoiceId, epoch: 0, token: 0, activeToken: null, alive: false });
  if (paymentRouteRef.current.invoiceId !== invoiceId) {
    paymentRouteRef.current = {
      ...paymentRouteRef.current,
      invoiceId,
      epoch: paymentRouteRef.current.epoch + 1,
      activeToken: null,
    };
  }
  dbRef.current = db;
  const [invoice, setInvoice] = useState(null);
  const [contact, setContact] = useState(null);
  const [paymentData, setPaymentData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    const requestedInvoiceId = invoiceId;
    const isCurrentLoad = () => {
      const route = paymentRouteRef.current;
      return requestId === loadRequestRef.current
        && route.invoiceId === requestedInvoiceId
        && route.alive;
    };
    if (!isCurrentLoad()) return;
    if (!billingEnabled || !receivePaymentsEnabled) {
      if (isCurrentLoad()) setLoading(false);
      return;
    }
    try {
      const row = (await dbRef.current.select('invoices', `id=eq.${requestedInvoiceId}&select=id,contact_id,qbo_invoice_id,qbo_doc_number,invoice_number,locked&limit=1`))?.[0];
      if (!isCurrentLoad()) return;
      if (!row) throw new Error('This invoice could not be found.');
      // Keep the payment route behind the same immutable-invoice boundary as
      // the detail and line-edit screens. This must happen before the QBO
      // options request so a locked invoice never starts a payment flow.
      if (row.locked) {
        setInvoice(row);
        setContact(null);
        setPaymentData(null);
        setLoadError('This invoice is locked and is read-only. Payments cannot be recorded.');
        return;
      }
      if (!row.qbo_invoice_id) throw new Error('Save this invoice to QuickBooks before receiving a payment.');
      if (!row.contact_id) throw new Error('This invoice has no customer to receive a payment from.');
      const customer = (await dbRef.current.select('contacts', `id=eq.${row.contact_id}&select=id,name,qbo_customer_id&limit=1`))?.[0];
      if (!isCurrentLoad()) return;
      if (!customer?.qbo_customer_id) throw new Error('This customer is not linked to QuickBooks.');
      const authHeaders = await getAuthHeader();
      if (!isCurrentLoad()) return;
      const response = await fetch(`/api/qbo-receive-payment?contact_id=${encodeURIComponent(customer.id)}`, { headers: authHeaders });
      const data = await response.json().catch(() => ({}));
      if (!isCurrentLoad()) return;
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not load payment options.');
      const exactInvoice = findInvoiceOption(data, requestedInvoiceId);
      if (!exactInvoice) throw new Error('This invoice no longer has an open balance in QuickBooks.');
      setInvoice(exactInvoice); setContact(data.contact || customer); setPaymentData(data); setLoadError('');
    } catch (error) {
      if (!isCurrentLoad()) return;
      setInvoice(null);
      setContact(null);
      setPaymentData(null);
      setLoadError(error?.message || 'Could not load this payment.');
    } finally {
      if (isCurrentLoad()) setLoading(false);
    }
  }, [billingEnabled, invoiceId, receivePaymentsEnabled]);
  useEffect(() => {
    // A route transition owns a new invoice, customer, and options snapshot.
    // Clear the old snapshot first and invalidate every late response from it.
    const route = paymentRouteRef.current;
    route.alive = true;
    loadRequestRef.current += 1;
    setInvoice(null);
    setContact(null);
    setPaymentData(null);
    setLoadError('');
    setLoading(true);
    setSubmitting(false);
    load();
    return () => {
      route.alive = false;
      route.activeToken = null;
      route.token += 1;
      loadRequestRef.current += 1;
    };
  }, [load]);

  const submit = async (payload) => {
    if (!billingEnabled || !receivePaymentsEnabled) return;
    const route = paymentRouteRef.current;
    const token = ++route.token;
    const routeEpoch = route.epoch;
    const isCurrentRoute = () => {
      const current = paymentRouteRef.current;
      return current.invoiceId === invoiceId
        && current.epoch === routeEpoch
        && current.activeToken === token
        && current.alive;
    };
    route.activeToken = token;
    if (!isCurrentRoute()) return;
    setSubmitting(true);
    const { client_request_id: clientRequestId, ...canonicalPayment } = payload;
    const clearPending = () => clearPendingInvoicePaymentIdentity({
      actorId: employee?.id,
      invoiceId,
      payload: canonicalPayment,
      requestId: clientRequestId,
    });
    try {
      const authHeaders = await getAuthHeader();
      // The durable retry identity remains in storage, but an old route must
      // not begin a payment POST after authentication completes.
      if (!isCurrentRoute()) return;
      const response = await fetch('/api/qbo-receive-payment', { method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        const definitiveFailure = data.outcome === 'rejected'
          || ['conflict', 'voided', 'deleted'].includes(data.outcome)
          || (response.status >= 400 && response.status < 500
            && ![408, 425, 429].includes(response.status)
            && data.retry_unchanged !== true);
        if (definitiveFailure) await clearPending();
        const retry = data.retry_unchanged ? ' QuickBooks may already have accepted it; retry without changing the form.' : '';
        throw new Error((data.error || 'QuickBooks could not receive this payment.') + retry);
      }
      await clearPending();
      if (!isCurrentRoute()) return;
      ok('Payment received and sent to QuickBooks.');
      notify('success');
      navigate(adminInvoiceHref(invoiceId), { replace: true });
    } catch (error) {
      if (!isCurrentRoute()) return;
      notify('error');
      err(error?.message || 'Could not receive payment.');
    } finally {
      if (isCurrentRoute()) {
        paymentRouteRef.current.activeToken = null;
        setSubmitting(false);
      }
    }
  };

  const back = () => goBackOr(navigate, adminInvoiceHref(invoiceId));
  if (!billingEnabled) return <AdminMobilePage title="Receive payment" back={back}><div className="am-stub">Billing is turned off (feature flag <code>feature:billing</code>).</div></AdminMobilePage>;
  if (loading) return <AdminMobilePage title="Receive payment" back={back}><TabLoading /></AdminMobilePage>;
  if (!receivePaymentsEnabled) return <AdminMobilePage title="Receive payment" back={back}><div className="am-stub">Receive payments is currently unavailable.</div></AdminMobilePage>;
  if (loadError) return <AdminMobilePage title="Receive payment" back={back}><ErrorState message={loadError} onRetry={invoice?.locked ? undefined : load} /></AdminMobilePage>;
  return <AdminMobilePage title="Receive payment" subtitle={invoice?.qbo_doc_number || invoice?.invoice_number}><InvoicePaymentFlow invoice={invoice} contact={contact} paymentData={paymentData} submitting={submitting} actorId={employee?.id} onBack={back} onSubmit={submit} /></AdminMobilePage>;
}
