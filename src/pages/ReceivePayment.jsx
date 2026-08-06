/**
 * ════════════════════════════════════════════════
 * FILE: ReceivePayment.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows an administrator how to receive one customer payment and divide it
 *   between that customer's open invoices. It asks the protected server for
 *   current choices, then clearly shows the receipt QuickBooks accepted.
 *
 * WHERE IT LIVES:
 *   Route:        /collections/receive-payment
 *   Rendered by:  src/App.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  AuthContext, realtime, toast, Collections kit, ReceivePaymentForm,
 *              ErrorState, EmptyState
 *   Data:      reads  → UNCERTAIN — protected QBO receipt endpoint
 *              writes → UNCERTAIN — protected QBO receipt endpoint
 *
 * NOTES / GOTCHAS:
 *   - The browser never decides whether a payment is valid or writes money rows.
 *   - A failed submit leaves the typed form and stable retry ID in place.
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
import ErrorState from '@/components/ui/ErrorState';
import EmptyState from '@/components/ui/EmptyState';

// The office payments ledger on web; the More tab on native, where the entry
// lives (the broad /collections surface deliberately has no native route).
const BACK_TARGET = IS_NATIVE_BUILD ? '/tech/more' : '/collections?tab=payments';

export default function ReceivePayment() {
  const { db } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const dbRef = useRef(db);
  dbRef.current = db;
  const contactId = params.get('contact');
  const invoiceId = params.get('invoice');
  const load = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const auth = await getAuthHeader(dbRef.current);
      const query = contactId ? `?contact_id=${encodeURIComponent(contactId)}` : '';
      const response = await fetch('/api/qbo-receive-payment' + query, { headers: auth });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not load payment options.');
      setData(json);
    } catch (error) {
      console.error('Receive payment options failed', error);
      setLoadError('Could not load payment options.');
    } finally { setLoading(false); }
  }, [contactId]);
  useEffect(() => { load(); }, [load]);
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
  if (loading) return <div className="coll-page"><div className="loading-page"><div className="spinner" /></div></div>;
  if (loadError) return <div className="coll-page"><ErrorState message={loadError} onRetry={load} secondary={<GhostButton onClick={() => navigate(BACK_TARGET)}>{IS_NATIVE_BUILD ? 'Back' : 'Back to payments'}</GhostButton>} /></div>;
  if (receipt) return <div className="coll-page" style={{ overflowX: 'clip' }}><header className="coll-header"><div><h1 className="coll-title">Payment received</h1><div className="coll-subtitle">The receipt is recorded in UPR and QuickBooks.</div></div></header><CollCard><h2 style={{ marginTop: 0 }}>Receipt complete</h2><p>UPR receipt <b>{receipt.receipt_id || '—'}</b> · QuickBooks payment <b>{receipt.qbo_payment_id || '—'}</b></p><div><GhostButton onClick={() => navigate(BACK_TARGET)}>{IS_NATIVE_BUILD ? 'Done' : 'Return to Payments'}</GhostButton></div></CollCard></div>;
  if (contactId && !(data?.invoices || []).length) return <div className="coll-page"><EmptyState icon="💵" title="No open invoices" sub="This customer has no open QuickBooks-linked invoices to receive a payment against." action={<GhostButton onClick={() => navigate(BACK_TARGET)}>{IS_NATIVE_BUILD ? 'Back' : 'Back to Payments'}</GhostButton>} /></div>;
  return <div className="coll-page" style={{ overflowX: 'clip' }}><header className="coll-header"><div><h1 className="coll-title">Receive payment</h1><div className="coll-subtitle">Create one QuickBooks payment and allocate it across open invoices.</div></div><div className="coll-actions"><GhostButton onClick={() => navigate(BACK_TARGET)}>{IS_NATIVE_BUILD ? '← Back' : '← Payments'}</GhostButton></div></header>{data && <ReceivePaymentForm key={`${contactId || 'contacts'}:${invoiceId || 'none'}`} data={data} prefillInvoice={invoiceId} onSubmit={submit} onSelectContact={(id) => navigate(`/collections/receive-payment?contact=${encodeURIComponent(id)}${invoiceId ? `&invoice=${encodeURIComponent(invoiceId)}` : ''}`)} submitting={submitting} />}</div>;
}
