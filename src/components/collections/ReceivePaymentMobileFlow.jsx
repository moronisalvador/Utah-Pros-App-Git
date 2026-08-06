/**
 * ════════════════════════════════════════════════
 * FILE: ReceivePaymentMobileFlow.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The phone version of Receive Payment: one decision per screen, like a
 *   point-of-sale app. Pick who paid, tap the invoices they paid, tap how they
 *   paid, confirm. The running total stays pinned at the bottom the whole way.
 *   Date, payer, and deposit account are sensible defaults tucked behind
 *   "More options" instead of required dropdowns.
 *
 * WHERE IT LIVES:
 *   Route:        /collections/receive-payment (native build, or web ≤768px)
 *   Rendered by:  src/pages/ReceivePayment.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  collTokens, paymentAllocation, toast, companyDate, TabLoading,
 *              ErrorState
 *   Data:      reads  → none (the page owns fetching)
 *              writes → none (the page owns submit)
 *
 * NOTES / GOTCHAS:
 *   - Amounts remain integer cents until the protected server receives them.
 *   - The confirm button keeps the two-tap money gate; any step change disarms.
 *   - Step slide is WAAPI (index.css is ~89 bytes under its CI byte ceiling);
 *     prefers-reduced-motion collapses it to instant.
 *   - The deposit-account default remembers the last account used on this
 *     device (localStorage) — the field crew almost always deposits to the
 *     same operating account.
 * ════════════════════════════════════════════════
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { C, STATUS } from './collTokens';
import { allocationTotal, cents, money, nextRequestIdentity, toggleAllocationFill, validateReceipt } from './paymentAllocation';
import { err } from '@/lib/toast';
import { todayInCompanyTimeZone } from '@/lib/companyDate';
import TabLoading from '@/components/TabLoading';
import ErrorState from '@/components/ui/ErrorState';

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
const lossDate = (value) => {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return `Loss ${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}/${String(parsed.getUTCFullYear()).slice(2)}`;
};
const DEPOSIT_MEMORY_KEY = 'upr:receive-payment:deposit-account';
const readRememberedDeposit = () => {
  try { return localStorage.getItem(DEPOSIT_MEMORY_KEY) || ''; } catch { return ''; }
};
const rememberDeposit = (id) => {
  try { localStorage.setItem(DEPOSIT_MEMORY_KEY, String(id || '')); } catch { /* private mode */ }
};
const reducedMotion = () => typeof matchMedia !== 'undefined'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ─── SECTION: Styles (inline: the CSS file is at its byte ceiling) ──────────
const PAGE_STYLE = {
  display: 'flex', flexDirection: 'column', minHeight: '100dvh',
  background: C.pageBg, color: C.body,
};
const TOP_BAR_STYLE = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '10px 8px',
  position: 'sticky', top: 0, zIndex: 20, background: C.pageBg,
};
const BACK_BTN_STYLE = {
  minWidth: 48, minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
  border: 0, background: 'none', color: C.ink, cursor: 'pointer', borderRadius: 12,
};
const TITLE_WRAP_STYLE = { display: 'flex', flexDirection: 'column', minWidth: 0 };
const TITLE_STYLE = { color: C.ink, fontSize: 17, fontWeight: 800, lineHeight: 1.2 };
const SUBTITLE_STYLE = { color: C.muted, fontSize: 12, fontWeight: 600 };
const BODY_WRAP_STYLE = { flex: 1, display: 'flex', flexDirection: 'column', padding: '0 12px', overflowX: 'clip' };
// Steps that carry the fixed footer pad their body so the last row can always
// scroll clear of it (footer ≈ 130px + breathing room).
const BODY_WRAP_PADDED_STYLE = { ...BODY_WRAP_STYLE, paddingBottom: 180 };
const SEARCH_STYLE = {
  minHeight: 48, fontSize: 16, border: `1px solid ${C.cardBorder}`, borderRadius: 12,
  background: C.cardBg, color: C.ink, padding: '0 14px', width: '100%',
};
const LIST_CARD_STYLE = {
  background: C.cardBg, border: `1px solid ${C.cardBorder}`, borderRadius: 14,
  marginTop: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column',
};
const ROW_STYLE = {
  minHeight: 56, display: 'flex', alignItems: 'center', gap: 12, width: '100%',
  padding: '8px 14px', border: 0, borderBottom: `1px solid ${C.hairline}`,
  background: 'none', textAlign: 'left', font: 'inherit', color: C.ink,
  fontSize: 16, fontWeight: 600, cursor: 'pointer',
};
const ROW_SUB_STYLE = { color: C.muted, fontSize: 13, fontWeight: 500 };
const INVOICE_AMOUNT_INPUT_STYLE = {
  minHeight: 44, width: 110, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
  fontSize: 16, fontWeight: 700, color: C.ink, background: C.cardBg,
  border: `1px solid ${C.cardBorder}`, borderRadius: 10, padding: '0 10px',
};
// Fixed above the tech tab bar, exactly like the Dash FAB positions itself;
// in the office shell --tech-nav-height is undefined and falls back to 0, so
// the footer sits at the viewport bottom there. (An earlier position:sticky
// version floated mid-list inside the tech shell's scroll context — owner
// screenshot 2026-08-06.)
const FOOTER_STYLE = {
  position: 'fixed', left: 0, right: 0, zIndex: 20,
  bottom: 'calc(var(--tech-nav-height, 0px) + env(safe-area-inset-bottom, 0px))',
  padding: '10px 12px 12px',
  background: C.pageBg, boxShadow: '0 -6px 16px rgba(16, 24, 40, 0.06)',
  display: 'flex', flexDirection: 'column', gap: 8,
};
const FOOTER_TOTAL_STYLE = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' };
const FOOTER_LABEL_STYLE = { color: C.muted, fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' };
const FOOTER_VALUE_STYLE = { color: C.ink, fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' };
const PRIMARY_BTN_STYLE = {
  minHeight: 52, borderRadius: 14, border: 0, background: STATUS.info.solid, color: '#fff',
  fontSize: 17, fontWeight: 800, cursor: 'pointer', width: '100%',
};
const PRIMARY_DISABLED_STYLE = { ...PRIMARY_BTN_STYLE, background: C.faint2, cursor: 'default' };
const ARMED_BTN_STYLE = { ...PRIMARY_BTN_STYLE, background: STATUS.success.solid };
const GHOST_BTN_STYLE = {
  minHeight: 44, borderRadius: 12, border: `1px solid ${C.cardBorder}`, background: C.cardBg,
  color: C.ink, fontSize: 14, fontWeight: 700, cursor: 'pointer', padding: '0 14px',
};
const SUMMARY_ROW_STYLE = {
  display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 14px',
  borderBottom: `1px solid ${C.hairline}`, fontSize: 15,
};
const MORE_TOGGLE_STYLE = {
  minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  width: '100%', border: 0, background: 'none', color: C.muted, fontSize: 14,
  fontWeight: 700, cursor: 'pointer', padding: '0 4px', marginTop: 14,
};
const FIELD_LABEL_STYLE = { color: C.body, fontSize: 12, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 6 };
const FIELD_STYLE = {
  minHeight: 44, border: `1px solid ${C.cardBorder}`, borderRadius: 10,
  background: C.cardBg, color: C.ink, padding: '0 12px', fontSize: 16,
};
const SEGMENT_WRAP_STYLE = { display: 'flex', gap: 8 };
const CHECK_FIELD_WRAP_STYLE = { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 };

function Chevron({ direction = 'left' }) {
  const d = direction === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6';
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}
function CheckDot({ on }) {
  return on
    ? <svg width="22" height="22" viewBox="0 0 18 18" aria-hidden="true" style={{ flexShrink: 0 }}><circle cx="9" cy="9" r="8" fill={STATUS.info.solid} /><path d="M5.2 9.3l2.4 2.4 5-5" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    : <svg width="22" height="22" viewBox="0 0 18 18" aria-hidden="true" style={{ flexShrink: 0 }}><circle cx="9" cy="9" r="8" fill="none" stroke={C.faint2} strokeWidth="1.5" /></svg>;
}
// One consistent 22px stroke set — never emoji (craft floor).
function MethodIcon({ type }) {
  const props = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { flexShrink: 0, color: C.muted } };
  if (type === 'check') return <svg {...props}><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h6M6 14h9" /></svg>;
  if (type === 'cash') return <svg {...props}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /><path d="M5 9h.01M19 15h.01" /></svg>;
  if (type === 'credit_card') return <svg {...props}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>;
  return <svg {...props}><path d="M4 21V8l8-5 8 5v13" /><path d="M4 21h16M9 21v-6h6v6" /></svg>;
}

// ─── SECTION: Step shell (slide-in via WAAPI) ──────────
function Step({ children, direction }) {
  const ref = useRef(null);
  useEffect(() => {
    if (reducedMotion() || !ref.current || !direction) return;
    const from = direction === 'forward' ? 24 : -24;
    ref.current.animate(
      [{ opacity: 0, transform: `translateX(${from}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 200, easing: 'cubic-bezier(0, 0, 0, 1)' },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={ref} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>{children}</div>;
}

export default function ReceivePaymentMobileFlow({
  contacts, data, prefillInvoice, invoicesLoading, invoicesError,
  onRetryInvoices, onSelectContact, onClearContact, onSubmit, onExit, submitting,
}) {
  const contact = data?.contact || null;
  const [step, setStep] = useState(contact ? 'invoices' : 'customer');
  const [direction, setDirection] = useState(null);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(null);
  const [allocationInputs, setAllocationInputs] = useState({});
  const [methodId, setMethodId] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [payerType, setPayerType] = useState('homeowner');
  const [paymentDate, setPaymentDate] = useState(todayInCompanyTimeZone);
  const [depositAccountId, setDepositAccountId] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [identity, setIdentity] = useState(null);
  const contactKey = contact?.id || '';

  const go = (next, dir) => { setArmed(false); setDirection(dir); setStep(next); };

  // A fresh customer resets the sheet; a deep-linked invoice arrives filled.
  useEffect(() => {
    const target = prefillInvoice && (data?.invoices || []).find((row) => row.id === prefillInvoice);
    setAllocationInputs(target ? { [target.id]: (target.balance_cents / 100).toFixed(2) } : {});
    setMethodId(''); setReferenceNumber(''); setArmed(false); setIdentity(null);
    if (contactKey) setStep((current) => (current === 'customer' ? 'invoices' : current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactKey]);

  // Default the deposit account: last used on this device, else first bank.
  useEffect(() => {
    const accounts = data?.deposit_accounts || [];
    if (!accounts.length) return;
    setDepositAccountId((current) => {
      if (current && accounts.some((account) => account.id === current)) return current;
      const remembered = readRememberedDeposit();
      if (remembered && accounts.some((account) => account.id === remembered)) return remembered;
      return (accounts.find((account) => account.account_type === 'Bank') || accounts[0]).id;
    });
  }, [data]);

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = contacts || [];
    return query ? rows.filter((row) => String(row.name || '').toLowerCase().includes(query)) : rows;
  }, [contacts, search]);
  const invoices = data?.invoices || [];
  const allocations = useMemo(() => Object.entries(allocationInputs)
    .map(([invoice_id, value]) => ({ invoice_id, amount_cents: cents(value) }))
    .filter((item) => Number(item.amount_cents) > 0), [allocationInputs]);
  const total = allocationTotal(allocations);
  const method = (data?.payment_methods || []).find((item) => item.id === methodId);
  const account = (data?.deposit_accounts || []).find((item) => item.id === depositAccountId);
  const activeCustomer = contact || picked;

  const payload = {
    contact_id: contactKey, payment_date: paymentDate, payer_type: payerType,
    payment_method: method?.type || method?.name || '', qbo_payment_method_id: methodId || null,
    reference_number: referenceNumber.trim() || null, deposit_account_id: depositAccountId,
    allocations,
  };
  const confirm = async () => {
    const message = validateReceipt({ contactId: contactKey, paymentDate, paymentMethod: payload.payment_method, referenceNumber, depositAccountId, allocations });
    if (message) return err(message);
    const overBalance = allocations.find((allocation) => {
      const invoice = invoices.find((item) => item.id === allocation.invoice_id);
      return !invoice || allocation.amount_cents > invoice.balance_cents;
    });
    if (overBalance) return err('An allocation is greater than the current open invoice balance.');
    if (!armed) return setArmed(true);
    const stable = nextRequestIdentity(identity, payload);
    setIdentity(stable);
    rememberDeposit(depositAccountId);
    try {
      await onSubmit({ ...payload, client_request_id: stable.id });
    } catch (error) {
      err(error?.message || 'Could not receive payment.');
    }
  };

  const stepTitle = {
    customer: 'Who paid?',
    invoices: 'What did they pay?',
    method: 'How did they pay?',
    confirm: 'Confirm payment',
  }[step];
  const back = () => {
    if (step === 'customer') return onExit?.();
    if (step === 'invoices') { setPicked(null); setSearch(''); onClearContact?.(); return go('customer', 'back'); }
    if (step === 'method') return go('invoices', 'back');
    return go('method', 'back');
  };

  return <div className="coll-receive-payment-mobile" style={PAGE_STYLE}>
    <div style={TOP_BAR_STYLE}>
      <button type="button" style={BACK_BTN_STYLE} onClick={back} aria-label="Back"><Chevron /></button>
      <div style={TITLE_WRAP_STYLE}>
        <span style={TITLE_STYLE}>{stepTitle}</span>
        {activeCustomer && step !== 'customer' && <span style={SUBTITLE_STYLE}>{activeCustomer.name || activeCustomer.display_name}</span>}
      </div>
    </div>

    {step === 'customer' && <Step key="customer" direction={direction}>
      <div style={BODY_WRAP_STYLE}>
        <input
          style={SEARCH_STYLE} placeholder={`Search ${(contacts || []).length || ''} customers…`}
          value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers"
        />
        <div style={{ ...LIST_CARD_STYLE, marginBottom: 12 }}>
          {matches.length === 0
            ? <p style={{ ...ROW_SUB_STYLE, margin: 0, padding: 16 }}>No customers match “{search}”.</p>
            : matches.slice(0, 60).map((row, index, shown) => (
              <button type="button" key={row.id} style={{ ...ROW_STYLE, borderBottomWidth: index === shown.length - 1 ? 0 : 1 }}
                onClick={() => { setPicked(row); onSelectContact?.(row.id); go('invoices', 'forward'); }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name || row.display_name || row.id}</span>
                <Chevron direction="right" />
              </button>
            ))}
          {matches.length > 60 && <p style={{ ...ROW_SUB_STYLE, margin: 0, padding: 12 }}>{matches.length - 60} more — keep typing to narrow.</p>}
        </div>
      </div>
    </Step>}

    {step === 'invoices' && <Step key="invoices" direction={direction}>
      <div style={BODY_WRAP_PADDED_STYLE}>
        {invoicesLoading ? <TabLoading />
          : invoicesError ? <ErrorState message={invoicesError} onRetry={onRetryInvoices} />
            : invoices.length === 0 ? <ErrorStateFreeEmpty onBack={back} />
              : <div style={LIST_CARD_STYLE}>
                {invoices.map((invoice, index) => {
                  const value = allocationInputs[invoice.id] ?? '';
                  const on = Number(cents(value) || 0) > 0;
                  const context = [divisionLabel(invoice.job_division), invoice.job_address, lossDate(invoice.date_of_loss)].filter(Boolean).join(' · ');
                  const rowName = invoice.job_number || invoice.invoice_number || 'Invoice';
                  return <div key={invoice.id} style={{ background: on ? STATUS.info.tint : 'transparent', borderBottom: index === invoices.length - 1 ? 'none' : `1px solid ${C.hairline}` }}>
                    <button type="button" style={{ ...ROW_STYLE, borderBottom: 'none' }} aria-pressed={on}
                      onClick={() => { setArmed(false); setIdentity(null); setAllocationInputs((items) => ({ ...items, [invoice.id]: toggleAllocationFill(items[invoice.id], invoice.balance_cents) })); }}>
                      <CheckDot on={on} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block' }}>{rowName}</span>
                        {context && <span style={ROW_SUB_STYLE}>{context}</span>}
                      </span>
                      <span style={{ color: on ? STATUS.info.text : C.ink, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{money(invoice.balance_cents)}</span>
                    </button>
                    {on && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '0 14px 12px' }}>
                      <span style={ROW_SUB_STYLE}>Applying</span>
                      <input style={INVOICE_AMOUNT_INPUT_STYLE} inputMode="decimal" value={value} aria-label={`Allocation for ${rowName}`}
                        onChange={(e) => { const next = e.target.value; if (next === '' || cents(next) != null) { setArmed(false); setIdentity(null); setAllocationInputs((items) => ({ ...items, [invoice.id]: next })); } }} />
                    </div>}
                  </div>;
                })}
              </div>}
      </div>
      <div style={FOOTER_STYLE}>
        <div style={FOOTER_TOTAL_STYLE}>
          <span style={FOOTER_LABEL_STYLE}>Amount received</span>
          <span style={FOOTER_VALUE_STYLE}>{money(total)}</span>
        </div>
        <button type="button" style={total > 0 ? PRIMARY_BTN_STYLE : PRIMARY_DISABLED_STYLE} disabled={total <= 0}
          onClick={() => go('method', 'forward')}>
          {total > 0 ? 'Next — how did they pay?' : 'Tap an invoice to apply it'}
        </button>
      </div>
    </Step>}

    {step === 'method' && <Step key="method" direction={direction}>
      <div style={BODY_WRAP_PADDED_STYLE}>
        <div style={LIST_CARD_STYLE}>
          {(data?.payment_methods || []).map((item, index, rows) => {
            const on = item.id === methodId;
            return <div key={item.id} style={{ background: on ? STATUS.info.tint : 'transparent', borderBottom: index === rows.length - 1 && !(on && item.type === 'check') ? 'none' : `1px solid ${C.hairline}` }}>
              <button type="button" style={{ ...ROW_STYLE, borderBottom: 'none' }} aria-pressed={on}
                onClick={() => {
                  setArmed(false); setIdentity(null); setMethodId(item.id);
                  if (item.type !== 'check') go('confirm', 'forward');
                }}>
                <MethodIcon type={item.type} />
                <span style={{ flex: 1 }}>{item.name}</span>
                <CheckDot on={on} />
              </button>
              {on && item.type === 'check' && <div style={CHECK_FIELD_WRAP_STYLE}>
                <label style={FIELD_LABEL_STYLE}>Check number
                  <input style={FIELD_STYLE} inputMode="numeric" value={referenceNumber} placeholder="1234"
                    onChange={(e) => { setArmed(false); setReferenceNumber(e.target.value); }} />
                </label>
              </div>}
            </div>;
          })}
        </div>
        <button type="button" style={MORE_TOGGLE_STYLE} onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}>
          More options — date, payer, deposit account
          <span style={{ transform: moreOpen ? 'rotate(90deg)' : 'none', display: 'inline-flex' }}><Chevron direction="right" /></span>
        </button>
        {moreOpen && <div style={{ ...LIST_CARD_STYLE, padding: 14, gap: 12 }}>
          <label style={FIELD_LABEL_STYLE}>Payment date
            <input style={FIELD_STYLE} type="date" value={paymentDate} onChange={(e) => { setArmed(false); setPaymentDate(e.target.value); }} />
          </label>
          <div style={FIELD_LABEL_STYLE}>Paid by
            <div style={SEGMENT_WRAP_STYLE}>
              {[['homeowner', 'Homeowner'], ['insurance', 'Insurance'], ['other', 'Other']].map(([id, label]) => (
                <button type="button" key={id} style={{ ...GHOST_BTN_STYLE, flex: 1, ...(payerType === id ? { borderColor: STATUS.info.solid, color: STATUS.info.text, background: STATUS.info.tint } : {}) }}
                  aria-pressed={payerType === id} onClick={() => { setArmed(false); setPayerType(id); }}>{label}</button>
              ))}
            </div>
          </div>
          <label style={FIELD_LABEL_STYLE}>Deposit to
            <select style={FIELD_STYLE} value={depositAccountId} onChange={(e) => { setArmed(false); setDepositAccountId(e.target.value); }}>
              {(data?.deposit_accounts || []).map((row) => <option key={row.id} value={row.id}>{row.name}{row.account_type ? ` · ${row.account_type}` : ''}</option>)}
            </select>
          </label>
        </div>}
      </div>
      <div style={FOOTER_STYLE}>
        <div style={FOOTER_TOTAL_STYLE}>
          <span style={FOOTER_LABEL_STYLE}>Amount received</span>
          <span style={FOOTER_VALUE_STYLE}>{money(total)}</span>
        </div>
        <button type="button" style={methodId ? PRIMARY_BTN_STYLE : PRIMARY_DISABLED_STYLE} disabled={!methodId}
          onClick={() => go('confirm', 'forward')}>
          {methodId ? 'Review payment' : 'Tap how they paid'}
        </button>
      </div>
    </Step>}

    {step === 'confirm' && <Step key="confirm" direction={direction}>
      <div style={BODY_WRAP_PADDED_STYLE}>
        <div style={{ textAlign: 'center', padding: '18px 0 6px' }}>
          <div style={FOOTER_LABEL_STYLE}>Amount received</div>
          <div style={{ ...FOOTER_VALUE_STYLE, fontSize: 40 }}>{money(total)}</div>
          <div style={ROW_SUB_STYLE}>from {activeCustomer?.name || 'customer'}</div>
        </div>
        <div style={LIST_CARD_STYLE}>
          {allocations.map((allocation) => {
            const invoice = invoices.find((item) => item.id === allocation.invoice_id);
            return <div key={allocation.invoice_id} style={SUMMARY_ROW_STYLE}>
              <span>{invoice?.job_number || invoice?.invoice_number || 'Invoice'}</span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{money(allocation.amount_cents)}</strong>
            </div>;
          })}
          <div style={SUMMARY_ROW_STYLE}><span>Method</span><strong>{method?.name || '—'}{referenceNumber ? ` · #${referenceNumber}` : ''}</strong></div>
          <div style={SUMMARY_ROW_STYLE}><span>Date</span><strong>{paymentDate}</strong></div>
          <div style={{ ...SUMMARY_ROW_STYLE, borderBottom: 'none' }}><span>Deposit to</span><strong>{account?.name || '—'}</strong></div>
        </div>
      </div>
      <div style={FOOTER_STYLE}>
        <button type="button" style={submitting ? PRIMARY_DISABLED_STYLE : armed ? ARMED_BTN_STYLE : PRIMARY_BTN_STYLE}
          disabled={submitting} onBlur={() => setArmed(false)} onClick={confirm}>
          {submitting ? 'Sending to QuickBooks…' : armed ? `Tap again to confirm ${money(total)}` : `Confirm ${money(total)} payment`}
        </button>
      </div>
    </Step>}
  </div>;
}

// Empty state for a customer with nothing open — a dead end must offer a way
// back (loading-error-states §5).
function ErrorStateFreeEmpty({ onBack }) {
  return <div style={{ textAlign: 'center', padding: '40px 16px', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
    <p style={{ color: C.body, fontWeight: 700, margin: 0 }}>No open invoices</p>
    <p style={{ color: C.muted, margin: 0, fontSize: 14 }}>This customer has no open QuickBooks-linked invoices to receive a payment against.</p>
    <button type="button" style={GHOST_BTN_STYLE} onClick={onBack}>Pick another customer</button>
  </div>;
}
