import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { IconSearch } from '@/components/Icons';
import AddContactModal from '@/components/AddContactModal';
import PullToRefresh from '@/components/PullToRefresh';

/* ═══ LOCAL ICONS ═══ */
function IconPlus(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);}
function IconX(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>);}
function IconPhone(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>);}
function IconMail(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>);}
function IconMsg(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>);}
function IconMapPin(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>);}

const DIVISION_COLORS = {
  water: '#2563eb', mold: '#9d174d', reconstruction: '#d97706',
  fire: '#dc2626', contents: '#059669',
};

const PHASE_STYLES = {
  job_received: { label: 'Received', bg: '#fff7ed', color: '#ea580c' },
  mitigation_in_progress: { label: 'Mitigation', bg: '#eff6ff', color: '#2563eb' },
  reconstruction_in_progress: { label: 'In Progress', bg: '#eff6ff', color: '#2563eb' },
  completed: { label: 'Completed', bg: '#ecfdf5', color: '#10b981' },
  closed: { label: 'Closed', bg: '#f1f3f5', color: '#6b7280' },
};

const ROLE_LABELS = { homeowner: 'Homeowner', tenant: 'Tenant', property_manager: 'Prop. Manager' };

function getPhaseStyle(phase) {
  return PHASE_STYLES[phase] || { label: phase?.replace(/_/g, ' ') || '—', bg: '#f1f3f5', color: '#6b7280' };
}

