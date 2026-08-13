/**
 * ════════════════════════════════════════════════
 * FILE: InvoicePaymentFlow.jsx  (Admin Mobile — pushed QBO invoice payment)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Guides an admin through receiving one already-known invoice payment: amount,
 *   method, then an intentionally two-tap confirmation. The parent owns loading
 *   the Worker options and submitting the protected request.
 *
 * DEPENDS ON:
 *   Packages: react
 *   Internal: ./invoiceMath, ./invoicePayment, collections/paymentAllocation,
 *             @/lib/toast
 *   Data: reads/writes → none directly
 *
 * NOTES / GOTCHAS:
 *   - Keep the one allocation and stable retry identity. A changed form is a
 *     new payment request; an unchanged ambiguous retry must keep its identity.
 *   - The footer is deliberately fixed through .am-pay-footer, not sticky.
 * ════════════════════════════════════════════════
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { err } from '@/lib/toast';
import { formatCompanyDate, todayInCompanyTimeZone } from '@/lib/companyDate';
import { impact, selection } from '@/lib/nativeHaptics';
import { cents, nextRequestIdentity, shouldDisarmReviewOnBlur } from '@/components/collections/paymentAllocation';
import { fmtMoney } from './invoiceMath';
import {
  RECEIVE_PAYMENT_DEPOSIT_KEY,
  buildInvoicePaymentPayload,
  chooseDepositAccountId,
  persistPendingInvoicePaymentIdentity,
  readPendingInvoicePaymentIdentity,
  validateInvoicePayment,
} from './invoicePayment';

const PAYER_TYPES = [['homeowner', 'Homeowner'], ['insurance', 'Insurance'], ['other', 'Other']];
const readRememberedDeposit = () => {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(RECEIVE_PAYMENT_DEPOSIT_KEY) || '' : ''; } catch { return ''; }
};
const rememberDeposit = (id) => {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(RECEIVE_PAYMENT_DEPOSIT_KEY, id); } catch { /* optional device preference */ }
};

function PaymentMethodIcon({ type }) {
  const props = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
  if (type === 'check') return <svg {...props}><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h6M6 14h9" /></svg>;
  if (type === 'cash') return <svg {...props}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /></svg>;
  if (type === 'credit_card') return <svg {...props}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>;
  return <svg {...props}><path d="M4 21V8l8-5 8 5v13" /><path d="M4 21h16M9 21v-6h6v6" /></svg>;
}

const reducedMotion = () => typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function motionToken(name) {
  if (typeof document === 'undefined') return null;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || null;
}

