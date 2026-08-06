/**
 * ════════════════════════════════════════════════
 * FILE: ReceivePayment.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows an administrator how to receive one customer payment and divide it
 *   between that customer's open invoices. It loads the customer roster once,
 *   then fetches each chosen customer's open invoices without leaving the form,
 *   and clearly shows the receipt QuickBooks accepted.
 *
 * WHERE IT LIVES:
 *   Route:        /collections/receive-payment
 *   Rendered by:  src/App.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  AuthContext, realtime, toast, Collections kit, ReceivePaymentForm,
 *              ErrorState
 *   Data:      reads  → UNCERTAIN — protected QBO receipt endpoint
 *              writes → UNCERTAIN — protected QBO receipt endpoint
 *
 * NOTES / GOTCHAS:
 *   - The browser never decides whether a payment is valid or writes money rows.
 *   - A failed submit leaves the typed form and stable retry ID in place.
 *   - Choosing a customer swaps only the invoice section (no page remount);
 *     the URL still carries ?contact= so links and refresh keep working.
 * ════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { IS_NATIVE_BUILD } from '@/routes/buildTargetPages';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import { err, ok } from '@/lib/toast';
import { CollCard, GhostButton } from '@/components/collections/collKit';
import ReceivePaymentForm from '@/components/collections/ReceivePaymentForm';
import ReceivePaymentMobileFlow from '@/components/collections/ReceivePaymentMobileFlow';
import ErrorState from '@/components/ui/ErrorState';

// The office payments ledger on web; the More tab on native, where the entry
// lives (the broad /collections surface deliberately has no native route).
const BACK_TARGET = IS_NATIVE_BUILD ? '/tech/more' : '/collections?tab=payments';

// One-hand-in-the-truck flow on phones; the QBO-style form on desks. Same
// 768px boundary the mobile CSS uses (Rule 5).
const narrowQuery = typeof matchMedia !== 'undefined' ? matchMedia('(max-width: 768px)') : null;
function useMobileFlow() {
  const [narrow, setNarrow] = useState(IS_NATIVE_BUILD || !!narrowQuery?.matches);
  useEffect(() => {
    if (IS_NATIVE_BUILD || !narrowQuery) return undefined;
    const onChange = () => setNarrow(narrowQuery.matches);
    narrowQuery.addEventListener('change', onChange);
    return () => narrowQuery.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export default function ReceivePayment() {
  const { db } = useAuth();
  const navigate = useNavigate();
  const mobileFlow = useMobileFlow();
  const [params] = useSearchParams();
  const [contacts, setContacts] = useState(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState(null);
  const [contactData, setContactData] = useState(null);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoicesError, setInvoicesError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const dbRef = useRef(db);
  dbRef.current = db;
  // Captured once: a later ?contact= change only ever comes from our own
  // replace-navigations, which have already fetched.
  const [initialContact] = useState(() => params.get('contact'));
  const invoiceId = params.get('invoice');
  const seqRef = useRef(0);
  const lastContactRef = useRef(null);

  const fetchJson = useCallback(async (query) => {
    const auth = await getAuthHeader(dbRef.current);
    const response = await fetch('/api/qbo-receive-payment' + query, { headers: auth });
    const json = await response.json();
    if (!response.ok || !json.ok) throw new Error(json.error || 'Could not load payment options.');
    return json;
  }, []);

  const selectContact = useCallback(async (id, { updateUrl = true } = {}) => {
    const seq = ++seqRef.current;
    lastContactRef.current = id;
    setInvoicesError(null);
    setInvoicesLoading(true);
    if (updateUrl) navigate(`/collections/receive-payment?contact=${encodeURIComponent(id)}`, { replace: true });
    try {
      const json = await fetchJson(`?contact_id=${encodeURIComponent(id)}`);
      if (seq === seqRef.current) setContactData(json);
    } catch (error) {
      console.error('Receive payment invoices failed', error);
      if (seq === seqRef.current) {
        setContactData(null);
        setInvoicesError("Could not load this customer's open invoices.");
      }
    } finally {
      if (seq === seqRef.current) setInvoicesLoading(false);
    }
  }, [fetchJson, navigate]);

  const clearContact = useCallback(() => {
    seqRef.current += 1;
    lastContactRef.current = null;
    setContactData(null);
    setInvoicesError(null);
    setInvoicesLoading(false);
    navigate('/collections/receive-payment', { replace: true });
  }, [navigate]);

  const boot = useCallback(async () => {
    setBooting(true);
    setBootError(null);
    try {
      setContacts((await fetchJson('')).contacts || []);
    } catch (error) {
      console.error('Receive payment options failed', error);
      setBootError('Could not load payment options.');
    } finally {
      setBooting(false);
    }
  }, [fetchJson]);

  useEffect(() => {
    boot();
    if (initialContact) selectContact(initialContact, { updateUrl: false });
  }, [boot, selectContact, initialContact]);

  const submit = async (payload) => {
    setSubmitting(true);
    try {
      const auth = await getAuthHeader(dbRef.current);
      const response = await fetch('/api/qbo-receive-payment', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        const suffix = json.retry_unchanged
          ? ' QuickBooks may already have accepted it; retry without changing the form so the same request is resumed.'
          : '';
        throw new Error((json.error || 'QuickBooks could not receive this payment.') + suffix);
      }
      setReceipt(json); ok('Payment received and sent to QuickBooks.');
    } catch (error) { err(error.message || 'Could not receive payment.'); } finally { setSubmitting(false); }
  };
  if (booting) return <div className="coll-page"><div className="loading-page"><div className="spinner" /></div></div>;
  if (bootError) return <div className="coll-page"><ErrorState message={bootError} onRetry={boot} secondary={<GhostButton onClick={() => navigate(BACK_TARGET)}>{IS_NATIVE_BUILD ? 'Back' : 'Back to payments'}</GhostButton>} /></div>;
  if (receipt) return <div className="coll-page" style={{ overflowX: 'clip' }}><header className="coll-header"><div><h1 className="coll-title">Payment received</h1><div className="coll-subtitle">The receipt is recorded in UPR and QuickBooks.</div></div></header><CollCard><h2 style={{ marginTop: 0 }}>Receipt complete</h2><p>UPR receipt <b>{receipt.receipt_id || '—'}</b> · QuickBooks payment <b>{receipt.qbo_payment_id || '—'}</b></p><div><GhostButton onClick={() => navigate(BACK_TARGET)}>{IS_NATIVE_BUILD ? 'Done' : 'Return to Payments'}</GhostButton></div></CollCard></div>;
  const shared = {
    contacts: contacts || [],
    data: contactData,
    prefillInvoice: invoiceId,
    invoicesLoading,
    invoicesError,
    onRetryInvoices: () => { if (lastContactRef.current) selectContact(lastContactRef.current, { updateUrl: false }); },
    onSelectContact: (id) => selectContact(id),
    onClearContact: clearContact,
    onSubmit: submit,
    submitting,
  };
  if (mobileFlow) {
    return <ReceivePaymentMobileFlow {...shared} onExit={() => navigate(BACK_TARGET)} />;
  }
  return <div className="coll-page" style={{ overflowX: 'clip' }}><header className="coll-header"><div><h1 className="coll-title">Receive payment</h1><div className="coll-subtitle">Create one QuickBooks payment and allocate it across open invoices.</div></div><div className="coll-actions"><GhostButton onClick={() => navigate(BACK_TARGET)}>{IS_NATIVE_BUILD ? '← Back' : '← Payments'}</GhostButton></div></header><ReceivePaymentForm {...shared} /></div>;
}
