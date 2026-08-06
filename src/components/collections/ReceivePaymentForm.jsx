/**
 * ════════════════════════════════════════════════
 * FILE: ReceivePaymentForm.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Collects one payment and lets an administrator divide it among open invoices.
 *   The person types to find the customer, taps invoices to apply the payment,
 *   watches the received total build at the top, and must review the exact total
 *   a second time before anything is sent.
 *
 * WHERE IT LIVES:
 *   Route:        /collections/receive-payment
 *   Rendered by:  src/pages/ReceivePayment.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  Collections kit, paymentAllocation, toast, companyDate, TabLoading,
 *              ErrorState
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Amounts remain integer cents until the protected server receives them.
 *   - Any changed field disarms confirmation and replaces a prior retry ID.
 *   - The customer picker filters client-side: the roster tops out in the low
 *     hundreds, so the full list is already in memory.
 * ════════════════════════════════════════════════
 */
import { useEffect, useMemo, useState } from 'react';
import { CollCard, PrimaryButton, GhostButton } from './collKit';
import { C, STATUS, divColor } from './collTokens';
import { allocationTotal, cents, money, nextRequestIdentity, shouldDisarmReviewOnBlur, toggleAllocationFill, validateReceipt } from './paymentAllocation';
import { err } from '@/lib/toast';
import { todayInCompanyTimeZone } from '@/lib/companyDate';
import TabLoading from '@/components/TabLoading';
import ErrorState from '@/components/ui/ErrorState';

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
// "6/14/25" — compact, unambiguous, and never timezone-shifted (the date is a
// plain calendar date; parsing it as UTC noon keeps the stored day). The Loss
// column header carries the meaning, so no prefix.
const lossDate = (value) => {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}/${String(parsed.getUTCFullYear()).slice(2)}`;
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
// Header: customer identity on the left, the QBO-style running received total
// on the right, so the number the person is entering is always in view.
const HEADER_STYLE = { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-4)' };
const CUSTOMER_BLOCK_STYLE = { ...LABEL_STYLE, flex: '1 1 240px', minWidth: 0, position: 'relative' };
const TOTAL_BLOCK_STYLE = { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, textAlign: 'right' };
const TOTAL_LABEL_STYLE = { color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' };
const TOTAL_VALUE_STYLE = { ...INK_STYLE, fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 };
const SELECTED_CUSTOMER_STYLE = { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minHeight: 44 };
const SELECTED_NAME_STYLE = { ...INK_STYLE, fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
// The dropdown floats over the card; offset+blur shadow so it reads as depth.
const LIST_STYLE = {
  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 4,
  maxHeight: 280, overflowY: 'auto', background: C.cardBg,
  border: `1px solid ${C.cardBorder}`, borderRadius: 'var(--radius-md)',
  boxShadow: '0 8px 24px rgba(16, 24, 40, 0.16)', padding: 4,
  display: 'flex', flexDirection: 'column',
};
const OPTION_STYLE = {
  ...BODY_STYLE, minHeight: 44, display: 'flex', alignItems: 'center',
  padding: '0 var(--space-3)', border: 0, background: 'none', width: '100%',
  textAlign: 'left', font: 'inherit', fontWeight: 600, cursor: 'pointer',
  borderRadius: 'calc(var(--radius-md) - 4px)',
};
// One column template shared by the header and every row button, so the table
// stays aligned: check · job · type · address (flexes) · loss · open balance.
// Owner-directed 2026-08-06: the old run-on "job · type · address · loss ·
// open" sentence per row was unreadable at nine invoices.
const TABLE_COLS_STYLE = {
  display: 'grid',
  gridTemplateColumns: '26px 110px 150px minmax(0,1fr) 82px 110px',
  gap: 12, alignItems: 'center', minWidth: 0, flex: 1,
};
const TABLE_HEAD_ROW_STYLE = {
  display: 'flex', alignItems: 'center', gap: 'var(--coll-receive-payment-allocation-gap,6px)',
  padding: '8px var(--space-3)', background: C.headFill,
  borderBottom: `1px solid ${C.cardBorder}`,
};
const HEAD_LABEL_STYLE = {
  color: C.muted, fontSize: 11, fontWeight: 700,
  letterSpacing: '0.05em', textTransform: 'uppercase',
};
const CELL_TEXT_STYLE = {
  ...BODY_STYLE, fontSize: 13, fontWeight: 600, minWidth: 0,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const DIV_CHIP_STYLE = { width: 10, height: 10, borderRadius: 3, flexShrink: 0, display: 'inline-block' };
const OPEN_CELL_STYLE = {
  ...INK_STYLE, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
  textAlign: 'right', fontSize: 14,
};
// The tappable label half of an allocation row — a real button (keyboard +
// screen-reader reachable) stripped of chrome, laid out on the table grid.
const FILL_STYLE = {
  ...TABLE_COLS_STYLE,
  background: 'none', border: 0, padding: 0, margin: 0,
  font: 'inherit', textAlign: 'left', cursor: 'pointer', color: C.body,
};
const ALLOCATION_STYLE = {
  ...BODY_STYLE, display: 'flex', flexDirection: 'row',
  alignItems: 'var(--coll-receive-payment-allocation-align,center)',
  justifyContent: 'space-between',
  gap: 'var(--coll-receive-payment-allocation-gap,6px)',
  padding: '6px var(--space-3)', borderBottomStyle: 'solid', borderBottomColor: C.hairline,
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

// Drawn selection indicator (never an emoji): open ring → filled check.
function CheckDot({ on }) {
  return on
    ? <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flexShrink: 0 }}><circle cx="9" cy="9" r="8" fill={STATUS.info.solid} /><path d="M5.2 9.3l2.4 2.4 5-5" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    : <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flexShrink: 0 }}><circle cx="9" cy="9" r="8" fill="none" stroke={C.faint2} strokeWidth="1.5" /></svg>;
}

export default function ReceivePaymentForm({
  contacts, data, prefillInvoice, invoicesLoading, invoicesError,
  onRetryInvoices, onSelectContact, onClearContact, onSubmit, submitting,
}) {
  const contact = data?.contact || null;
  const [picked, setPicked] = useState(null);           // optimistic name while invoices load
  const [search, setSearch] = useState('');
  const [openList, setOpenList] = useState(false);
  const [paymentDate, setPaymentDate] = useState(todayInCompanyTimeZone);
  const [payerType, setPayerType] = useState('homeowner');
  const [methodId, setMethodId] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [depositAccountId, setDepositAccountId] = useState('');
  const [allocationInputs, setAllocationInputs] = useState({});
  const [armed, setArmed] = useState(false);
  const [identity, setIdentity] = useState(null);
  const contactKey = contact?.id || '';
  // A new customer starts a fresh allocation sheet. A deep-linked invoice
  // (InvoiceEditor → Receive payment) arrives pre-filled with its full open
  // balance so the common one-invoice case is type-free.
  useEffect(() => {
    const target = prefillInvoice && (data?.invoices || []).find((row) => row.id === prefillInvoice);
    setAllocationInputs(target ? { [target.id]: (target.balance_cents / 100).toFixed(2) } : {});
    setArmed(false);
    setIdentity(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactKey]);
  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = contacts || [];
    const hits = query ? rows.filter((row) => String(row.name || '').toLowerCase().includes(query)) : rows;
    return { shown: hits.slice(0, 40), hidden: Math.max(0, hits.length - 40) };
  }, [contacts, search]);
  const method = data?.payment_methods?.find((item) => item.id === methodId);
  const allocations = useMemo(() => Object.entries(allocationInputs)
    .map(([invoice_id, value]) => ({ invoice_id, amount_cents: cents(value) }))
    .filter((item) => Number(item.amount_cents) > 0), [allocationInputs]);
  const total = allocationTotal(allocations);
  const setDirty = (change) => { setArmed(false); setIdentity(null); change(); };
  const payload = useMemo(() => ({
    contact_id: contactKey, payment_date: paymentDate, payer_type: payerType,
    payment_method: method?.type || method?.name || '', qbo_payment_method_id: methodId || null,
    reference_number: referenceNumber.trim() || null, deposit_account_id: depositAccountId,
    allocations: allocations.filter((item) => Number(item.amount_cents) > 0),
  }), [contactKey, paymentDate, payerType, method, methodId, referenceNumber, depositAccountId, allocations]);
  const pick = (row) => {
    setPicked(row);
    setSearch('');
    setOpenList(false);
    onSelectContact?.(row.id);
  };
  const changeCustomer = () => {
    setPicked(null);
    setSearch('');
    onClearContact?.();
  };
  const submit = async () => {
    const message = validateReceipt({ contactId: contactKey, paymentDate, paymentMethod: payload.payment_method, referenceNumber, depositAccountId, allocations: payload.allocations });
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
  const activeCustomer = contact || picked;
  const invoices = data?.invoices || [];
  const selectedCount = payload.allocations.length;
  return <CollCard style={CARD_STYLE} onBlur={(event) => {
    if (armed && shouldDisarmReviewOnBlur(event.currentTarget, event.relatedTarget)) setArmed(false);
  }}>
    <div className="coll-receive-payment-header" style={HEADER_STYLE}>
      <label className="coll-receive-payment-customer" style={CUSTOMER_BLOCK_STYLE}>Customer
        {activeCustomer
          ? <span style={SELECTED_CUSTOMER_STYLE}><span style={SELECTED_NAME_STYLE}>{activeCustomer.name || activeCustomer.display_name || activeCustomer.id}</span><GhostButton onClick={changeCustomer} disabled={submitting}>Change</GhostButton></span>
          : <>
            <input
              className="coll-receive-payment-field" style={FIELD_STYLE} role="combobox"
              aria-expanded={openList} aria-controls="receive-payment-customers" aria-autocomplete="list"
              placeholder={`Search ${(contacts || []).length || ''} customers…`} value={search}
              onFocus={() => setOpenList(true)}
              onBlur={() => setOpenList(false)}
              onChange={(e) => { setSearch(e.target.value); setOpenList(true); }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpenList(false);
                if (e.key === 'Enter' && matches.shown[0]) { e.preventDefault(); pick(matches.shown[0]); }
              }}
            />
            {openList && <div id="receive-payment-customers" role="listbox" style={LIST_STYLE}>
              {matches.shown.length === 0
                ? <p style={{ ...MUTED_STYLE, margin: 0, padding: 'var(--space-3)' }}>No customers match “{search}”.</p>
                : matches.shown.map((row) => (
                  // onMouseDown fires before the input's blur closes the list.
                  <button type="button" role="option" aria-selected="false" key={row.id} style={OPTION_STYLE}
                    onMouseDown={(e) => { e.preventDefault(); pick(row); }}>
                    {row.name || row.display_name || row.id}
                  </button>
                ))}
              {matches.hidden > 0 && <p style={{ ...MUTED_STYLE, margin: 0, padding: 'var(--space-3)' }}>{matches.hidden} more — keep typing to narrow.</p>}
            </div>}
          </>}
      </label>
      <div style={TOTAL_BLOCK_STYLE}>
        <span style={TOTAL_LABEL_STYLE}>Amount received</span>
        <strong style={TOTAL_VALUE_STYLE}>{money(total)}</strong>
        <span style={MUTED_STYLE}>{selectedCount ? `${selectedCount} invoice${selectedCount === 1 ? '' : 's'}` : activeCustomer ? 'Tap an invoice to apply' : 'Pick a customer to begin'}</span>
      </div>
    </div>
    <div className="coll-receive-payment-grid" style={GRID_STYLE}>
      <label style={LABEL_STYLE}>Payment date<input className="coll-receive-payment-field" style={FIELD_STYLE} type="date" value={paymentDate} disabled={!contact} onChange={(e) => setDirty(() => setPaymentDate(e.target.value))} /></label>
      <label style={LABEL_STYLE}>Paid by<select className="coll-receive-payment-field" style={FIELD_STYLE} value={payerType} disabled={!contact} onChange={(e) => setDirty(() => setPayerType(e.target.value))}>{PAYERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label style={LABEL_STYLE}>Method<select className="coll-receive-payment-field" style={FIELD_STYLE} value={methodId} disabled={!contact} onChange={(e) => setDirty(() => setMethodId(e.target.value))}><option value="">Choose method</option>{(data?.payment_methods || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label style={LABEL_STYLE}>Check / reference{String(method?.type || method?.name).toLowerCase() === 'check' ? ' *' : ''}<input className="coll-receive-payment-field" style={FIELD_STYLE} value={referenceNumber} disabled={!contact} onChange={(e) => setDirty(() => setReferenceNumber(e.target.value))} placeholder="Check #, ACH reference…" /></label>
      <label style={LABEL_STYLE}>Deposit to<select className="coll-receive-payment-field" style={FIELD_STYLE} value={depositAccountId} disabled={!contact} onChange={(e) => setDirty(() => setDepositAccountId(e.target.value))}><option value="">Choose account</option>{(data?.deposit_accounts || []).map((item) => <option key={item.id} value={item.id}>{item.name}{item.account_type ? ` · ${item.account_type}` : ''}</option>)}</select></label>
    </div>
    <div style={SECTION_STYLE}><div><b>Outstanding invoices</b><span style={MUTED_STYLE}> Tap an invoice to apply its full balance; edit any amount by hand.</span></div>
      {!activeCustomer ? <p className="coll-receive-payment-empty" style={MUTED_STYLE}>Pick a customer to see their open invoices.</p>
        : invoicesLoading ? <TabLoading />
          : invoicesError ? <ErrorState message={invoicesError} onRetry={onRetryInvoices} />
            : invoices.length === 0 ? <p className="coll-receive-payment-empty" style={MUTED_STYLE}>This customer has no open QBO-linked invoices.</p>
              : <div className="coll-receive-payment-allocations" style={ALLOCATION_FRAME_STYLE}>
                <div style={TABLE_HEAD_ROW_STYLE} aria-hidden="true">
                  <div style={TABLE_COLS_STYLE}>
                    <span />
                    <span style={HEAD_LABEL_STYLE}>Job</span>
                    <span style={HEAD_LABEL_STYLE}>Type</span>
                    <span style={HEAD_LABEL_STYLE}>Address</span>
                    <span style={HEAD_LABEL_STYLE}>Loss</span>
                    <span style={{ ...HEAD_LABEL_STYLE, textAlign: 'right' }}>Open</span>
                  </div>
                  <span style={{ ...HEAD_LABEL_STYLE, width: 'var(--coll-receive-payment-amount-width,120px)', textAlign: 'right' }}>Apply</span>
                </div>
                {invoices.map((invoice) => {
                  const value = allocationInputs[invoice.id] ?? '';
                  const borderBottomWidth = invoice === invoices[invoices.length - 1] ? 0 : 1;
                  const on = Number(cents(value) || 0) > 0;
                  const rowName = invoice.job_number || invoice.invoice_number || 'Invoice';
                  return <div className="coll-receive-payment-allocation" style={{ ...ALLOCATION_STYLE, borderBottomWidth, background: on ? STATUS.info.tint : 'transparent' }} key={invoice.id}>
                    <button type="button" className="coll-receive-payment-fill" style={FILL_STYLE} title="Tap to fill the full open balance; tap again to clear" aria-pressed={on} aria-label={`Fill full balance for ${rowName}`} onClick={() => setDirty(() => setAllocationInputs((items) => ({ ...items, [invoice.id]: toggleAllocationFill(items[invoice.id], invoice.balance_cents) })))}>
                      <CheckDot on={on} />
                      <b style={{ ...INK_STYLE, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rowName}</b>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        {divisionLabel(invoice.job_division)
                          ? <><span style={{ ...DIV_CHIP_STYLE, background: divColor(invoice.job_division) }} /><span style={CELL_TEXT_STYLE}>{divisionLabel(invoice.job_division)}</span></>
                          : <span style={CELL_TEXT_STYLE}>—</span>}
                      </span>
                      <span style={CELL_TEXT_STYLE} title={invoice.job_address || undefined}>{invoice.job_address || '—'}</span>
                      <span style={CELL_TEXT_STYLE}>{lossDate(invoice.date_of_loss) || '—'}</span>
                      <span style={OPEN_CELL_STYLE}>{money(invoice.balance_cents)}</span>
                    </button>
                    <input className="coll-receive-payment-field coll-receive-payment-amount" style={AMOUNT_STYLE} aria-label={`Allocation for ${rowName}`} inputMode="decimal" value={value} placeholder="0.00" onChange={(e) => { const next = e.target.value; if (next === '' || cents(next) != null) setDirty(() => setAllocationInputs((items) => ({ ...items, [invoice.id]: next }))); }} />
                  </div>;
                })}
              </div>}
    </div>
    <div className="coll-receive-payment-review" style={REVIEW_STYLE}><div style={SUMMARY_STYLE}><span>Payment total</span><strong>{money(total)}</strong></div><div style={SUMMARY_STYLE}><span>Allocations</span><strong>{selectedCount}</strong></div><p style={{ ...MUTED_STYLE, gridColumn: '1/-1', margin: 0 }}>{armed ? 'Review is armed. Confirm to create one QuickBooks payment.' : 'Review the total, deposit account, reference, and invoice allocations before continuing.'}</p><div className="coll-receive-payment-actions" style={ACTIONS_STYLE}><GhostButton onClick={() => setArmed(false)} disabled={!armed || submitting}>Edit</GhostButton><PrimaryButton onBlur={() => { if (armed) setArmed(false); }} onClick={submit} disabled={submitting || !contact || !invoices.length}>{submitting ? 'Saving…' : armed ? `Confirm ${money(total)} payment` : 'Review payment'}</PrimaryButton></div></div>
  </CollCard>;
}