function baseMotionDuration() {
  const duration = Number.parseFloat(motionToken('--motion-duration-base'));
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

async function animateStepExit(node, direction) {
  if (!node?.animate || reducedMotion()) return;
  const duration = baseMotionDuration();
  const easing = motionToken('--motion-ease-accelerate');
  if (!duration || !easing) return;
  const to = direction === 'back' ? 18 : -18;
  const animation = node.animate(
    [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${to}px)` }],
    { duration: duration * 0.75, easing },
  );
  try { await animation.finished; } catch { /* route change or an interrupted transition */ }
}

// Hoisted so changing a step does not remount the animated node while it is entering.
function Step({ children, direction, title, headingId, stepRef }) {
  const headingRef = useRef(null);
  useEffect(() => {
    const node = stepRef.current;
    if (direction) headingRef.current?.focus();
    if (!node?.animate || !direction || reducedMotion()) return undefined;
    const from = direction === 'back' ? -18 : 18;
    const duration = baseMotionDuration();
    const easing = motionToken('--motion-ease-decelerate');
    if (!duration || !easing) return undefined;
    const animation = node.animate(
      [{ opacity: 0, transform: `translateX(${from}px)` }, { opacity: 1, transform: 'translateX(0)' }],
      { duration, easing },
    );
    return () => animation.cancel();
  }, [direction, stepRef]);
  return (
    <section ref={stepRef} className="am-pay-step" aria-labelledby={headingId}>
      <h2 ref={headingRef} id={headingId} className="am-pay-step-title" tabIndex={-1}>{title}</h2>
      {children}
    </section>
  );
}

function Footer({ label, amount, children }) {
  return (
    <div className="am-pay-footer">
      {label && <div className="am-pay-footer-total"><span>{label}</span><strong>{amount}</strong></div>}
      {children}
    </div>
  );
}

function AmountStep({ amount, balance, direction, stepRef, disabled, onAmount, onNext }) {
  const valid = cents(amount);
  const withinBalance = valid != null && valid <= Math.round(Number(balance || 0) * 100);
  const amountError = valid == null || valid <= 0 || !withinBalance;
  const amountErrorMessage = valid == null || valid <= 0
    ? 'Enter a payment amount greater than $0.00.'
    : 'Enter no more than the open balance.';
  return <Step direction={direction} title="Amount" headingId="invoice-payment-amount-title" stepRef={stepRef}>
    <div className="am-pay-card">
      <p className="am-pay-eyebrow">Amount to receive</p>
      <label className="am-inv-field" htmlFor="invoice-payment-amount">
        <span className="am-inv-field-label">Payment amount</span>
        <input id="invoice-payment-amount" name="payment_amount" autoComplete="off" className="am-inv-input am-inv-input--amount" inputMode="decimal"
          value={amount} onChange={(event) => onAmount(event.target.value)} placeholder="0.00" required
          aria-invalid={amountError || undefined}
          aria-describedby={`invoice-payment-amount-help${amountError ? ' invoice-payment-amount-error' : ''}`} disabled={disabled} />
      </label>
      <p id="invoice-payment-amount-help" className="am-pay-help">Open balance: {fmtMoney(balance)}</p>
      {amountError && <p id="invoice-payment-amount-error" className="am-pay-help am-pay-help--error" role="alert">{amountErrorMessage}</p>}
    </div>
    <Footer label="Amount received" amount={valid == null ? '—' : fmtMoney(valid / 100)}>
      <button type="button" className="am-inv-btn am-inv-btn--primary" disabled={disabled || !valid || valid <= 0 || !withinBalance} onClick={onNext}>Payment method</button>
    </Footer>
  </Step>;
}

function MethodStep({ methods, selectedMethodId, referenceNumber, referenceError, referenceInputRef, moreOpen, paymentDate, payerType, accounts, depositAccountId, amount, direction, stepRef, disabled, onMethod, onReference, onMore, onDate, onPayer, onDeposit, onNext }) {
  const method = methods.find((item) => String(item.id) === String(selectedMethodId));
  return <Step direction={direction} title="Payment method" headingId="invoice-payment-method-title" stepRef={stepRef}>
    <fieldset className="am-pay-card" disabled={disabled}><legend className="am-pay-eyebrow">Choose a method</legend>
      <div className="am-inv-chips" aria-label="Payment method">
        {methods.map((item) => <button key={item.id} type="button" className={`am-inv-chip-btn${String(item.id) === String(selectedMethodId) ? ' am-inv-chip-btn--active' : ''}`} aria-pressed={String(item.id) === String(selectedMethodId)} onClick={() => onMethod(item.id)}><PaymentMethodIcon type={item.type} /><span>{item.name || item.type}</span></button>)}
      </div>
      {method?.type === 'check' && <label className="am-inv-field" htmlFor="invoice-payment-reference"><span className="am-inv-field-label">Check number</span><input ref={referenceInputRef} id="invoice-payment-reference" name="check_number" autoComplete="off" className="am-inv-input" inputMode="numeric" value={referenceNumber} onChange={(event) => onReference(event.target.value)} required aria-invalid={Boolean(referenceError) || undefined} aria-describedby={referenceError ? 'invoice-payment-reference-error' : undefined} />{referenceError && <span id="invoice-payment-reference-error" className="am-pay-help am-pay-help--error" role="alert">{referenceError}</span>}</label>}
    </fieldset>
    <button type="button" className="am-pay-more" aria-expanded={moreOpen} aria-controls="invoice-payment-more-options" onClick={onMore} disabled={disabled}>More options — date, payer, deposit account</button>
    {moreOpen && <div id="invoice-payment-more-options" className="am-pay-card">
      <label className="am-inv-field" htmlFor="invoice-payment-date"><span className="am-inv-field-label">Payment date</span><input id="invoice-payment-date" name="payment_date" autoComplete="off" className="am-inv-input" type="date" value={paymentDate} onChange={(event) => onDate(event.target.value)} disabled={disabled} /></label>
      <fieldset className="am-inv-field" disabled={disabled}><legend className="am-inv-field-label">Paid by</legend><div className="am-inv-chips">{PAYER_TYPES.map(([value, label]) => <button key={value} type="button" className={`am-inv-chip-btn${payerType === value ? ' am-inv-chip-btn--active' : ''}`} aria-pressed={payerType === value} onClick={() => onPayer(value)}><span>{label}</span></button>)}</div></fieldset>
      <label className="am-inv-field" htmlFor="invoice-payment-deposit"><span className="am-inv-field-label">Deposit to</span><select id="invoice-payment-deposit" name="deposit_account" autoComplete="off" className="am-inv-input" value={depositAccountId} onChange={(event) => onDeposit(event.target.value)} disabled={disabled}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.account_type ? ` · ${account.account_type}` : ''}</option>)}</select></label>
    </div>}
    <Footer label="Amount received" amount={fmtMoney((cents(amount) || 0) / 100)}>
      <button type="button" className="am-inv-btn am-inv-btn--primary" disabled={disabled || !selectedMethodId} onClick={onNext}>Review payment</button>
    </Footer>
  </Step>;
}

function ConfirmStep({ invoice, contact, method, account, amount, paymentDate, referenceNumber, payerType, submitting, armed, direction, stepRef, onConfirm, onDisarm }) {
  const amountCents = cents(amount) || 0;
  return <Step direction={direction} title="Confirm payment" headingId="invoice-payment-confirm-title" stepRef={stepRef}>
    <div className="am-pay-confirm">
      <p className="am-pay-eyebrow">Amount received</p><strong className="am-pay-money">{fmtMoney(amountCents / 100)}</strong>
      <p>{contact?.name || 'Customer'} · {invoice.invoice_number || invoice.qbo_doc_number || 'Invoice'}</p>
    </div>
    <div className="am-pay-card am-pay-summary">
      <div><span>Method</span><strong>{method?.name || method?.type || '—'}{referenceNumber ? ` · #${referenceNumber}` : ''}</strong></div>
      <div><span>Date</span><strong>{formatCompanyDate(paymentDate)}</strong></div>
      <div><span>Payer</span><strong>{PAYER_TYPES.find(([value]) => value === payerType)?.[1] || payerType}</strong></div>
      <div><span>Deposit to</span><strong>{account?.name || '—'}</strong></div>
    </div>
    <Footer>
      <button type="button" className={`am-inv-btn am-inv-btn--primary${armed ? ' am-inv-btn--confirm' : ''}`} disabled={submitting} onBlur={(event) => { if (shouldDisarmReviewOnBlur(event.currentTarget.parentElement, event.relatedTarget)) onDisarm(); }} onClick={onConfirm}>{submitting ? 'Sending to QuickBooks…' : armed ? `Tap again to confirm ${fmtMoney(amountCents / 100)}` : `Confirm ${fmtMoney(amountCents / 100)} payment`}</button>
    </Footer>
  </Step>;
}

export default function InvoicePaymentFlow({ invoice, contact, paymentData, submitting, actorId, onBack, onSubmit }) {
  const [step, setStep] = useState('amount');
  const [direction, setDirection] = useState(null);
  const [amount, setAmount] = useState(() => ((invoice?.balance_cents || 0) / 100).toFixed(2));
  const [methodId, setMethodId] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayInCompanyTimeZone);
  const [payerType, setPayerType] = useState('homeowner');
  const [selectedDepositAccountId, setSelectedDepositAccountId] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [identity, setIdentity] = useState(null);
  const [referenceError, setReferenceError] = useState('');
  const [pending, setPending] = useState(false);
  const activeStepRef = useRef(null);
  const referenceInputRef = useRef(null);
  const transitioningRef = useRef(false);
  // State does not update until React has yielded. This ref closes the small
  // double-tap window between the first confirming click and that re-render.
  const submittingRef = useRef(false);
  // This component can stay mounted while its parent changes :invoiceId. A
  // payment prep or exit animation started for the old invoice must never
  // advance, disarm, or clear the new invoice's UI.
  const routeRef = useRef({ invoiceId: invoice?.id, epoch: 0, token: 0, activeToken: null });
  if (routeRef.current.invoiceId !== invoice?.id) {
    routeRef.current = {
      ...routeRef.current,
      invoiceId: invoice?.id,
      epoch: routeRef.current.epoch + 1,
      activeToken: null,
    };
    submittingRef.current = false;
    transitioningRef.current = false;
  }
  const busy = Boolean(submitting || pending);
  const accounts = useMemo(() => paymentData?.deposit_accounts || [], [paymentData]);
  const methods = paymentData?.payment_methods || [];
  const rememberedDepositAccountId = readRememberedDeposit();
  const depositAccountId = chooseDepositAccountId(accounts, selectedDepositAccountId, rememberedDepositAccountId);
  const method = methods.find((item) => String(item.id) === String(methodId));
  const account = accounts.find((item) => String(item.id) === String(depositAccountId));
  const disarm = () => { setArmed(false); setIdentity(null); };
  const edit = (setter) => (value) => { disarm(); setter(value); };

  useEffect(() => {
    // Each invoice starts as an independent payment draft. This also clears a
    // visible pending state left by an old route before it can mask the new one.
    setStep('amount');
    setDirection(null);
    setAmount(((invoice?.balance_cents || 0) / 100).toFixed(2));
    setMethodId('');
    setReferenceNumber('');
    setPaymentDate(todayInCompanyTimeZone());
    setPayerType('homeowner');
    setSelectedDepositAccountId('');
    setMoreOpen(false);
    setArmed(false);
    setIdentity(null);
    setReferenceError('');
    setPending(false);
  }, [invoice?.balance_cents, invoice?.id]);

  const payload = useMemo(() => buildInvoicePaymentPayload({ contactId: contact?.id, invoice, amount, paymentDate, payerType, method, referenceNumber, depositAccountId }), [contact?.id, invoice, amount, paymentDate, payerType, method, referenceNumber, depositAccountId]);
  const confirm = async () => {
    const message = validateInvoicePayment(payload, invoice);
    if (message) { err(message); return; }
    if (!armed) { impact('light'); setArmed(true); return; }
    if (submittingRef.current) return;
    const route = routeRef.current;
    const token = ++route.token;
    const routeEpoch = route.epoch;
    const isCurrentRoute = () => {
      const current = routeRef.current;
      return current.invoiceId === invoice?.id && current.epoch === routeEpoch && current.activeToken === token;
    };
    submittingRef.current = true;
    route.activeToken = token;
    impact('light');
    setPending(true);
    try {
      const restored = await readPendingInvoicePaymentIdentity({
        actorId, invoiceId: invoice?.id, payload,
      });
      if (!isCurrentRoute()) return;
      const stable = nextRequestIdentity(identity || restored, payload);
      await persistPendingInvoicePaymentIdentity({
        actorId, invoiceId: invoice?.id, payload, identity: stable,
      });
      if (!isCurrentRoute()) return;
      setIdentity(stable);
      rememberDeposit(depositAccountId);
      await onSubmit({ ...payload, client_request_id: stable.id });
    } catch (error) {
      if (!isCurrentRoute()) return;
      err(error?.message || 'Could not prepare a safe payment retry.');
    } finally {
      if (isCurrentRoute()) {
        submittingRef.current = false;
        routeRef.current.activeToken = null;
        setPending(false);
      }
    }
  };
  const go = async (next, nextDirection = 'forward') => {
    if (busy) return;
    if (transitioningRef.current) return;
    const route = routeRef.current;
    const routeEpoch = route.epoch;
    const isCurrentRoute = () => routeRef.current.invoiceId === invoice?.id && routeRef.current.epoch === routeEpoch;
    transitioningRef.current = true;
    disarm();
    impact('light');
    try {
      await animateStepExit(activeStepRef.current, nextDirection);
      if (!isCurrentRoute()) return;
      setDirection(nextDirection);
      setStep(next);
    } catch (error) {
      if (isCurrentRoute()) err(error?.message || 'Could not open the next payment step.');
    } finally {
      if (isCurrentRoute()) transitioningRef.current = false;
    }
  };
  const back = () => {
    if (busy || submittingRef.current) return;
    if (step === 'amount') {
      impact('light');
      return onBack();
    }
    void go(step === 'confirm' ? 'method' : 'amount', 'back');
  };
  const chooseMethod = (value) => {
    selection();
    setReferenceError('');
    edit(setMethodId)(value);
  };
  const changeReference = (value) => {
    setReferenceError('');
    edit(setReferenceNumber)(value);
  };
  const reviewPayment = () => {
    if (method?.type === 'check' && !referenceNumber.trim()) {
      setReferenceError('Enter the check number before reviewing this payment.');
      referenceInputRef.current?.focus();
      return;
    }
    setReferenceError('');
    void go('confirm');
  };

  return <div className="am-pay-flow" aria-busy={busy || undefined}>
    <div className="am-pay-progress" aria-label={`Step ${step === 'amount' ? 1 : step === 'method' ? 2 : 3} of 3`}>{step === 'amount' ? 'Amount' : step === 'method' ? 'Method' : 'Confirm'}</div>
    <button type="button" className="am-pay-back" onClick={back} disabled={busy}>Back</button>
    {step === 'amount' && <AmountStep amount={amount} balance={(invoice?.balance_cents || 0) / 100} direction={direction} stepRef={activeStepRef} disabled={busy} onAmount={(value) => { if (!busy && (value === '' || cents(value) != null)) edit(setAmount)(value); }} onNext={() => { void go('method'); }} />}
    {step === 'method' && <MethodStep methods={methods} selectedMethodId={methodId} referenceNumber={referenceNumber} referenceError={referenceError} referenceInputRef={referenceInputRef} moreOpen={moreOpen} paymentDate={paymentDate} payerType={payerType} accounts={accounts} depositAccountId={depositAccountId} amount={amount} direction={direction} stepRef={activeStepRef} disabled={busy} onMethod={chooseMethod} onReference={changeReference} onMore={() => { if (busy) return; impact('light'); disarm(); setMoreOpen((open) => !open); }} onDate={(value) => { if (busy) return; selection(); edit(setPaymentDate)(value); }} onPayer={(value) => { if (busy) return; selection(); edit(setPayerType)(value); }} onDeposit={(value) => { if (busy) return; selection(); edit(setSelectedDepositAccountId)(value); }} onNext={reviewPayment} />}
    {step === 'confirm' && <ConfirmStep invoice={invoice} contact={contact} method={method} account={account} amount={amount} paymentDate={paymentDate} referenceNumber={referenceNumber} payerType={payerType} submitting={busy} armed={armed} direction={direction} stepRef={activeStepRef} onConfirm={confirm} onDisarm={disarm} />}
  </div>;
}
