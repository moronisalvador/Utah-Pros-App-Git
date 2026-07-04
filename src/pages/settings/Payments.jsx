/**
 * ════════════════════════════════════════════════
 * FILE: Payments.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Payment Settings" screen. It's where an admin or manager controls how
 *   customers pay — whether invoices can be paid by card or bank transfer, the
 *   default due date, an optional card surcharge, and the QuickBooks accounts
 *   that card deposits and fees post to. It also holds the Stripe payout
 *   controls: the (owner-verified) payout destinations and a "pay out now"
 *   button that moves the Stripe balance to the bank.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/payments (self-guards in-component via canEditBilling)
 *   Rendered by:  src/App.jsx  (inside SettingsLayout)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext (db, employee), @/lib/useBillingSettings,
 *              @/lib/realtime (getAuthHeader), @/lib/claimUtils (canEditBilling),
 *              @/components/settings/SettingsPageHeader
 *   Data:      reads  → billing settings (get_billing_settings RPC), QuickBooks
 *                       accounts (/api/qbo-query), Stripe destinations
 *                       (/api/stripe-accounts)
 *              writes → billing settings (set_billing_setting RPC, via the hook);
 *                       payout destinations (/api/billing-2fa, email-code gated);
 *                       Stripe instant payout (/api/stripe-payout)
 *
 * NOTES / GOTCHAS:
 *   - ACCESS: the in-component canEditBilling(employee.role) block below is the
 *     page's ONLY barrier (the route is intentionally not AdminRoute-gated).
 *     Do not remove it.
 *   - REAL MONEY: "Pay out now" (Instant Payout) fires a same-day Stripe payout.
 *     It is a two-click confirm (arm → confirm, onBlur disarms) so one stray tap
 *     can't move money.
 *   - Payout destinations are money-movement settings: editing them emails a
 *     6-digit code to the owner (billing-2fa worker) and never saves without it.
 *     That flow's semantics are untouchable.
 *   - Setting saves go through useBillingSettings' revert-on-error save; the
 *     billing-2fa and Stripe-probe paths update local state directly (they
 *     persist server-side through their own endpoints, not set_billing_setting).
 *   - Never call /api/qbo-invoice from here (the human Save→QBO gate is sacred).
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import { canEditBilling } from '@/lib/claimUtils';
import { useBillingSettings } from '@/lib/useBillingSettings';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';

const toast = (m, t = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));

const TERMS = [['due_on_receipt', 'Due on receipt'], ['net_15', 'Net 15'], ['net_30', 'Net 30'], ['net_60', 'Net 60']];

export default function PaymentSettings() {
  const navigate = useNavigate();
  const { db, employee, isFeatureEnabled } = useAuth();
  const canEdit = canEditBilling(employee?.role);

  // ─── SECTION: State & hooks ──────────────
  const { settings: s, setSettings: setS, save, on, loading } = useBillingSettings(db);

  const [accounts, setAccounts] = useState([]);
  const [loadingAcct, setLoadingAcct] = useState(false);
  const [stripeDest, setStripeDest] = useState(null);   // { banks, cards } from Stripe
  const [loadingDest, setLoadingDest] = useState(false);
  const [payingOut, setPayingOut] = useState(false);
  const [payoutArmed, setPayoutArmed] = useState(false);
  // Email-2FA edit of payout destinations
  const [destEdit, setDestEdit] = useState(false);
  const [destStage, setDestStage] = useState('idle');   // sending | ready | saving
  const [destSentTo, setDestSentTo] = useState('');
  const [destCode, setDestCode] = useState('');
  const [destForm, setDestForm] = useState({ bankName: '', bankId: '', cardName: '', cardId: '' });

  // ─── SECTION: Event handlers ──────────────
  const loadAccounts = async () => {
    setLoadingAcct(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/qbo-query', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'SELECT Id, Name, AccountType FROM Account WHERE Active = true MAXRESULTS 500' }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || res.statusText);
      setAccounts((d.queryResponse?.Account || []).map(a => ({ id: String(a.Id), name: a.Name, type: a.AccountType })));
      toast('Loaded QuickBooks accounts');
    } catch (e) { toast(/not connected/i.test(e.message || '') ? 'Connect QuickBooks first (Dev Tools).' : 'Failed to load accounts: ' + e.message, 'error'); }
    finally { setLoadingAcct(false); }
  };

  const pickAccount = (idKey, nameKey, id) => {
    const a = accounts.find(x => x.id === id);
    save(idKey, id);
    save(nameKey, a?.name || '');
  };

  // Payout destinations are money-movement settings — gated by a code emailed to the
  // owner (never a plain click-and-edit field). Opening the editor requests a code.
  const openDestEdit = async () => {
    setDestForm({ bankName: s.stripe_payout_bank_name || '', bankId: s.stripe_payout_bank_id || '', cardName: s.stripe_instant_card_name || '', cardId: s.stripe_instant_card_id || '' });
    setDestCode(''); setDestSentTo(''); setDestEdit(true); setDestStage('sending');
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/billing-2fa', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'request' }) });
      const d = await res.json().catch(() => ({}));
      if (!d.ok) { toast(d.error || 'Could not send the verification code', 'error'); setDestStage('ready'); return; }
      setDestSentTo(d.to || ''); setDestStage('ready');
      toast(`Verification code emailed to ${d.to || 'the owner'}`);
    } catch (e) { toast('Could not send code: ' + (e.message || e), 'error'); setDestStage('ready'); }
  };

  const commitDest = async () => {
    if (!/^\d{6}$/.test(destCode.trim())) { toast('Enter the 6-digit code from the email', 'error'); return; }
    setDestStage('saving');
    try {
      const auth = await getAuthHeader();
      const changes = {
        stripe_payout_bank_name: destForm.bankName.trim(), stripe_payout_bank_id: destForm.bankId || '',
        stripe_instant_card_name: destForm.cardName.trim(), stripe_instant_card_id: destForm.cardId || '',
      };
      const res = await fetch('/api/billing-2fa', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'commit', code: destCode.trim(), changes }) });
      const d = await res.json().catch(() => ({}));
      if (!d.ok) { toast(d.error || 'Verification failed', 'error'); setDestStage('ready'); return; }
      setS(prev => ({ ...prev, ...changes }));
      setDestEdit(false); setDestCode(''); setDestStage('idle');
      toast('Payout destinations updated');
    } catch (e) { toast('Save failed: ' + (e.message || e), 'error'); setDestStage('ready'); }
  };

  // Loads the Stripe account's external accounts (banks + debit cards) for the payout
  // selectors. Also probes the connection — the worker flips stripe_connected on success.
  const loadStripeDestinations = async () => {
    setLoadingDest(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/stripe-accounts', { headers: { ...auth } });
      const d = await res.json().catch(() => ({}));
      if (res.status === 503) { toast('Add Stripe keys in Cloudflare to enable payouts.', 'error'); return; }
      if (!res.ok) throw new Error(d.error || res.statusText);
      setStripeDest({ banks: d.banks || [], cards: d.cards || [] });
      setS(prev => ({ ...prev, stripe_connected: 'true' }));
      toast('Loaded Stripe payout destinations');
    } catch (e) { toast('Failed to load Stripe: ' + (e.message || e), 'error'); }
    finally { setLoadingDest(false); }
  };

  const doInstantPayout = async () => {
    setPayingOut(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/stripe-payout', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' });
      const d = await res.json().catch(() => ({}));
      if (res.status === 503) { toast('Add Stripe keys in Cloudflare to enable payouts.', 'error'); return; }
      if (!res.ok) throw new Error(d.error || res.statusText);
      toast(`Instant payout of $${Number(d.amount || 0).toLocaleString()} initiated (${d.status})`);
    } catch (e) { toast('Payout failed: ' + (e.message || e), 'error'); }
    finally { setPayingOut(false); }
  };

  // Two-click confirm: real money moves, so arm first, then confirm. onBlur disarms.
  const handlePayoutClick = () => {
    if (!payoutArmed) { setPayoutArmed(true); return; }
    setPayoutArmed(false);
    doInstantPayout();
  };

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  if (!canEdit) {
    return <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, color: 'var(--text-tertiary)' }}>Payment settings are limited to admins and managers.</div>;
  }

  const stripeConnected = on('stripe_connected');

  // ─── SECTION: Render ──────────────
  return (
    <div className="pay-page">
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/collections')} style={{ gap: 4, marginBottom: 10 }}>← Collections</button>
      <SettingsPageHeader title="Payment Settings" subtitle="How payments are accepted, invoiced, and reconciled to QuickBooks." />

      {!isFeatureEnabled('feature:billing') && (
        <div className="pay-banner pay-banner--warn">
          Billing is currently turned off (feature flag <code>feature:billing</code>).
        </div>
      )}

      {/* QuickBooks Payments — the active online-pay path (Stripe below is the future processor). */}
      <Section title="Online payments (QuickBooks)">
        <Row label="Accept credit cards" hint="Adds a “Pay now” card button to invoices you email through QuickBooks.">
          <Toggle on={on('accept_card')} onClick={() => save('accept_card', !on('accept_card'))} />
        </Row>
        <Row label="Accept ACH / bank transfer" hint="Customers pay by bank transfer from the emailed invoice — cheaper for large insurance payments.">
          <Toggle on={on('accept_ach')} onClick={() => save('accept_ach', !on('accept_ach'))} />
        </Row>
        <p className="pay-note">Powered by QuickBooks Payments — these add the “Pay now” button to the QBO invoice your customer receives, and online payments flow back into UPR automatically. Requires QuickBooks Payments to be enabled on your QuickBooks company.</p>
      </Section>

      {/* Stripe (future processor — dormant). */}
      <Section title="Stripe — card & ACH payments">
        <Row label="Connection" hint="Set STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET in Cloudflare, then load to verify.">
          <span className={`pay-badge${stripeConnected ? ' is-ok' : ''}`}>{stripeConnected ? 'Connected' : 'Not connected'}</span>
          <button className="btn btn-secondary btn-sm" disabled={loadingDest} onClick={loadStripeDestinations}>{loadingDest ? 'Checking…' : 'Load from Stripe'}</button>
        </Row>

        {/* Payout destinations — money-movement setting, gated by a code emailed to the owner. */}
        <div className="pay-dest">
          <div className="pay-dest__head">
            <div>
              <div className="pay-dest__title">🔒 Payout destinations</div>
              <div className="pay-dest__desc">Where Stripe deposits land. Changing these requires a code emailed to the owner.</div>
            </div>
            {!destEdit && <button className="btn btn-secondary btn-sm" onClick={openDestEdit}>Edit</button>}
          </div>

          <div className="pay-kv-grid">
            <div><span className="pay-kv__label">Standard payout — checking</span><span className="pay-kv__val">{s.stripe_payout_bank_name || '—'}</span></div>
            <div><span className="pay-kv__label">Instant payout — debit card</span><span className="pay-kv__val">{s.stripe_instant_card_name || '—'}</span></div>
          </div>

          {destEdit && (
            <div className="pay-dest-edit">
              <div className="pay-dest-edit__msg">
                {destStage === 'sending' ? 'Emailing a verification code to the owner…'
                  : destSentTo ? <>We emailed a 6-digit code to <b>{destSentTo}</b>. Enter it below to confirm — the change won’t save without it.</>
                  : 'Enter the code from the verification email to confirm.'}
              </div>
              <div className="pay-field">
                <span className="pay-field__label">Standard payout — checking account</span>
                {stripeDest?.banks?.length ? (
                  <select className="input" value={destForm.bankId} onChange={e => { const b = stripeDest.banks.find(x => x.id === e.target.value); setDestForm(f => ({ ...f, bankId: e.target.value, bankName: b?.label || '' })); }}>
                    <option value="">Select account…</option>
                    {stripeDest.banks.map(b => <option key={b.id} value={b.id}>{b.label}{b.default_for_currency ? ' (default)' : ''}</option>)}
                  </select>
                ) : (
                  <input className="input" value={destForm.bankName} onChange={e => setDestForm(f => ({ ...f, bankName: e.target.value, bankId: '' }))} placeholder="e.g. Wells Fargo ••1234" />
                )}
              </div>
              <div className="pay-field">
                <span className="pay-field__label">Instant payout — debit card</span>
                {stripeDest?.cards?.length ? (
                  <select className="input" value={destForm.cardId} onChange={e => { const c = stripeDest.cards.find(x => x.id === e.target.value); setDestForm(f => ({ ...f, cardId: e.target.value, cardName: c?.label || '' })); }}>
                    <option value="">Select card…</option>
                    {stripeDest.cards.map(c => <option key={c.id} value={c.id}>{c.label}{c.instant ? '' : ' (not instant-eligible)'}</option>)}
                  </select>
                ) : (
                  <input className="input" value={destForm.cardName} onChange={e => setDestForm(f => ({ ...f, cardName: e.target.value, cardId: '' }))} placeholder="e.g. Visa debit ••4321" />
                )}
              </div>
              <div className="pay-code-row">
                <input className="input pay-code-input" value={destCode} onChange={e => setDestCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6-digit code" />
                <button className="btn btn-primary btn-sm" disabled={destStage === 'saving' || destStage === 'sending'} onClick={commitDest}>{destStage === 'saving' ? 'Saving…' : 'Verify & save'}</button>
                <button className="btn btn-ghost btn-sm" disabled={destStage === 'sending'} onClick={openDestEdit}>Resend code</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setDestEdit(false); setDestCode(''); setDestStage('idle'); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        <Row label="Same-day deposit (Instant Payout)" hint="Push your Stripe balance to the bank now (~1.5% fee).">
          <button
            className={`btn btn-secondary btn-sm pay-payout${payoutArmed ? ' is-armed' : ''}`}
            disabled={!stripeConnected || payingOut}
            title={stripeConnected ? '' : 'Available once Stripe is connected'}
            onClick={handlePayoutClick}
            onBlur={() => setPayoutArmed(false)}
            style={{ opacity: stripeConnected ? 1 : 0.6 }}
          >
            {payingOut ? 'Paying…' : payoutArmed ? 'Confirm payout?' : '⚡ Pay out now'}
          </button>
        </Row>
        <div className="pay-note">Payout destinations are protected — editing them emails a verification code to the owner first. Once Stripe is connected, <b>Load from Stripe</b> lets you pick the live account/card inside that verified edit. Add or change the actual bank/card in the Stripe Dashboard (Financial Connections) — never entered raw in UPR.</div>
      </Section>

      {/* Invoicing defaults */}
      <Section title="Invoicing defaults">
        <Row label="Default payment terms" hint="Sets the invoice due date (drives aging).">
          <select className="input pay-input-md" value={s.default_terms || 'net_30'} onChange={e => save('default_terms', e.target.value)}>
            {TERMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Row>
        <Row label="Card surcharge / convenience fee" hint="Pass the card fee to the payer (allowed in UT with disclosure).">
          <Toggle on={on('surcharge_enabled')} onClick={() => save('surcharge_enabled', !on('surcharge_enabled'))} />
        </Row>
        {on('surcharge_enabled') && (
          <Row label="Surcharge %">
            <input className="input pay-input-sm" type="number" inputMode="decimal" defaultValue={s.surcharge_pct || '3'} onBlur={e => save('surcharge_pct', e.target.value)} />
          </Row>
        )}
      </Section>

      {/* QBO fee mapping */}
      <Section title="QuickBooks fee reconciliation" desc="Where Stripe deposits and processing fees post in QuickBooks (used to auto-reconcile card payments).">
        <div style={{ marginBottom: 10 }}>
          <button className="btn btn-secondary btn-sm" disabled={loadingAcct} onClick={loadAccounts}>{loadingAcct ? 'Loading…' : 'Load accounts from QuickBooks'}</button>
        </div>
        <Row label="Stripe clearing account" hint="A bank-type account that holds card deposits before payout.">
          {accounts.length ? (
            <select className="input pay-input-lg" value={s.qbo_stripe_clearing_account_id || ''} onChange={e => pickAccount('qbo_stripe_clearing_account_id', 'qbo_stripe_clearing_account_name', e.target.value)}>
              <option value="">Select account…</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
            </select>
          ) : <span className="pay-row__hint" style={{ fontSize: 13 }}>{s.qbo_stripe_clearing_account_name || 'Load accounts to choose'}</span>}
        </Row>
        <Row label="Merchant fees expense account" hint="Where Stripe processing fees are booked.">
          {accounts.length ? (
            <select className="input pay-input-lg" value={s.qbo_fee_expense_account_id || ''} onChange={e => pickAccount('qbo_fee_expense_account_id', 'qbo_fee_expense_account_name', e.target.value)}>
              <option value="">Select account…</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
            </select>
          ) : <span className="pay-row__hint" style={{ fontSize: 13 }}>{s.qbo_fee_expense_account_name || 'Load accounts to choose'}</span>}
        </Row>
        <Row label="Deposit bank account" hint="Real bank where Stripe payouts land — clearing transfers the net here.">
          {accounts.length ? (
            <select className="input pay-input-lg" value={s.qbo_bank_account_id || ''} onChange={e => pickAccount('qbo_bank_account_id', 'qbo_bank_account_name', e.target.value)}>
              <option value="">Select account…</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
            </select>
          ) : <span className="pay-row__hint" style={{ fontSize: 13 }}>{s.qbo_bank_account_name || 'Load accounts to choose'}</span>}
        </Row>
      </Section>

      <p className="pay-note">Card collection, payout destinations, and Instant Payout activate once the Stripe keys are set in Cloudflare and you click <b>Load from Stripe</b>. Settings save automatically.</p>
    </div>
  );
}

// ─── SECTION: Helpers ──────────────
function Section({ title, desc, children }) {
  return (
    <div className="pay-card">
      <div className="pay-card__title">{title}</div>
      {desc && <div className="pay-card__desc">{desc}</div>}
      {children}
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="pay-row">
      <div className="pay-row__main">
        <div className="pay-row__label">{label}</div>
        {hint && <div className="pay-row__hint">{hint}</div>}
      </div>
      <div className="pay-row__control">{children}</div>
    </div>
  );
}

function Toggle({ on, onClick }) {
  return (
    <button className={`pay-toggle${on ? ' is-on' : ''}`} onClick={onClick} role="switch" aria-checked={on}>
      <span className="pay-toggle__track"><span className="pay-toggle__knob" /></span>
    </button>
  );
}
