import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { IconSearch } from '@/components/Icons';
import PullToRefresh from '@/components/PullToRefresh';

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

const CONTACT_METHOD_OPTIONS = [
  { value: 'sms', label: 'SMS' },
  { value: 'call', label: 'Phone Call' },
  { value: 'email', label: 'Email' },
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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);

  const searchRef = useRef(null);

  // ── Load data ──
  const loadData = useCallback(async () => {
    try {
      const [contactsData, contactJobsData] = await Promise.all([
        db.select('contacts', 'order=name.asc.nullslast&select=id,name,phone,email,company,role,opt_in_status,dnd,created_at'),
        db.select('contact_jobs', 'select=contact_id').catch(() => []),
      ]);
      setContacts(contactsData);

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

/* ═══════════════════════════════════════════════════════════════════
   ADD CONTACT MODAL
   ═══════════════════════════════════════════════════════════════════ */

function AddContactModal({ onClose, onSave }) {
  const [step, setStep] = useState('pick'); // 'pick' | 'form'
  const [role, setRole] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);

  const ROLE_CARDS = [
    { value: 'homeowner', emoji: '\u{1F3E0}', label: 'Homeowner', desc: 'Property owner, policyholder, client' },
    { value: 'adjuster', emoji: '\u{1F4CB}', label: 'Adjuster', desc: 'Insurance field or desk adjuster' },
    { value: 'vendor', emoji: '\u{1F3E2}', label: 'Vendor', desc: 'Material supplier, equipment provider' },
    { value: 'subcontractor', emoji: '\u{1F527}', label: 'Subcontractor', desc: 'Trade contractor, specialist' },
    { value: 'agent', emoji: '\u{1F91D}', label: 'Agent / Broker', desc: 'Insurance or real estate agent' },
    { value: 'property_manager', emoji: '\u{1F3E8}', label: 'Property Manager', desc: 'Manages rental or commercial property' },
    { value: 'referral_partner', emoji: '\u{2B50}', label: 'Referral Partner', desc: 'Plumber, roofer, referral source' },
    { value: 'tenant', emoji: '\u{1F6CF}\uFE0F', label: 'Tenant', desc: 'Occupant of affected property' },
    { value: 'other', emoji: '\u{1F464}', label: 'Other', desc: 'Mortgage co, insurance rep, etc.' },
  ];

  const initForm = (r) => {
    const base = { name: '', phone: '', email: '', company: '', role: r, preferred_contact_method: 'sms', preferred_language: 'en', referral_source: '', tags: '', notes: '' };
    if (r === 'homeowner') return { ...base, billing_address: '', billing_city: '', billing_state: '', billing_zip: '', insurance_carrier: '', policy_number: '' };
    if (r === 'adjuster') return { ...base, company: '', desk_phone: '', desk_extension: '', territory: '', relationship_notes: '', insurance_carrier: '' };
    if (r === 'vendor') return { ...base, trade_specialty: '', payment_terms: 'net_30', w9_on_file: false };
    if (r === 'subcontractor') return { ...base, trade_specialty: '', payment_terms: 'net_30', coi_expiration: '', w9_on_file: false };
    return base;
  };

  const selectRole = (r) => { setRole(r); setForm(initForm(r)); setStep('form'); setTimeout(() => nameRef.current?.focus(), 50); };
  const set = (f, v) => setForm(prev => ({ ...prev, [f]: v }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.phone.trim()) return;
    setSaving(true);
    try {
      let phone = form.phone.replace(/\D/g, '');
      if (phone.length === 10) phone = '1' + phone;
      if (!phone.startsWith('+')) phone = '+' + phone;

      let deskPh = (form.desk_phone || '').replace(/\D/g, '');
      if (deskPh && deskPh.length === 10) deskPh = '1' + deskPh;
      if (deskPh && !deskPh.startsWith('+')) deskPh = '+' + deskPh;

      const tags = (form.tags || '').split(',').map(t => t.trim()).filter(Boolean);

      const data = {
        name: form.name.trim(), phone, role: form.role,
        email: form.email.trim() || null,
        company: form.company.trim() || null,
        preferred_contact_method: form.preferred_contact_method,
        preferred_language: form.preferred_language || 'en',
        referral_source: form.referral_source?.trim() || null,
        tags: JSON.stringify(tags),
        notes: form.notes?.trim() || null,
        opt_in_status: false,
      };

      // Role-specific fields
      if (form.role === 'homeowner') {
        Object.assign(data, {
          billing_address: form.billing_address?.trim() || null,
          billing_city: form.billing_city?.trim() || null,
          billing_state: form.billing_state?.trim() || null,
          billing_zip: form.billing_zip?.trim() || null,
          insurance_carrier: form.insurance_carrier?.trim() || null,
          policy_number: form.policy_number?.trim() || null,
        });
      }
      if (form.role === 'adjuster') {
        Object.assign(data, {
          insurance_carrier: form.insurance_carrier?.trim() || null,
          desk_phone: deskPh || null,
          desk_extension: form.desk_extension?.trim() || null,
          territory: form.territory?.trim() || null,
          relationship_notes: form.relationship_notes?.trim() || null,
        });
      }
      if (form.role === 'vendor' || form.role === 'subcontractor') {
        Object.assign(data, {
          trade_specialty: form.trade_specialty?.trim() || null,
          payment_terms: form.payment_terms || 'net_30',
          w9_on_file: form.w9_on_file || false,
        });
        if (form.role === 'subcontractor' && form.coi_expiration) {
          data.coi_expiration = form.coi_expiration;
        }
      }

      await onSave(data);
    } catch (err) { /* handled in parent */ }
    finally { setSaving(false); }
  };

  const Field = ({ label, field, type = 'text', placeholder, required }) => (
    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
      <label className="label">{label}{required && ' *'}</label>
      {type === 'textarea' ? (
        <textarea className="input textarea" value={form[field] || ''} onChange={e => set(field, e.target.value)} rows={2} placeholder={placeholder} />
      ) : type === 'checkbox' ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
          <input type="checkbox" checked={form[field] || false} onChange={e => set(field, e.target.checked)} style={{ width: 16, height: 16 }} />
          {placeholder || label}
        </label>
      ) : (
        <input ref={field === 'name' ? nameRef : undefined} className="input" type={type} value={form[field] || ''} onChange={e => set(field, e.target.value)} placeholder={placeholder} />
      )}
    </div>
  );

  const Select = ({ label, field, options }) => (
    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
      <label className="label">{label}</label>
      <select className="input" value={form[field] || ''} onChange={e => set(field, e.target.value)} style={{ cursor: 'pointer' }}>
        {options.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
    </div>
  );

  const PAYMENT_TERMS = [{ value: 'due_on_receipt', label: 'Due on Receipt' }, { value: 'net_15', label: 'Net 15' }, { value: 'net_30', label: 'Net 30' }, { value: 'net_45', label: 'Net 45' }, { value: 'net_60', label: 'Net 60' }];
  const LANG_OPTIONS = [{ value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' }, { value: 'pt', label: 'Portuguese' }];

  return (
    <div className="conv-modal-backdrop" onClick={onClose}>
      <div className="conv-modal add-contact-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="conv-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {step === 'form' && (
              <button className="btn btn-ghost btn-sm" onClick={() => setStep('pick')} style={{ width: 28, height: 28, padding: 0 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}><polyline points="15 18 9 12 15 6" /></svg>
              </button>
            )}
            <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>
              {step === 'pick' ? 'New Contact' : `New ${ROLE_LABELS[role] || 'Contact'}`}
            </span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ width: 32, height: 32, padding: 0 }}>
            <IconX style={{ width: 18, height: 18 }} />
          </button>
        </div>

        {step === 'pick' ? (
          /* ── Step 1: Role picker ── */
          <div className="add-contact-body">
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
              What type of contact is this?
            </div>
            <div className="role-picker-grid">
              {ROLE_CARDS.map(rc => (
                <button key={rc.value} className="role-picker-card" onClick={() => selectRole(rc.value)}>
                  <span className="role-picker-emoji">{rc.emoji}</span>
                  <div className="role-picker-text">
                    <div className="role-picker-label">{rc.label}</div>
                    <div className="role-picker-desc">{rc.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ── Step 2: Role-specific form ── */
          <>
            <div className="add-contact-body">
              {/* Always shown */}
              <div className="cp-edit-section-label" style={{ marginTop: 0 }}>Basic Info</div>
              <div className="add-contact-row"><Field label="Name" field="name" placeholder="Full name" required /><Field label="Phone" field="phone" type="tel" placeholder="(801) 555-1234" required /></div>
              <div className="add-contact-row"><Field label="Email" field="email" type="email" placeholder="email@example.com" /><Field label="Company" field="company" placeholder={role === 'adjuster' ? 'Carrier name' : role === 'vendor' ? 'Company name' : 'Company (optional)'} /></div>
              <div className="add-contact-row">
                <Select label="Preferred Contact" field="preferred_contact_method" options={CONTACT_METHOD_OPTIONS} />
                <Select label="Language" field="preferred_language" options={LANG_OPTIONS} />
              </div>

              {/* Homeowner fields */}
              {role === 'homeowner' && (<>
                <div className="cp-edit-section-label">Billing Address</div>
                <div className="add-contact-row"><Field label="Street" field="billing_address" placeholder="1422 E Maple Ridge Dr" /></div>
                <div className="add-contact-row"><Field label="City" field="billing_city" placeholder="Lehi" /><Field label="State" field="billing_state" placeholder="UT" /><Field label="ZIP" field="billing_zip" placeholder="84043" /></div>
                <div className="cp-edit-section-label">Insurance</div>
                <div className="add-contact-row"><Field label="Carrier" field="insurance_carrier" placeholder="State Farm, Allstate..." /><Field label="Policy #" field="policy_number" placeholder="SF-8820114" /></div>
              </>)}

              {/* Adjuster fields */}
              {role === 'adjuster' && (<>
                <div className="cp-edit-section-label">Adjuster Details</div>
                <div className="add-contact-row"><Field label="Carrier" field="insurance_carrier" placeholder="State Farm, Allstate..." required /></div>
                <div className="add-contact-row"><Field label="Desk Phone" field="desk_phone" type="tel" placeholder="(800) 555-0100" /><Field label="Extension" field="desk_extension" placeholder="4412" /></div>
                <div className="add-contact-row"><Field label="Territory / Region" field="territory" placeholder="Northern Utah - Salt Lake, Davis, Weber" /></div>
                <Field label="Relationship Notes" field="relationship_notes" type="textarea" placeholder="Response time, negotiation style, preferences..." />
              </>)}

              {/* Vendor fields */}
              {role === 'vendor' && (<>
                <div className="cp-edit-section-label">Vendor Details</div>
                <div className="add-contact-row"><Field label="Trade / Specialty" field="trade_specialty" placeholder="Flooring, plumbing, electrical..." /><Select label="Payment Terms" field="payment_terms" options={PAYMENT_TERMS} /></div>
                <div className="add-contact-row"><Field label="W-9 on File" field="w9_on_file" type="checkbox" placeholder="W-9 received and on file" /></div>
              </>)}

              {/* Subcontractor fields */}
              {role === 'subcontractor' && (<>
                <div className="cp-edit-section-label">Subcontractor Details</div>
                <div className="add-contact-row"><Field label="Trade / Specialty" field="trade_specialty" placeholder="Drywall, painting, tile..." /><Select label="Payment Terms" field="payment_terms" options={PAYMENT_TERMS} /></div>
                <div className="add-contact-row"><Field label="COI Expiration" field="coi_expiration" type="date" /><Field label="W-9 on File" field="w9_on_file" type="checkbox" placeholder="W-9 received and on file" /></div>
              </>)}

              {/* Always at bottom */}
              <div className="cp-edit-section-label">Other</div>
              <div className="add-contact-row"><Field label="Referral Source" field="referral_source" placeholder="Google, agent name..." /><Field label="Tags" field="tags" placeholder="VIP, repeat, priority" /></div>
              <Field label="Notes" field="notes" type="textarea" placeholder="Internal notes..." />
            </div>

            <div className="add-contact-footer">
              <button className="btn btn-secondary" onClick={() => setStep('pick')}>Back</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.name?.trim() || !form.phone?.trim()}>
                {saving ? 'Saving...' : 'Add Contact'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
