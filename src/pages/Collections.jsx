import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import CollectionsOverview from '@/components/collections/CollectionsOverview';
import PaymentLogger from '@/components/collections/PaymentLogger';
import CollectionsDashboard from '@/components/collections/CollectionsDashboard';

const TABS = [
  { key: 'overview',  label: 'Overview' },
  { key: 'payments',  label: 'Log Payment' },
  { key: 'dashboard', label: 'Dashboard' },
];

export default function Collections() {
  const { db } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="collections-page">
      <div className="collections-header">
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Collections</h1>
        <div className="ar-tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              className={`ar-tab${activeTab === t.key ? ' active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'overview' && <CollectionsOverview db={db} navigate={navigate} />}
        {activeTab === 'payments' && <PaymentLogger db={db} />}
        {activeTab === 'dashboard' && <CollectionsDashboard db={db} />}
      </div>
    </div>
  );
}
