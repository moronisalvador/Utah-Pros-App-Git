import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { canEditBilling } from '@/lib/claimUtils';
import ARDashboard from '@/components/collections/ARDashboard';
import PaymentsLedger from '@/components/collections/PaymentsLedger';
import InvoicesList from '@/components/collections/InvoicesList';
import NewInvoiceModal from '@/components/NewInvoiceModal';

// Collections hub: A/R worklist (outstanding invoices + aging) and the Payments ledger
// (cash-in). One financial surface, two tabs.
export default function Collections() {
  const { db, employee, isFeatureEnabled } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('ar');
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const canEdit = canEditBilling(employee?.role);
  const billingOn = isFeatureEnabled('feature:billing');

  return (
    <div style={{ padding: '20px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>Collections</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {canEdit && billingOn && <button className="btn btn-primary btn-sm" onClick={() => setShowNewInvoice(true)} style={{ gap: 5 }}>+ New invoice</button>}
          {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => navigate('/payments/settings')} style={{ gap: 5 }}>⚙ Payment settings</button>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 1, background: 'var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden', width: 'fit-content', marginBottom: 16 }}>
        {[['ar', 'A/R · Outstanding'], ['invoices', 'Invoices'], ['payments', 'Payments']].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)', cursor: 'pointer', border: 'none', background: tab === v ? 'var(--accent)' : 'var(--bg-primary)', color: tab === v ? '#fff' : 'var(--text-secondary)' }}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'ar'       && <ARDashboard db={db} navigate={navigate} />}
      {tab === 'invoices' && <InvoicesList db={db} navigate={navigate} />}
      {tab === 'payments' && <PaymentsLedger db={db} navigate={navigate} />}
      {showNewInvoice && <NewInvoiceModal db={db} onClose={() => setShowNewInvoice(false)} />}
    </div>
  );
}