export default function Customers() {
  const navigate = useNavigate();
  const { db } = useAuth();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showAddContact, setShowAddContact] = useState(false);
  const [carriers, setCarriers] = useState([]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Load customers
  const loadCustomers = useCallback(async () => {
    try {
      const data = await db.rpc('get_customers_list', {
        p_search: searchDebounced || null,
        p_limit: 200,
        p_offset: 0,
      });
      setCustomers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Load customers:', err);
      // Fallback to direct query if RPC doesn't exist yet
      try {
        const data = await db.select('contacts',
          `role=in.(homeowner,tenant,property_manager)&order=created_at.desc&limit=200`
        );
        setCustomers((data || []).map(c => ({ ...c, jobs: [], job_count: 0 })));
      } catch (err2) {
        console.error('Fallback load:', err2);
      }
    } finally {
      setLoading(false);
    }
  }, [db, searchDebounced]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  // Load carriers for AddContactModal
  useEffect(() => {
    db.select('insurance_carriers', 'order=name.asc&select=id,name,short_name').then(setCarriers).catch(() => {});
  }, []);

  const fmtPhone = (phone) => {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    const n = digits.startsWith('1') ? digits.slice(1) : digits;
    if (n.length === 10) return `(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}`;
    return phone;
  };

  const initials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  // Handle new contact creation
  const handleNewContact = async (data) => {
    try {
      await db.insert('contacts', data);
      setShowAddContact(false);
      loadCustomers();
    } catch (err) {
      console.error('Create contact:', err);
      alert('Failed: ' + err.message);
      throw err;
    }
  };

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="customers-page">
      {/* Header */}
      <div className="customers-header">
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="page-subtitle">{customers.length} client{customers.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddContact(true)} style={{ gap: 4 }}>
          <IconPlus style={{ width: 14, height: 14 }} /> New Customer
        </button>
      </div>

      {/* Search */}
      <div className="customers-filters">
        <div className="customers-search-wrap">
          <IconSearch style={{ width: 14, height: 14, position: 'absolute', left: 10, top: 9, color: 'var(--text-tertiary)' }} />
          <input className="input" placeholder="Search name, phone, email, address..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 32, width: '100%' }} />
        </div>
        {search && <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>Clear</button>}
      </div>

      {/* Customer List */}
      <PullToRefresh onRefresh={loadCustomers} className="customers-list">
        {customers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">👥</div>
            <div className="empty-state-text">{search ? 'No customers found' : 'No customers yet'}</div>
            <div className="empty-state-sub">{search ? 'Try a different search' : 'Create your first customer to get started'}</div>
          </div>
        ) : (
          customers.map(customer => (
            <CustomerCard
              key={customer.id}
              customer={customer}
              fmtPhone={fmtPhone}
              initials={initials}
              onClick={() => setSelectedCustomer(customer)}
            />
          ))
        )}
      </PullToRefresh>

      {/* Detail Panel */}
      {selectedCustomer && (
        <>
          <div className="customer-detail-backdrop" onClick={() => setSelectedCustomer(null)} />
          <CustomerDetailPanel
            customer={selectedCustomer}
            fmtPhone={fmtPhone}
            initials={initials}
            onClose={() => setSelectedCustomer(null)}
            onNavigateJob={(jobId) => { setSelectedCustomer(null); navigate(`/jobs/${jobId}`); }}
            onNavigateMessage={(phone) => navigate('/conversations')}
          />
        </>
      )}

      {/* Add Contact Modal */}
      {showAddContact && (
        <AddContactModal
          onClose={() => setShowAddContact(false)}
          onSave={handleNewContact}
          carriers={carriers}
          referralSources={[]}
          defaultRole="homeowner"
        />
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   CUSTOMER CARD
   ═══════════════════════════════════════════════════════════════ */

function CustomerCard({ customer, fmtPhone, initials, onClick }) {
  const c = customer;
  const jobs = Array.isArray(c.jobs) ? c.jobs : [];
  const hasAddress = c.billing_address || c.billing_city;

  return (
    <div className="customer-card" onClick={onClick}>
      <div className="customer-card-avatar">{initials(c.name)}</div>
      <div className="customer-card-body">
        <div className="customer-card-name">{c.name}</div>
        <div className="customer-card-meta">
          {c.phone && <span>{fmtPhone(c.phone)}</span>}
          {c.email && <span>{c.email}</span>}
          {hasAddress && <span>{c.billing_address}{c.billing_city ? `, ${c.billing_city}` : ''}</span>}
        </div>
        {jobs.length > 0 && (
          <div className="customer-card-jobs">
            {jobs.slice(0, 3).map(j => (
              <span key={j.id} className="customer-card-job-pill"
                style={{ borderLeftColor: DIVISION_COLORS[j.division] || '#6b7280', borderLeftWidth: 2 }}>
                {j.job_number || 'Job'}
              </span>
            ))}
            {jobs.length > 3 && <span className="customer-card-job-pill">+{jobs.length - 3}</span>}
          </div>
        )}
      </div>
      <div className="customer-card-right">
        <span className="customer-card-role-badge">{ROLE_LABELS[c.role] || c.role}</span>
        {c.job_count > 0 && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{c.job_count} job{c.job_count !== 1 ? 's' : ''}</span>
        )}
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   CUSTOMER DETAIL PANEL (slide-out)
   ═══════════════════════════════════════════════════════════════ */

function CustomerDetailPanel({ customer, fmtPhone, initials, onClose, onNavigateJob, onNavigateMessage }) {
  const c = customer;
  const jobs = Array.isArray(c.jobs) ? c.jobs : [];
  const claims = Array.isArray(c.claims) ? c.claims : [];
  const hasAddress = c.billing_address || c.billing_city;

  const fmtDate = (val) => {
    if (!val) return '—';
    return new Date(val + (val.includes('T') ? '' : 'T00:00:00')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="customer-detail-panel">
      {/* Header */}
      <div className="customer-detail-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div className="customer-card-avatar" style={{ width: 36, height: 36, fontSize: 12 }}>{initials(c.name)}</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-base)' }}>{c.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>{ROLE_LABELS[c.role] || c.role}</div>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ width: 32, height: 32, padding: 0 }}>
          <IconX style={{ width: 18, height: 18 }} />
        </button>
      </div>

      {/* Body */}
      <div className="customer-detail-body">
        {/* Quick Actions */}
        <div className="customer-detail-actions">
          {c.phone && (
            <a href={`tel:${c.phone}`} className="customer-action-btn">
              <IconPhone style={{ width: 16, height: 16 }} />
              Call
            </a>
          )}
          {c.phone && (
            <button className="customer-action-btn" onClick={() => onNavigateMessage(c.phone)}>
              <IconMsg style={{ width: 16, height: 16 }} />
              Message
            </button>
          )}
          {c.email && (
            <a href={`mailto:${c.email}`} className="customer-action-btn">
              <IconMail style={{ width: 16, height: 16 }} />
              Email
            </a>
          )}
        </div>

        {/* Contact Info */}
        <div className="customer-detail-section" style={{ marginTop: 'var(--space-5)' }}>
          <div className="customer-detail-section-title">Contact Information</div>
          <div className="customer-detail-row">
            <span className="customer-detail-label">Phone</span>
            <span className="customer-detail-value"><a href={`tel:${c.phone}`}>{fmtPhone(c.phone)}</a></span>
          </div>
          {c.email && (
            <div className="customer-detail-row">
              <span className="customer-detail-label">Email</span>
              <span className="customer-detail-value"><a href={`mailto:${c.email}`}>{c.email}</a></span>
            </div>
          )}
          {c.company && (
            <div className="customer-detail-row">
              <span className="customer-detail-label">Company</span>
              <span className="customer-detail-value">{c.company}</span>
            </div>
          )}
          {c.preferred_contact_method && (
            <div className="customer-detail-row">
              <span className="customer-detail-label">Preferred</span>
              <span className="customer-detail-value" style={{ textTransform: 'uppercase' }}>{c.preferred_contact_method}</span>
            </div>
          )}
          {c.preferred_language && c.preferred_language !== 'en' && (
            <div className="customer-detail-row">
              <span className="customer-detail-label">Language</span>
              <span className="customer-detail-value">{c.preferred_language === 'es' ? 'Spanish' : c.preferred_language === 'pt' ? 'Portuguese' : c.preferred_language}</span>
            </div>
          )}
          {c.dnd && (
            <div className="customer-detail-row">
              <span className="customer-detail-label">DND</span>
              <span className="customer-detail-value" style={{ color: 'var(--status-needs-response)', fontWeight: 600 }}>Enabled</span>
            </div>
          )}
        </div>

        {/* Address */}
        {hasAddress && (
          <div className="customer-detail-section">
            <div className="customer-detail-section-title">Billing Address</div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', lineHeight: 1.5 }}>
              {c.billing_address && <div>{c.billing_address}</div>}
              <div>{[c.billing_city, c.billing_state, c.billing_zip].filter(Boolean).join(', ')}</div>
            </div>
          </div>
        )}

        {/* Insurance */}
        {(c.insurance_carrier || c.policy_number) && (
          <div className="customer-detail-section">
            <div className="customer-detail-section-title">Insurance</div>
            {c.insurance_carrier && (
              <div className="customer-detail-row">
                <span className="customer-detail-label">Carrier</span>
                <span className="customer-detail-value">{c.insurance_carrier}</span>
              </div>
            )}
            {c.policy_number && (
              <div className="customer-detail-row">
                <span className="customer-detail-label">Policy #</span>
                <span className="customer-detail-value">{c.policy_number}</span>
              </div>
            )}
          </div>
        )}

        {/* Jobs grouped by Claim/Occurrence */}
        <div className="customer-detail-section">
          <div className="customer-detail-section-title">
            Jobs ({jobs.length})
          </div>
          {claims.length > 0 ? (
            claims.map(claim => {
              const claimJobs = Array.isArray(claim.jobs) ? claim.jobs : [];
              return (
                <div key={claim.id} style={{ marginBottom: 'var(--space-4)' }}>
                  {/* Claim header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    marginBottom: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)',
                    background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
                      {claim.claim_number}
                    </span>
                    {claim.date_of_loss && (
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                        · Loss: {fmtDate(claim.date_of_loss)}
                      </span>
                    )}
                    {claim.insurance_carrier && (
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                        · {claim.insurance_carrier}
                      </span>
                    )}
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99,
                      background: claim.status === 'open' ? '#eff6ff' : '#f1f3f5',
                      color: claim.status === 'open' ? '#2563eb' : '#6b7280',
                      fontWeight: 600, marginLeft: 'auto' }}>
                      {claim.status}
                    </span>
                  </div>
                  {/* Jobs under this claim */}
                  {claimJobs.map(j => {
                    const ps = getPhaseStyle(j.phase);
                    return (
                      <div key={j.id} className="customer-detail-job" onClick={() => onNavigateJob(j.id)}>
                        <div className="customer-detail-job-div" style={{ background: DIVISION_COLORS[j.division] || '#6b7280' }} />
                        <div className="customer-detail-job-info">
                          <div className="customer-detail-job-number">{j.job_number || 'No Job #'}</div>
                          {j.address && <div className="customer-detail-job-address">{j.address}{j.city ? `, ${j.city}` : ''}</div>}
                          {j.insurance_company && <div className="customer-detail-job-address">{j.insurance_company}</div>}
                        </div>
                        <span className="customer-detail-job-phase" style={{ background: ps.bg, color: ps.color }}>
                          {ps.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })
          ) : jobs.length === 0 ? (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', padding: 'var(--space-3) 0' }}>
              No jobs linked yet
            </div>
          ) : (
            /* Fallback: flat job list if no claims data */
            jobs.map(j => {
              const ps = getPhaseStyle(j.phase);
              return (
                <div key={j.id} className="customer-detail-job" onClick={() => onNavigateJob(j.id)}>
                  <div className="customer-detail-job-div" style={{ background: DIVISION_COLORS[j.division] || '#6b7280' }} />
                  <div className="customer-detail-job-info">
                    <div className="customer-detail-job-number">{j.job_number || 'No Job #'}</div>
                    {j.address && <div className="customer-detail-job-address">{j.address}{j.city ? `, ${j.city}` : ''}</div>}
                  </div>
                  <span className="customer-detail-job-phase" style={{ background: ps.bg, color: ps.color }}>
                    {ps.label}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Notes */}
        {c.notes && (
          <div className="customer-detail-section">
            <div className="customer-detail-section-title">Notes</div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {c.notes}
            </div>
          </div>
        )}

        {/* Meta */}
        <div className="customer-detail-section" style={{ opacity: 0.6 }}>
          <div className="customer-detail-row">
            <span className="customer-detail-label">Created</span>
            <span className="customer-detail-value">{fmtDate(c.created_at)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
