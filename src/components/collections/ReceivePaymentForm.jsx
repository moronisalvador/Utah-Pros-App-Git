/**
 * ════════════════════════════════════════════════
 * FILE: ReceivePaymentForm.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Collects one payment and lets an administrator divide it among open invoices.
 *   It makes the person review the exact total a second time before anything is sent.
 *
 * WHERE IT LIVES:
 *   Route:        /collections/receive-payment
 *   Rendered by:  src/pages/ReceivePayment.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  Collections kit, paymentAllocation, toast, companyDate
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Amounts remain integer cents until the protected server receives them.
 *   - Any changed field disarms confirmation and replaces a prior retry ID.
 * ════════════════════════════════════════════════
 */
import { useMemo, useState } from 'react';
import { CollCard, PrimaryButton, GhostButton } from './collKit';
import { C } from './collTokens';
import SearchSelect from './SearchSelect';
import DatePicker from '@/components/DatePicker';
import { allocationTotal, cents, money, nextRequestIdentity, shouldDisarmReviewOnBlur, validateReceipt } from './paymentAllocation';
import { err } from '@/lib/toast';
import { todayInCompanyTimeZone } from '@/lib/companyDate';

const PAYER_OPTIONS = [
  { id: 'homeowner', name: 'Homeowner' },
  { id: 'insurance', name: 'Insurance' },
  { id: 'other', name: 'Other' },
];
const BODY_STYLE = { color: C.body };
const MUTED_STYLE = { color: C.muted, fontSize: 'var(--text-sm)' };
const INK_STYLE = { color: C.ink };
const CARD_STYLE = { display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' };
const GRID_STYLE = { display: 'grid', gridTemplateColumns: 'var(--coll-receive-payment-columns,repeat(3,minmax(0,1fr)))', gap: 'var(--space-4)' };
const LABEL_STYLE = { ...BODY_STYLE, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 700 };
// One explicit contract for this mixed-control row. Component defaults differ
// by surface (shared DatePicker 48px; Collections inputs 44px), so every one of
// these six controls receives the same box geometry instead of inheriting.
const CONTROL_TRIGGER_STYLE = {
  height: 44,
  minHeight: 44,
  boxSizing: 'border-box',
  borderRadius: 'var(--radius-md)',
  padding: '10px var(--space-3)',
};
const FIELD_STYLE = { ...CONTROL_TRIGGER_STYLE, border: `1px solid ${C.cardBorder}`, background: C.cardBg, color: C.ink };
const SECTION_STYLE = { ...INK_STYLE, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' };
const ALLOCATION_FRAME_STYLE = { border: `1px solid ${C.cardBorder}`, borderRadius: 'var(--radius-md)', overflow: 'hidden' };
const ALLOCATION_STYLE = {
  ...BODY_STYLE, display: 'flex', flexDirection: 'row',
  alignItems: 'var(--coll-receive-payment-allocation-align,center)',
  justifyContent: 'space-between',
  gap: 'var(--coll-receive-payment-allocation-gap,6px)',
  padding: 'var(--space-3)', borderBottomStyle: 'solid', borderBottomColor: C.cardBorder,
  fontSize: 12, fontWeight: 700,
};
const AMOUNT_STYLE = { ...FIELD_STYLE, width: 'var(--coll-receive-payment-amount-width,120px)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const REVIEW_STYLE = {
  display: 'grid',
  gridTemplateColumns: 'var(--coll-receive-payment-review-columns,repeat(2,minmax(0,1fr)))',
  gap: 'var(--space-3)', padding: 'var(--space-4)',
  background: C.pageBg, borderRadius: 'var(--radius-md)',
};
const SUMMARY_STYLE = { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)' };
const ACTIONS_STYLE = {
  ...SUMMARY_STYLE, gridColumn: '1/-1', justifyContent: 'flex-end',
  flexDirection: 'var(--coll-receive-payment-actions-direction,row)',
};

export default function ReceivePaymentForm({ data, prefillInvoice, onSubmit, onSelectContact, submitting }) {
  const [contactId, setContactId] = useState(data.contact?.id || '');
  const [paymentDate, setPaymentDate] = useState(todayInCompanyTimeZone);
  const [payerType, setPayerType] = useState('homeowner');
  const [methodId, setMethodId] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [depositAccountId, setDepositAccountId] = useState('');
  const [allocationInputs, setAllocationInputs] = useState(() => (prefillInvoice ? { [prefillInvoice]: '' } : {}));
  const [armed, setArmed] = useState(false);
  const [identity, setIdentity] = useState(null);
  const contactOptions = (data.contacts || (data.contact ? [data.contact] : []))
    .map((item) => ({ id: String(item.id), name: item.name || item.display_name || String(item.id) }));
  const methodOptions = (data.payment_methods || [])
    .map((item) => ({ id: String(item.id), name: item.name || item.type || String(item.id) }));
  const depositAccountOptions = (data.deposit_accounts || [])
    .map((item) => ({
      id: String(item.id),
      name: `${item.name || item.id}${item.account_type ? ` · ${item.account_type}` : ''}`,
    }));
  const method = data.payment_methods?.find((item) => String(item.id) === methodId);
  const allocations = useMemo(() => Object.entries(allocationInputs)
    .map(([invoice_id, value]) => ({ invoice_id, amount_cents: cents(value) }))
    .filter((item) => Number(item.amount_cents) > 0), [allocationInputs]);
  const total = allocationTotal(allocations);
  const setDirty = (change) => { setArmed(false); setIdentity(null); change(); };
  const payload = useMemo(() => ({
    contact_id: contactId, payment_date: paymentDate, payer_type: payerType,
    payment_method: method?.type || method?.name || '', qbo_payment_method_id: methodId || null,
    reference_number: referenceNumber.trim() || null, deposit_account_id: depositAccountId,
    allocations: allocations.filter((item) => Number(item.amount_cents) > 0),
  }), [contactId, paymentDate, payerType, method, methodId, referenceNumber, depositAccountId, allocations]);
  const submit = async () => {
    const message = validateReceipt({ contactId, paymentDate, paymentMethod: payload.payment_method, referenceNumber, depositAccountId, allocations: payload.allocations });
    if (message) return err(message);
    const overBalance = payload.allocations.find((allocation) => {
      const invoice = data.invoices?.find((item) => item.id === allocation.invoice_id);
      return !invoice || allocation.amount_cents > invoice.balance_cents;
    });
    if (overBalance) return err('An allocation is greater than the current open invoice balance.');
    if (!armed) return setArmed(true);
    const stable = nextRequestIdentity(identity, payload);
    setIdentity(stable);
    try {
      await onSubmit({ ...payload, client_request_id: stable.id });
    } catch (error) {
      err(error?.message || 'Could not receive payment.');
    }
  };
  return <CollCard style={CARD_STYLE} onBlur={(event) => {
    if (armed && shouldDisarmReviewOnBlur(event.currentTarget, event.relatedTarget)) setArmed(false);
  }}>
    <div className="coll-receive-payment-grid" style={GRID_STYLE}>
      <div style={LABEL_STYLE}>Customer<SearchSelect ariaLabel="Customer" value={contactId} options={contactOptions} placeholder="Choose customer" disabled={!!data.contact} triggerStyle={CONTROL_TRIGGER_STYLE} onChange={(item) => { const id = item?.id || ''; setDirty(() => setContactId(id)); if (!data.contact && id) onSelectContact?.(id); }} /></div>
      <div style={LABEL_STYLE}>Payment date<DatePicker ariaLabel="Payment date" value={paymentDate} triggerStyle={CONTROL_TRIGGER_STYLE} onChange={(value) => setDirty(() => setPaymentDate(value))} /></div>
      <div style={LABEL_STYLE}>Paid by<SearchSelect ariaLabel="Paid by" value={payerType} options={PAYER_OPTIONS} clearable={false} triggerStyle={CONTROL_TRIGGER_STYLE} onChange={(item) => setDirty(() => setPayerType(item?.id || 'homeowner'))} /></div>
      <div style={LABEL_STYLE}>Method<SearchSelect ariaLabel="Method" value={methodId} options={methodOptions} placeholder="Choose method" triggerStyle={CONTROL_TRIGGER_STYLE} onChange={(item) => setDirty(() => setMethodId(item?.id || ''))} /></div>
      <label style={LABEL_STYLE}>Check / reference{String(method?.type || method?.name).toLowerCase() === 'check' ? ' *' : ''}<input aria-label="Check / reference" className="coll-receive-payment-field" style={FIELD_STYLE} value={referenceNumber} onChange={(e) => setDirty(() => setReferenceNumber(e.target.value))} placeholder="Check #, ACH reference…" /></label>
      <div style={LABEL_STYLE}>Deposit to<SearchSelect ariaLabel="Deposit to" value={depositAccountId} options={depositAccountOptions} placeholder="Choose account" triggerStyle={CONTROL_TRIGGER_STYLE} onChange={(item) => setDirty(() => setDepositAccountId(item?.id || ''))} /></div>
    </div>
    <div style={SECTION_STYLE}><div><b>Allocate payment</b><span style={MUTED_STYLE}> Apply only to the invoices shown below.</span></div>
      {(data.invoices || []).length === 0 ? <p className="coll-receive-payment-empty" style={MUTED_STYLE}>This customer has no open QBO-linked invoices.</p> : <div className="coll-receive-payment-allocations" style={ALLOCATION_FRAME_STYLE}>{data.invoices.map((invoice) => {
        const value = allocationInputs[invoice.id] ?? '';
        const borderBottomWidth = invoice === data.invoices[data.invoices.length - 1] ? 0 : 1;
        return <div className="coll-receive-payment-allocation" style={{ ...ALLOCATION_STYLE, borderBottomWidth }} key={invoice.id}><div><b>{invoice.invoice_number || 'Invoice'}</b><span style={MUTED_STYLE}>{invoice.job_number ? ` · ${invoice.job_number}` : ''} · Open {money(invoice.balance_cents)}</span></div><input className="coll-receive-payment-field coll-receive-payment-amount" style={AMOUNT_STYLE} aria-label={`Allocation for ${invoice.invoice_number || invoice.id}`} inputMode="decimal" value={value} placeholder="0.00" onChange={(e) => { const next = e.target.value; if (next === '' || cents(next) != null) setDirty(() => setAllocationInputs((items) => ({ ...items, [invoice.id]: next }))); }} /></div>;
      })}</div>}
    </div>
    <div className="coll-receive-payment-review" style={REVIEW_STYLE}><div style={SUMMARY_STYLE}><span>Payment total</span><strong>{money(total)}</strong></div><div style={SUMMARY_STYLE}><span>Allocations</span><strong>{payload.allocations.length}</strong></div><p style={{ ...MUTED_STYLE, gridColumn: '1/-1', margin: 0 }}>{armed ? 'Review is armed. Confirm to create one QuickBooks payment.' : 'Review the total, deposit account, reference, and invoice allocations before continuing.'}</p><div className="coll-receive-payment-actions" style={ACTIONS_STYLE}><GhostButton onClick={() => setArmed(false)} disabled={!armed || submitting}>Edit</GhostButton><PrimaryButton onBlur={() => { if (armed) setArmed(false); }} onClick={submit} disabled={submitting || !contactId || !(data.invoices || []).length}>{submitting ? 'Saving…' : armed ? `Confirm ${money(total)} payment` : 'Review payment'}</PrimaryButton></div></div>
  </CollCard>;
}
