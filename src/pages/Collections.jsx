import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import ARDashboard from '@/components/collections/ARDashboard';
import PaymentsLedger from '@/components/collections/PaymentsLedger';

// Collections hub: A/R worklist (outstanding invoices + aging) and the Payments ledger
// (cash-in). One financial surface, two tabs.
export default function Collections() {
  const { db } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('ar');

  return (
    <div style={{ padding: '20px', maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>Collections</h1>
      <div style={{ display: 'flex', gap: 1, background: 'var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden', width: 'fit-content', marginBottom: 16 }}>
        {[['ar', 'A/R · Outstanding'], ['payments', 'Payments']].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)', cursor: 'pointer', border: 'none', background: tab === v ? 'var(--accent)' : 'var(--bg-primary)', color: tab === v ? '#fff' : 'var(--text-secondary)' }}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'ar'
        ? <ARDashboard db={db} navigate={navigate} />
        : <PaymentsLedger db={db} navigate={navigate} />}
    </div>
  );
}
