import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { IconSearch } from '@/components/Icons';
import PullToRefresh from '@/components/PullToRefresh';
import AddContactModal from '@/components/AddContactModal';

/* ═══════════════════════════════════════════════════════════════════
   INLINE ICONS (no external library — follows Icons.jsx pattern)
   ═══════════════════════════════════════════════════════════════════ */

function IconPlus(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>);
}
function IconX(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>);
}
function IconPhone(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.88.36 1.72.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c1.09.34 1.93.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>);
}
function IconChevronRight(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="9 18 15 12 9 6" /></svg>);
}
function IconBuilding(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01" /></svg>);
}
function IconBriefcase(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /></svg>);
}

/* ═══════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════ */

const ROLE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'homeowner', label: 'Homeowners' },
  { key: 'adjuster', label: 'Adjusters' },
  { key: 'vendor', label: 'Vendors' },
  { key: 'agent', label: 'Agents' },
  { key: 'subcontractor', label: 'Subs' },
  { key: 'other', label: 'Other' },
];

// Roles grouped under "Other" tab
const OTHER_ROLES = ['property_manager', 'mortgage_co', 'tenant', 'other', 'referral_partner', 'insurance_rep', 'broker'];

const ROLE_LABELS = {
  homeowner: 'Homeowner',
  adjuster: 'Adjuster',
  subcontractor: 'Subcontractor',
  property_manager: 'Property Mgr',
  agent: 'Agent',
  mortgage_co: 'Mortgage Co',
  tenant: 'Tenant',
  other: 'Other',
  vendor: 'Vendor',
  referral_partner: 'Referral',
  insurance_rep: 'Insurance Rep',
  broker: 'Broker',
};

const ROLE_COLORS = {
  homeowner: { bg: '#dbeafe', text: '#1e40af' },
  adjuster: { bg: '#fce7f3', text: '#9d174d' },
  subcontractor: { bg: '#fef3c7', text: '#92400e' },
  vendor: { bg: '#d1fae5', text: '#065f46' },
  agent: { bg: '#ede9fe', text: '#6d28d9' },
  property_manager: { bg: '#e0e7ff', text: '#3730a3' },
  referral_partner: { bg: '#fef9c3', text: '#713f12' },
  insurance_rep: { bg: '#fce7f3', text: '#9d174d' },
  broker: { bg: '#f0fdf4', text: '#166534' },
  mortgage_co: { bg: '#f0f9ff', text: '#0c4a6e' },
  tenant: { bg: '#f5f5f4', text: '#44403c' },
  other: { bg: 'var(--bg-tertiary)', text: 'var(--text-secondary)' },
};

