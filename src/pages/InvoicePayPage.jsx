/**
 * ════════════════════════════════════════════════
 * FILE: InvoicePayPage.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The page a customer lands on when they follow the payment link in their
 *   invoice email. It shows what the work was, what is still owed, what they
 *   have already paid, and lets them pay all or part of the balance by card or
 *   bank transfer.
 *
 * WHERE IT LIVES:
 *   Route:        /pay/:token   (public — no login)
 *   Rendered by:  src/App.jsx, in the public block outside ProtectedRoute/Layout
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/lib/supabase (the unauthenticated bootstrapping client)
 *   Data:      reads  → get_invoice_by_share_token RPC
 *              writes → none from the browser; paying POSTs to a worker
 *
 * NOTES / GOTCHAS:
 *   - This renders OUTSIDE both app shells, so it has its own palette in raw hex
 *     and must not use design tokens that re-tone with the tech dark theme.
 *   - **There is no toast container out here.** A toast() call would be
 *     swallowed silently, so every error renders inline. This is a real trap
 *     that SignPage.jsx documents too.
 *   - No useAuth. The customer has no session and never will.
 *   - The browser NEVER writes. Paying POSTs to /api/invoice-pay-session, which
 *     re-checks the token, the status, the expiry and the amount server-side.
 * ════════════════════════════════════════════════
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
// This page is PUBLIC: the customer has no session, so `const { db } = useAuth()`
// is not available to it. The unauthenticated singleton is the sanctioned
// bootstrapping exception (CLAUDE.md Rule 3), and it is preferred over
// SignPage's hand-rolled fetch because it brings the shared timeout,
// retry-on-network-error and error shape.
// eslint-disable-next-line no-restricted-imports
import { db } from '@/lib/supabase';

// ─── SECTION: Palette ──────────────
// Raw hex on purpose — see the header note about rendering outside both shells.
const C = {
  ink: '#101828',
  body: '#344054',
  muted: '#667085',
  faint: '#98a2b3',
  hairline: '#eaecf0',
  border: '#d0d5dd',
  bg: '#f7f8fa',
  card: '#ffffff',
  navy: '#1e293b',
  accent: '#2563eb',
  accentPress: '#1d4ed8',
  good: '#067647',
  goodBg: '#ecfdf3',
  warnBg: '#fffaeb',
  warn: '#b54708',
  danger: '#b42318',
  dangerBg: '#fef3f2',
};

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

/**
 * Format a date for the customer.
 *
 * `invoice_date`, `due_date` and `payment_date` are DATE columns — no time, no
 * zone. `new Date('2026-09-13')` parses that as UTC midnight, and rendering it
 * in Mountain time then shows Sep 12. Every date on this page was a day early
 * until this was fixed. So a bare YYYY-MM-DD is built as a LOCAL date; anything
 * carrying a time is left alone.
 */
const prettyDate = (value) => {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const d = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// ─── SECTION: Small presentational pieces ──────────────

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100dvh', background: C.bg, padding: '24px 16px 64px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 18, padding: '0 4px' }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: C.ink }}>Utah Pros Restoration</span>
          <span style={{ fontSize: 12.5, color: C.muted }}>Invoice</span>
        </div>
        {children}
        <div style={{ marginTop: 22, padding: '0 4px', fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>
          Questions about this invoice? Call{' '}
          <a href="tel:+18014270582" style={{ color: C.accent, fontWeight: 600 }}>(801) 427-0582</a>
          {' '}or email{' '}
          <a href="mailto:restoration@utah-pros.com" style={{ color: C.accent, fontWeight: 600 }}>
            restoration@utah-pros.com
          </a>.
        </div>
      </div>
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
      padding: '22px 22px 24px', boxShadow: '0 1px 2px rgba(16,24,40,.05)', ...style,
    }}>
      {children}
    </div>
  );
}

/** A whole-page message for a link that cannot be paid. */
function Notice({ tone = 'muted', title, children }) {
  const tones = {
    good: { bg: C.goodBg, fg: C.good },
    warn: { bg: C.warnBg, fg: C.warn },
    danger: { bg: C.dangerBg, fg: C.danger },
    muted: { bg: C.bg, fg: C.body },
  };
  const t = tones[tone] || tones.muted;
  return (
    <Card>
      <div style={{
        display: 'inline-block', padding: '5px 11px', borderRadius: 999,
        background: t.bg, color: t.fg, fontSize: 12.5, fontWeight: 700, marginBottom: 12,
      }}>
        {title}
      </div>
      <div style={{ fontSize: 14.5, color: C.body, lineHeight: 1.65 }}>{children}</div>
    </Card>
  );
}

// ─── SECTION: Page ──────────────

