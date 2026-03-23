import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { IconSearch } from '@/components/Icons';
import PullToRefresh from '@/components/PullToRefresh';

const DIVISION_COLORS = { water: '#2563eb', mold: '#9d174d', reconstruction: '#d97706', fire: '#dc2626', contents: '#059669' };
const ROLE_LABELS = { homeowner: 'Homeowner', tenant: 'Tenant', property_manager: 'Prop. Manager' };

export default function Customers() {
  const navigate = useNavigate();
  const { db } = useAuth();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');

  useEffect(() => { const t = setTimeout(() => setSearchDebounced(search), 300); return () => clearTimeout(t); }, [search]);

  const loadCustomers = useCallback(async () => {
    try {
      const data = await db.rpc('get_customers_list', { p_search: searchDebounced || null, p_limit: 200, p_offset: 0 });
      setCustomers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Load customers:', err);
      try {
        const data = await db.select('contacts', 'role=in.(homeowner,tenant,property_manager)&order=created_at.desc&limit=200');
        setCustomers((data || []).map(c => ({ ...c, jobs: [], job_count: 0 })));
      } catch (err2) { console.error('Fallback:', err2); }
    } finally { setLoading(false); }
  }, [db, searchDebounced]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  // Reload list when Layout's AddContactModal saves a new contact
  useEffect(() => {
    const handler = () => loadCustomers();
    window.addEventListener('upr:contact-created', handler);
    return () => window.removeEventListener('upr:contact-created', handler);
  }, [loadCustomers]);

  const fmtPhone = (phone) => {
    if (!phone) return '';
    const d = phone.replace(/\D/g, '');
    const n = d.startsWith('1') ? d.slice(1) : d;
    if (n.length === 10) return `(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}`;
    return phone;
  };
  const initials = (name) => name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?';

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="customers-page">
      <div className="customers-header">
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="page-subtitle">{customers.length} client{customers.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="customers-filters">
        <div className="customers-search-wrap">
          <IconSearch style={{ width: 14, height: 14, position: 'absolute', left: 10, top: 9, color: 'var(--text-tertiary)' }} />
          <input className="input" placeholder="Search name, phone, email, address..."
            value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32, width: '100%' }} />
        </div>
        {search && <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>Clear</button>}
      </div>

      <PullToRefresh onRefresh={loadCustomers} className="customers-list">
        {customers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">👥</div>
            <div className="empty-state-text">{search ? 'No customers found' : 'No customers yet'}</div>
            <div className="empty-state-sub">{search ? 'Try a different search' : 'Create your first customer to get started'}</div>
          </div>
        ) : customers.map(c => (
          <div key={c.id} className="customer-card" onClick={() => navigate(`/customers/${c.id}`)}>
            <div className="customer-card-avatar">{initials(c.name)}</div>
            <div className="customer-card-body">
              <div className="customer-card-name">{c.name}</div>
              <div className="customer-card-meta">
                {c.phone && <span>{fmtPhone(c.phone)}</span>}
                {c.email && <span>{c.email}</span>}
                {(c.billing_address || c.billing_city) && <span>{c.billing_address}{c.billing_city ? `, ${c.billing_city}` : ''}</span>}
              </div>
              {Array.isArray(c.jobs) && c.jobs.length > 0 && (
                <div className="customer-card-jobs">
                  {c.jobs.slice(0, 3).map(j => (
                    <span key={j.id} className="customer-card-job-pill"
                      style={{ borderLeftColor: DIVISION_COLORS[j.division] || '#6b7280', borderLeftWidth: 2 }}>
                      {j.job_number || 'Job'}
                    </span>
                  ))}
                  {c.jobs.length > 3 && <span className="customer-card-job-pill">+{c.jobs.length - 3}</span>}
                </div>
              )}
            </div>
            <div className="customer-card-right">
              <span className="customer-card-role-badge">{ROLE_LABELS[c.role] || c.role}</span>
              {c.job_count > 0 && <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{c.job_count} job{c.job_count !== 1 ? 's' : ''}</span>}
            </div>
          </div>
        ))}
      </PullToRefresh>
    </div>
  );
}
