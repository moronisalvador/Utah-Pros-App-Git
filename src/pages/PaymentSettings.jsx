import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import { canEditBilling } from '@/lib/claimUtils';

const toast = (m, t = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));

const TERMS = [['due_on_receipt', 'Due on receipt'], ['net_15', 'Net 15'], ['net_30', 'Net 30'], ['net_60', 'Net 60']];

export default function PaymentSettings() {
  const navigate = useNavigate();
  const { db, employee, isFeatureEnabled } = useAuth();
  const canEdit = canEditBilling(employee?.role);

  const [s, setS] = useState({});
  const [accounts, setAccounts] = useState([]);
  const [loadingAcct, setLoadingAcct] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setS((await db.rpc('get_billing_settings')) || {}); }
    catch { toast('Failed to load settings', 'error'); }
    finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const save = async (key, value) => {
    setS(prev => ({ ...prev, [key]: value }));
    try { await db.rpc('set_billing_setting', { p_key: key, p_value: String(value) }); }
    catch (e) { toast('Failed to save: ' + (e.message || e), 'error'); }
  };
  const on = (k) => s[k] === 'true';

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

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  if (!canEdit) {
    return <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, color: 'var(--text-tertiary)' }}>Payment settings are limited to admins and managers.</div>;
  }

  const stripeConnected = on('stripe_connected');

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px', paddingBottom: 80 }}>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/collections')} style={{ gap: 4, marginBottom: 10 }}>← Collections</button>
      <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>Payment Settings</h1>
      <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-secondary)' }}>How payments are accepted, invoiced, and reconciled to QuickBooks.</p>

      {!isFeatureEnabled('feature:billing') && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#d97706', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>
          Billing is currently turned off (feature flag <code>feature:billing</code>).
        </div>
      )}

      {/* Stripe */}
      <Section title="Stripe — card & ACH payments">
        <Row label="Connection" hint="Connect via API keys during Stripe setup.">
          <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 'var(--radius-full)', background: stripeConnected ? '#f0fdf4' : 'var(--bg-tertiary)', color: stripeConnected ? '#16a34a' : 'var(--text-tertiary)', border: `1px solid ${stripeConnected ? '#bbf7d0' : 'var(--border-light)'}` }}>
            {stripeConnected ? 'Connected' : 'Not connected'}
          </span>
        </Row>
        <Row label="Accept credit cards"><Toggle on={on('accept_card')} onClick={() => save('accept_card', !on('accept_card'))} /></Row>
        <Row label="Accept ACH / bank transfer" hint="~0.8% capped — cheaper for large insurance payments."><Toggle on={on('accept_ach')} onClick={() => save('accept_ach', !on('accept_ach'))} /></Row>
        <Row label="Same-day deposit (Instant Payout)" hint="Push your Stripe balance to the bank now (~1.5% fee).">
          <button className="btn btn-secondary btn-sm" disabled title={stripeConnected ? '' : 'Available once Stripe is connected'} onClick={() => toast('Instant payout will be available once Stripe is connected.', 'error')} style={{ opacity: 0.6 }}>⚡ Pay out now</button>
        </Row>
      </Section>

      {/* Invoicing defaults */}
      <Section title="Invoicing defaults">
        <Row label="Default payment terms" hint="Sets the invoice due date (drives aging).">
          <select className="input" value={s.default_terms || 'net_30'} onChange={e => save('default_terms', e.target.value)} style={{ width: 180, height: 34 }}>
            {TERMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Row>
        <Row label="Card surcharge / convenience fee" hint="Pass the card fee to the payer (allowed in UT with disclosure).">
          <Toggle on={on('surcharge_enabled')} onClick={() => save('surcharge_enabled', !on('surcharge_enabled'))} />
        </Row>
        {on('surcharge_enabled') && (
          <Row label="Surcharge %">
            <input type="number" inputMode="decimal" defaultValue={s.surcharge_pct || '3'} onBlur={e => save('surcharge_pct', e.target.value)} style={{ width: 90, padding: '6px 8px', fontSize: 13, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
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
            <select className="input" value={s.qbo_stripe_clearing_account_id || ''} onChange={e => pickAccount('qbo_stripe_clearing_account_id', 'qbo_stripe_clearing_account_name', e.target.value)} style={{ width: 240, height: 34 }}>
              <option value="">Select account…</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
            </select>
          ) : <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{s.qbo_stripe_clearing_account_name || 'Load accounts to choose'}</span>}
        </Row>
        <Row label="Merchant fees expense account" hint="Where Stripe processing fees are booked.">
          {accounts.length ? (
            <select className="input" value={s.qbo_fee_expense_account_id || ''} onChange={e => pickAccount('qbo_fee_expense_account_id', 'qbo_fee_expense_account_name', e.target.value)} style={{ width: 240, height: 34 }}>
              <option value="">Select account…</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
            </select>
          ) : <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{s.qbo_fee_expense_account_name || 'Load accounts to choose'}</span>}
        </Row>
      </Section>

      <p style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Stripe connection and the live Instant-Payout button activate once Stripe keys are added (next phase). Settings save automatically.</p>
    </div>
  );
}

function Section({ title, desc, children }) {
  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', marginBottom: 16, background: 'var(--bg-primary)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: desc ? 2 : 10 }}>{title}</div>
      {desc && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>{desc}</div>}
      {children}
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: '1px solid var(--border-light)' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 1 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Toggle({ on, onClick }) {
  return (
    <button onClick={onClick} role="switch" aria-checked={on}
      style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', padding: 2, background: on ? 'var(--accent)' : 'var(--border-color)', transition: 'background .15s' }}>
      <span style={{ display: 'block', width: 20, height: 20, borderRadius: '50%', background: '#fff', transform: on ? 'translateX(18px)' : 'translateX(0)', transition: 'transform .15s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
    </button>
  );
}
