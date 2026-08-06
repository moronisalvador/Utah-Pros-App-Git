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
import { allocationTotal, cents, money, nextRequestIdentity, shouldDisarmReviewOnBlur, toggleAllocationFill, validateReceipt } from './paymentAllocation';
import { err } from '@/lib/toast';
import { todayInCompanyTimeZone } from '@/lib/companyDate';

const PAYERS = [['homeowner', 'Homeowner'], ['insurance', 'Insurance'], ['other', 'Other']];
// Display names for jobs.division — the team's vocabulary (water reads as
// Mitigation, matching the Overview legend), so an allocator can tell nine
// same-customer invoices apart at a glance.
const DIVISION_LABELS = {
  water: 'Mitigation',
  reconstruction: 'Reconstruction',
  mold: 'Mold',
  remodeling: 'Remodeling',
  contents: 'Contents',
  fire: 'Fire',
  general: 'General',
};
const divisionLabel = (division) => DIVISION_LABELS[String(division || '').toLowerCase()] || null;
// "Loss 6/14/25" — compact, unambiguous, and never timezone-shifted (the date
// is a plain calendar date; parsing it as UTC noon keeps the stored day).
const lossDate = (value) => {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return `Loss ${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}/${String(parsed.getUTCFullYear()).slice(2)}`;
};
const BODY_STYLE = { color: C.body };
const MUTED_STYLE = { color: C.muted, fontSize: 'var(--text-sm)' };
const INK_STYLE = { color: C.ink };
const CARD_STYLE = { display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' };
const GRID_STYLE = { display: 'grid', gridTemplateColumns: 'var(--coll-receive-payment-columns,repeat(3,minmax(0,1fr)))', gap: 'var(--space-4)' };
const LABEL_STYLE = { ...BODY_STYLE, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 700 };
const FIELD_STYLE = { minHeight: 44, border: `1px solid ${C.cardBorder}`, borderRadius: 'var(--radius-md)', background: C.cardBg, color: C.ink, padding: '10px var(--space-3)' };
const SECTION_STYLE = { ...INK_STYLE, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' };
const ALLOCATION_FRAME_STYLE = { border: `1px solid ${C.cardBorder}`, borderRadius: 'var(--radius-md)', overflow: 'hidden' };
// The tappable label half of an allocation row — a real button (keyboard +
// screen-reader reachable) stripped of chrome so the row reads as before.
const FILL_STYLE = {
  ...BODY_STYLE,
  background: 'none', border: 0, padding: 0, margin: 0,
  font: 'inherit', textAlign: 'left', cursor: 'pointer', flex: 1,
};
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
  const method = data.payment_methods?.find((item) => item.id === methodId);
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
      <label style={LABEL_STYLE}>Customer<select className="coll-receive-payment-field" style={FIELD_STYLE} value={contactId} onChange={(e) => { const id = e.target.value; setDirty(() => setContactId(id)); if (!data.contact && id) onSelectContact?.(id); }} disabled={!!data.contact}><option value="">Choose customer</option>{(data.contacts || (data.contact ? [data.contact] : [])).map((item) => <option key={item.id} value={item.id}>{item.name || item.display_name || item.id}</option>)}</select></label>
      <label style={LABEL_STYLE}>Payment date<input className="coll-receive-payment-field" style={FIELD_STYLE} type="date" value={paymentDate} onChange={(e) => setDirty(() => setPaymentDate(e.target.value))} /></label>
      <label style={LABEL_STYLE}>Paid by<select className="coll-receive-payment-field" style={FIELD_STYLE} value={payerType} onChange={(e) => setDirty(() => setPayerType(e.target.value))}>{PAYERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label style={LABEL_STYLE}>Method<select className="coll-receive-payment-field" style={FIELD_STYLE} value={methodId} onChange={(e) => setDirty(() => setMethodId(e.target.value))}><option value="">Choose method</option>{(data.payment_methods || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label style={LABEL_STYLE}>Check / reference{String(method?.type || method?.name).toLowerCase() === 'check' ? ' *' : ''}<input className="coll-receive-payment-field" style={FIELD_STYLE} value={referenceNumber} onChange={(e) => setDirty(() => setReferenceNumber(e.target.value))} placeholder="Check #, ACH reference…" /></label>
      <label style={LABEL_STYLE}>Deposit to<select className="coll-receive-payment-field" style={FIELD_STYLE} value={depositAccountId} onChange={(e) => setDirty(() => setDepositAccountId(e.target.value))}><option value="">Choose account</option>{(data.deposit_accounts || []).map((item) => <option key={item.id} value={item.id}>{item.name}{item.account_type ? ` · ${item.account_type}` : ''}</option>)}</select></label>
    </div>
    <div style={SECTION_STYLE}><div><b>Allocate payment</b><span style={MUTED_STYLE}> Apply only to the invoices shown below.</span></div>
      {(data.invoices || []).length === 0 ? <p className="coll-receive-payment-empty" style={MUTED_STYLE}>This customer has no open QBO-linked invoices.</p> : <div className="coll-receive-payment-allocations" style={ALLOCATION_FRAME_STYLE}>{data.invoices.map((invoice) => {
        const value = allocationInputs[invoice.id] ?? '';
        const borderBottomWidth = invoice === data.invoices[data.invoices.length - 1] ? 0 : 1;
        // The job is the identity the team knows — nine INV-numbers for one
        // property manager say nothing; job number + type + address + loss
        // date say everything (owner request 2026-08-06).
        const context = [
          divisionLabel(invoice.job_division),
          invoice.job_address,
          lossDate(invoice.date_of_loss),
        ].filter(Boolean).join(' · ');
        const rowName = invoice.job_number || invoice.invoice_number || 'Invoice';
        return <div className="coll-receive-payment-allocation" style={{ ...ALLOCATION_STYLE, borderBottomWidth }} key={invoice.id}><button type="button" className="coll-receive-payment-fill" style={FILL_STYLE} title="Tap to fill the full open balance; tap again to clear" aria-label={`Fill full balance for ${rowName}`} onClick={() => setDirty(() => setAllocationInputs((items) => ({ ...items, [invoice.id]: toggleAllocationFill(items[invoice.id], invoice.balance_cents) })))}><b>{rowName}</b><span style={MUTED_STYLE}>{context ? ` · ${context}` : ''} · Open {money(invoice.balance_cents)}</span></button><input className="coll-receive-payment-field coll-receive-payment-amount" style={AMOUNT_STYLE} aria-label={`Allocation for ${rowName}`} inputMode="decimal" value={value} placeholder="0.00" onChange={(e) => { const next = e.target.value; if (next === '' || cents(next) != null) setDirty(() => setAllocationInputs((items) => ({ ...items, [invoice.id]: next }))); }} /></div>;
      })}</div>}
    </div>
    <div className="coll-receive-payment-review" style={REVIEW_STYLE}><div style={SUMMARY_STYLE}><span>Payment total</span><strong>{money(total)}</strong></div><div style={SUMMARY_STYLE}><span>Allocations</span><strong>{payload.allocations.length}</strong></div><p style={{ ...MUTED_STYLE, gridColumn: '1/-1', margin: 0 }}>{armed ? 'Review is armed. Confirm to create one QuickBooks payment.' : 'Review the total, deposit account, reference, and invoice allocations before continuing.'}</p><div className="coll-receive-payment-actions" style={ACTIONS_STYLE}><GhostButton onClick={() => setArmed(false)} disabled={!armed || submitting}>Edit</GhostButton><PrimaryButton onBlur={() => { if (armed) setArmed(false); }} onClick={submit} disabled={submitting || !contactId || !(data.invoices || []).length}>{submitting ? 'Saving…' : armed ? `Confirm ${money(total)} payment` : 'Review payment'}</PrimaryButton></div></div>
  </CollCard>;
}