const ROLE_OPTIONS = [
  { value: 'homeowner', label: 'Homeowner' },
  { value: 'adjuster', label: 'Adjuster' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'agent', label: 'Agent' },
  { value: 'property_manager', label: 'Property Manager' },
  { value: 'referral_partner', label: 'Referral Partner' },
  { value: 'insurance_rep', label: 'Insurance Rep' },
  { value: 'broker', label: 'Broker' },
  { value: 'mortgage_co', label: 'Mortgage Co' },
  { value: 'tenant', label: 'Tenant' },
  { value: 'other', label: 'Other' },
];

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════ */

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatPhone(phone) {
  if (!phone) return '—';
  // Format +1XXXXXXXXXX → (XXX) XXX-XXXX
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════ */

export default function Customers() {
  const { db, employee } = useAuth();
  const navigate = useNavigate();

  const [contacts, setContacts] = useState([]);
  const [jobCounts, setJobCounts] = useState({}); // { contactId: count }
  const [carriers, setCarriers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);

  const searchRef = useRef(null);

  // ── Load data ──
  const loadData = useCallback(async () => {
    try {
      const [contactsData, contactJobsData, carriersData] = await Promise.all([
        db.select('contacts', 'order=name.asc.nullslast&select=id,name,phone,email,company,role,opt_in_status,dnd,created_at'),
        db.select('contact_jobs', 'select=contact_id').catch(() => []),
        db.select('insurance_carriers', 'is_active=eq.true&order=sort_order.asc,name.asc&select=id,name,short_name').catch(() => []),
      ]);
      setContacts(contactsData);
      setCarriers(carriersData);

      // Count jobs per contact client-side
      const counts = {};
      for (const cj of contactJobsData) {
        counts[cj.contact_id] = (counts[cj.contact_id] || 0) + 1;
      }
      setJobCounts(counts);
    } catch (err) {
      console.error('Customers load error:', err);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Filter & search ──
  const filtered = useMemo(() => {
    let result = contacts;

    // Role filter
    if (activeFilter !== 'all') {
      if (activeFilter === 'other') {
        result = result.filter(c => OTHER_ROLES.includes(c.role));
      } else {
        result = result.filter(c => c.role === activeFilter);
      }
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(c =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.company && c.company.toLowerCase().includes(q))
      );
    }

    return result;
  }, [contacts, activeFilter, search]);

  // ── Tab counts ──
  const tabCounts = useMemo(() => {
    const counts = { all: contacts.length };
    for (const f of ROLE_FILTERS) {
      if (f.key === 'all') continue;
      if (f.key === 'other') {
        counts.other = contacts.filter(c => OTHER_ROLES.includes(c.role)).length;
      } else {
        counts[f.key] = contacts.filter(c => c.role === f.key).length;
      }
    }
    return counts;
  }, [contacts]);

  // ── Add contact handler ──
  const handleAddContact = async (data) => {
    try {
      const inserted = await db.insert('contacts', {
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (inserted?.length > 0) {
        setContacts(prev => [...prev, inserted[0]].sort((a, b) =>
          (a.name || '').localeCompare(b.name || '')
        ));
      }
      setShowAddModal(false);
    } catch (err) {
      alert('Failed to add contact: ' + err.message);
    }
  };

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <PullToRefresh onRefresh={loadData}>
      <div className="customers-page">
        {/* ── Header ── */}
        <div className="customers-header">
          <div>
            <h1 className="page-title">Customers</h1>
            <p className="page-subtitle">{contacts.length} contact{contacts.length !== 1 ? 's' : ''}</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <IconPlus style={{ width: 16, height: 16 }} />
            <span className="customers-add-label">Add Contact</span>
          </button>
        </div>

        {/* ── Search ── */}
        <div className="customers-search-wrap">
          <IconSearch style={{ width: 16, height: 16 }} className="customers-search-icon" />
          <input
            ref={searchRef}
            type="text"
            className="input customers-search"
            placeholder="Search by name, phone, email, company..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="customers-search-clear"
              onClick={() => { setSearch(''); searchRef.current?.focus(); }}
            >
              <IconX style={{ width: 14, height: 14 }} />
            </button>
          )}
        </div>

        {/* ── Role Filter Tabs ── */}
        <div className="customers-filters">
          {ROLE_FILTERS.map(f => (
            <button
              key={f.key}
              className={`conv-filter-btn${activeFilter === f.key ? ' active' : ''}`}
              onClick={() => setActiveFilter(f.key)}
            >
              {f.label}
              {tabCounts[f.key] > 0 && (
                <span className="conv-filter-count">{tabCounts[f.key]}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Contact List ── */}
        <div className="customers-list">
          {filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">👤</div>
              <div className="empty-state-title">
                {search ? 'No matches found' : 'No contacts yet'}
              </div>
              <div className="empty-state-text">
                {search
                  ? `No contacts matching "${search}"`
                  : 'Contacts are auto-created from inbound messages, or add them manually.'
                }
              </div>
            </div>
          ) : (
            filtered.map(contact => (
              <ContactCard
                key={contact.id}
                contact={contact}
                jobCount={jobCounts[contact.id] || 0}
                onClick={() => navigate(`/contacts/${contact.id}`)}
              />
            ))
          )}
        </div>

        {/* ── Add Contact Modal ── */}
        {showAddModal && (
          <AddContactModal
            onClose={() => setShowAddModal(false)}
            onSave={handleAddContact}
            carriers={carriers}
          />
        )}
      </div>
    </PullToRefresh>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CONTACT CARD — single row in the list
   ═══════════════════════════════════════════════════════════════════ */

function ContactCard({ contact, jobCount, onClick }) {
  const roleColor = ROLE_COLORS[contact.role] || ROLE_COLORS.other;
  const roleLabel = ROLE_LABELS[contact.role] || contact.role || 'Unknown';

  return (
    <div className="customer-card" onClick={onClick}>
      {/* Avatar */}
      <div className="customer-avatar">
        {getInitials(contact.name)}
      </div>

      {/* Info */}
      <div className="customer-card-body">
        <div className="customer-card-top">
          <span className="customer-card-name">{contact.name || 'Unknown'}</span>
          {contact.dnd && (
            <span className="customer-dnd-badge" title="Do Not Disturb">DND</span>
          )}
        </div>
        {contact.company && (
          <div className="customer-card-company">
            <IconBuilding style={{ width: 12, height: 12, flexShrink: 0 }} />
            {contact.company}
          </div>
        )}
        <div className="customer-card-meta">
          <span className="customer-card-phone">
            <IconPhone style={{ width: 11, height: 11, flexShrink: 0 }} />
            {formatPhone(contact.phone)}
          </span>
          <span
            className="customer-role-tag"
            style={{ background: roleColor.bg, color: roleColor.text }}
          >
            {roleLabel}
          </span>
          {jobCount > 0 && (
            <span className="customer-job-count">
              <IconBriefcase style={{ width: 11, height: 11 }} />
              {jobCount}
            </span>
          )}
        </div>
      </div>

      {/* Chevron */}
      <div className="customer-card-chevron">
        <IconChevronRight style={{ width: 18, height: 18 }} />
      </div>
    </div>
  );
}