export default function InvoicePayPage() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const justPaid = searchParams.get('paid') === '1';

  // Derived, not set in an effect: a missing token is knowable at first render.
  const [state, setState] = useState(token ? 'loading' : 'notfound'); // loading | ready | notfound | error
  const [data, setData] = useState(null);
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState('');

  // ─── SECTION: Data fetching ──────────────
  // One async effect with a cancellation flag rather than a useCallback the
  // effect calls. Two reasons: it keeps every setState off the synchronous
  // effect path (react-hooks/set-state-in-effect), and it fixes a real race —
  // if the token changed mid-flight, a stale response could otherwise land on
  // top of newer state.
  useEffect(() => {
    if (!token) return undefined; // already 'notfound' from the initial state
    let cancelled = false;

    (async () => {
      try {
        const result = await db.rpc('get_invoice_by_share_token', { p_token: token });
        if (cancelled) return;
        const row = Array.isArray(result) ? result[0] : result;
        if (!row) { setState('notfound'); return; }
        setData(row);
        // Default the amount to the full balance here rather than in a second
        // effect: paying in full is the common case, and someone paying in
        // stages can just edit it.
        const due = Number(row.balance_due ?? 0);
        if (row.actionable && due > 0) setAmount(due.toFixed(2));
        setState('ready');
      } catch {
        // Inline, never a toast — there is no toast container out here.
        if (!cancelled) setState('error');
      }
    })();

    return () => { cancelled = true; };
  }, [token]);

  const balance = Number(data?.balance_due ?? 0);

  const amountCents = useMemo(() => {
    const parsed = Number.parseFloat(String(amount).replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(parsed)) return NaN;
    return Math.round(parsed * 100);
  }, [amount]);

  const balanceCents = Math.round(balance * 100);
  const amountValid = Number.isSafeInteger(amountCents)
    && amountCents >= 50
    && amountCents <= balanceCents;

  // ─── SECTION: Event handlers ──────────────
  const pay = async () => {
    if (!amountValid || submitting) return;
    setSubmitting(true);
    setPayError('');
    try {
      const res = await fetch('/api/invoice-pay-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, amount_cents: amountCents }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.url) {
        setPayError(payload?.error || 'We could not start the payment. Please try again.');
        setSubmitting(false);
        return;
      }
      // Hand off to Stripe. Deliberately a full navigation, not a popup: a
      // blocked popup would look like a broken button.
      window.location.assign(payload.url);
    } catch {
      setPayError('We could not reach the payment service. Please check your connection and try again.');
      setSubmitting(false);
    }
  };

  // ─── SECTION: Render ──────────────

  if (state === 'loading') {
    return (
      <Shell>
        <Card><div style={{ color: C.muted, fontSize: 14.5 }}>Loading your invoice…</div></Card>
      </Shell>
    );
  }

  if (state === 'error') {
    return (
      <Shell>
        <Notice tone="danger" title="Something went wrong">
          We could not load this invoice just now. Please refresh the page, or contact our office
          and we will help straight away.
        </Notice>
      </Shell>
    );
  }

  if (state === 'notfound') {
    return (
      <Shell>
        <Notice tone="muted" title="Link not found">
          We could not find this payment link. It may have been mistyped, or it may belong to an
          older email. Contact our office and we will send you a fresh one.
        </Notice>
      </Shell>
    );
  }

  // The link resolved but can no longer be paid. The server deliberately still
  // answers for these so we can say WHICH it is instead of "not found".
  if (!data.actionable) {
    const invoiceLabel = data.invoice_number ? ` for invoice ${data.invoice_number}` : '';
    if (data.invoice_status === 'paid') {
      return (
        <Shell>
          <Notice tone="good" title="Paid in full">
            Thank you — this invoice{invoiceLabel} is paid in full. Nothing further is owed.
          </Notice>
        </Shell>
      );
    }
    if (data.status === 'revoked' || data.status === 'superseded') {
      return (
        <Shell>
          <Notice tone="warn" title="Link replaced">
            This payment link{invoiceLabel} has been replaced by a newer one. Please use the most
            recent email we sent you, or contact our office for a fresh link.
          </Notice>
        </Shell>
      );
    }
    return (
      <Shell>
        <Notice tone="warn" title="Link expired">
          This payment link{invoiceLabel} has expired. Contact our office and we will send you a
          new one right away.
        </Notice>
      </Shell>
    );
  }

  const lines = Array.isArray(data.lines) ? data.lines : [];
  const payments = Array.isArray(data.payments) ? data.payments : [];
  const total = Number(data.total || 0);
  const paid = Number(data.amount_paid || 0);
  const due = prettyDate(data.due_date);

  return (
    <Shell>
      {justPaid && (
        <div style={{
          marginBottom: 16, padding: '13px 16px', borderRadius: 12,
          background: C.goodBg, border: `1px solid #abefc6`, color: C.good,
          fontSize: 14, fontWeight: 600, lineHeight: 1.55,
        }} role="status">
          Thank you — your payment is on its way. Bank transfers can take a few business days to
          clear, so the balance below may not update immediately.
        </div>
      )}

      <Card>
        {/* Header: who, what, how much */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', color: C.faint, textTransform: 'uppercase' }}>
              Invoice {data.invoice_number || ''}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginTop: 5 }}>
              {data.customer_name || ''}
            </div>
            {(data.job_address || data.job_city) && (
              <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                {[data.job_address, data.job_city, data.job_state].filter(Boolean).join(', ')}
              </div>
            )}
            {data.claim_number && (
              <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>
                Claim {data.claim_number}
                {data.insurance_carrier ? ` · ${data.insurance_carrier}` : ''}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', color: C.faint, textTransform: 'uppercase' }}>
              Balance due
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, color: C.ink, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
              {money(balance)}
            </div>
            {due && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Due {due}</div>}
          </div>
        </div>

        {/* What the work was */}
        {lines.length > 0 && (
          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', color: C.faint, textTransform: 'uppercase', marginBottom: 8 }}>
              Work performed
            </div>
            {lines.map((line, i) => (
              <div
                key={`${line.description}-${i}`}
                style={{
                  display: 'flex', justifyContent: 'space-between', gap: 14,
                  padding: '10px 0', borderTop: `1px solid ${C.hairline}`, fontSize: 14,
                }}
              >
                <span style={{ color: C.body, flex: 1, minWidth: 0 }}>{line.description}</span>
                <span style={{ color: C.ink, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {money(line.line_total)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Totals */}
        <div style={{ marginTop: 18, borderTop: `2px solid ${C.hairline}`, paddingTop: 14 }}>
          <Row label="Invoice total" value={money(total)} />
          {paid > 0 && <Row label="Already paid" value={`-${money(paid)}`} />}
          <Row label="Balance due" value={money(balance)} strong />
        </div>

        {/* What they already paid, so nobody calls asking */}
        {payments.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', color: C.faint, textTransform: 'uppercase', marginBottom: 6 }}>
              Payments received
            </div>
            {payments.map((p, i) => (
              <div
                key={`${p.payment_date}-${i}`}
                style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', fontSize: 13.5, color: C.muted }}
              >
                <span>
                  {prettyDate(p.payment_date) || ''}
                  {p.method ? ` · ${String(p.method).replace(/_/g, ' ')}` : ''}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(p.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Pay */}
      <Card style={{ marginTop: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>Pay this invoice</div>
        <div style={{ fontSize: 13.5, color: C.muted, marginTop: 4, lineHeight: 1.6 }}>
          Pay the full balance, or enter a different amount if you are paying in stages.
        </div>

        <label htmlFor="pay-amount" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: C.body, marginTop: 16, marginBottom: 6 }}>
          Amount to pay
        </label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 180px' }}>
            <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: C.muted, fontSize: 16 }}>$</span>
            <input
              id="pay-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setPayError(''); }}
              aria-describedby="pay-amount-help"
              aria-invalid={amount !== '' && !amountValid}
              style={{
                width: '100%', padding: '13px 13px 13px 28px', fontSize: 16,
                border: `1px solid ${amount !== '' && !amountValid ? C.danger : C.border}`,
                borderRadius: 10, color: C.ink, background: '#fff',
                fontVariantNumeric: 'tabular-nums', boxSizing: 'border-box',
              }}
            />
          </div>
          <button
            type="button"
            onClick={pay}
            disabled={!amountValid || submitting}
            style={{
              flex: '1 1 180px', padding: '13px 20px', fontSize: 15, fontWeight: 700,
              color: '#fff', background: (!amountValid || submitting) ? C.faint : C.accent,
              border: 'none', borderRadius: 10,
              cursor: (!amountValid || submitting) ? 'not-allowed' : 'pointer',
              minHeight: 48,
            }}
          >
            {submitting ? 'Starting…' : `Pay ${amountValid ? money(amountCents / 100) : ''}`.trim()}
          </button>
        </div>

        <div id="pay-amount-help" style={{ fontSize: 12.5, color: C.muted, marginTop: 8, lineHeight: 1.55 }}>
          {amount !== '' && !amountValid
            ? `Enter an amount between $0.50 and ${money(balance)}.`
            : `You can pay any amount up to ${money(balance)}. Card and bank transfer accepted.`}
        </div>

        {/* Inline, because there is no toast container on this page. */}
        {payError && (
          <div role="alert" style={{
            marginTop: 12, padding: '11px 13px', borderRadius: 10,
            background: C.dangerBg, border: `1px solid #fecdc9`, color: C.danger,
            fontSize: 13.5, lineHeight: 1.55,
          }}>
            {payError}
          </div>
        )}

        <div style={{ fontSize: 12, color: C.faint, marginTop: 14, lineHeight: 1.55 }}>
          Payments are processed securely by Stripe. Utah Pros Restoration never sees or stores your
          card or bank details.
        </div>
      </Card>
    </Shell>
  );
}

function Row({ label, value, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}>
      <span style={{ fontSize: strong ? 15 : 14, fontWeight: strong ? 700 : 400, color: strong ? C.ink : C.muted }}>
        {label}
      </span>
      <span style={{
        fontSize: strong ? 15 : 14, fontWeight: strong ? 800 : 500,
        color: C.ink, fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
    </div>
  );
}
