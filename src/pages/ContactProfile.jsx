import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { IconSearch } from '@/components/Icons';
import PullToRefresh from '@/components/PullToRefresh';

/* ═══════════════════════════════════════════════════════════════════
   INLINE ICONS
   ═══════════════════════════════════════════════════════════════════ */

function IconBack(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="15 18 9 12 15 6" /></svg>);
}
function IconPhone(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.88.36 1.72.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c1.09.34 1.93.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>);
}
function IconMail(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>);
}
function IconBuilding(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01" /></svg>);
}
function IconEdit(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>);
}
function IconX(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>);
}
function IconCheck(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="20 6 9 17 4 12" /></svg>);
}
function IconChevronRight(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="9 18 15 12 9 6" /></svg>);
}
function IconMessageCircle(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>);
}

/* ═══════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════ */

const ROLE_LABELS = {
  homeowner: 'Homeowner', adjuster: 'Adjuster', subcontractor: 'Subcontractor',
  property_manager: 'Property Mgr', agent: 'Agent', mortgage_co: 'Mortgage Co',
  tenant: 'Tenant', other: 'Other', vendor: 'Vendor',
  referral_partner: 'Referral', insurance_rep: 'Insurance Rep', broker: 'Broker',
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
  { value: 'homeowner', label: 'Homeowner' }, { value: 'adjuster', label: 'Adjuster' },
  { value: 'subcontractor', label: 'Subcontractor' }, { value: 'vendor', label: 'Vendor' },
  { value: 'agent', label: 'Agent' }, { value: 'property_manager', label: 'Property Manager' },
  { value: 'referral_partner', label: 'Referral Partner' }, { value: 'insurance_rep', label: 'Insurance Rep' },
  { value: 'broker', label: 'Broker' }, { value: 'mortgage_co', label: 'Mortgage Co' },
  { value: 'tenant', label: 'Tenant' }, { value: 'other', label: 'Other' },
];

const DIVISION_EMOJI = { water: '💧', mold: '🦠', reconstruction: '🏗️' };

const CONV_STATUS_CLASS = {
  needs_response: 'needs-response',
  waiting_on_client: 'waiting',
  resolved: 'resolved',
  archived: 'resolved',
};

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
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone;
}

function fmtDate(val) {
  if (!val) return '—';
  return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(val) {
  if (!val) return '—';
  return new Date(val).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtCurrency(val) {
  if (val === null || val === undefined) return '—';
  return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function relativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════ */

export default function ContactProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { db, employee } = useAuth();

  const [contact, setContact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('conversations');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Tab data
  const [conversations, setConversations] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [consentLog, setConsentLog] = useState([]);

  // Edit form
  const [editForm, setEditForm] = useState({});

  // ── Load all data ──
  const loadData = useCallback(async () => {
    try {
      // Core contact
      const contactData = await db.select('contacts', `id=eq.${id}`);
      if (contactData.length === 0) { navigate('/customers', { replace: true }); return; }
      const c = contactData[0];
      setContact(c);
      setEditForm({ name: c.name || '', phone: c.phone || '', email: c.email || '', company: c.company || '', role: c.role || 'homeowner', notes: c.notes || '' });

      // Parallel data fetches
      const [convParts, contactJobs, invoiceData, paymentData, consentData] = await Promise.all([
        // Conversations via participants
        db.select('conversation_participants', `contact_id=eq.${id}&is_active=eq.true&select=conversation_id`).catch(() => []),
        // Jobs via contact_jobs junction
        db.select('contact_jobs', `contact_id=eq.${id}&select=job_id,role,is_primary`).catch(() => []),
        // Invoices directly linked to contact
        db.select('invoices', `contact_id=eq.${id}&order=invoice_date.desc.nullslast&select=id,invoice_number,invoice_date,status,original_total,adjusted_total,balance_due,job_id`).catch(() => []),
        // Payments directly linked to contact
        db.select('payments', `contact_id=eq.${id}&order=payment_date.desc.nullslast&select=id,amount,payment_date,payment_method,payer_type,payer_name,reference_number`).catch(() => []),
        // SMS consent log
        db.select('sms_consent_log', `contact_id=eq.${id}&order=created_at.desc&limit=50`).catch(() => []),
      ]);

      // Fetch full conversation objects
      if (convParts.length > 0) {
        const convIds = convParts.map(p => p.conversation_id);
        const filter = `id=in.(${convIds.join(',')})&order=last_message_at.desc.nullslast&select=id,title,status,last_message_at,last_message_preview,unread_count,job_id`;
        const convData = await db.select('conversations', filter).catch(() => []);
        setConversations(convData);
      } else {
        setConversations([]);
      }

      // Fetch full job objects
      if (contactJobs.length > 0) {
        const jobIds = contactJobs.map(cj => cj.job_id);
        const filter = `id=in.(${jobIds.join(',')})&order=created_at.desc&select=id,job_number,insured_name,phase,division,address,date_of_loss,created_at`;
        const jobData = await db.select('jobs', filter).catch(() => []);
        // Merge role/primary info from junction
        const jobMap = {};
        for (const cj of contactJobs) jobMap[cj.job_id] = cj;
        setJobs(jobData.map(j => ({ ...j, _contactRole: jobMap[j.id]?.role, _isPrimary: jobMap[j.id]?.is_primary })));
      } else {
        setJobs([]);
      }

      setInvoices(invoiceData);
      setPayments(paymentData);
      setConsentLog(consentData);
    } catch (err) {
      console.error('ContactProfile load error:', err);
    } finally {
      setLoading(false);
    }
  }, [db, id, navigate]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Save edits ──
  const handleSave = async () => {
    setSaving(true);
    try {
      let phone = editForm.phone.replace(/\D/g, '');
      if (phone.length === 10) phone = '1' + phone;
      if (!phone.startsWith('+')) phone = '+' + phone;

      const update = {
        name: editForm.name.trim() || null,
        phone,
        email: editForm.email.trim() || null,
        company: editForm.company.trim() || null,
        role: editForm.role,
        notes: editForm.notes.trim() || null,
        updated_at: new Date().toISOString(),
      };
      const result = await db.update('contacts', `id=eq.${id}`, update);
      if (result?.length > 0) setContact(result[0]);
      setEditing(false);
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── DND toggle ──
  const handleToggleDnd = async () => {
    const newDnd = !contact.dnd;
    try {
      const update = {
        dnd: newDnd,
        dnd_at: newDnd ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      };
      await db.update('contacts', `id=eq.${id}`, update);
      setContact(prev => ({ ...prev, ...update }));
    } catch (err) {
      alert('Failed to update DND: ' + err.message);
    }
  };

  // ── Tab counts ──
  const tabDefs = useMemo(() => {
    const tabs = [
      { key: 'conversations', label: 'Conversations', count: conversations.length },
      { key: 'jobs', label: 'Jobs', count: jobs.length },
    ];
    // Financial tab only for homeowners (or always show if invoices exist)
    if (contact?.role === 'homeowner' || invoices.length > 0 || payments.length > 0) {
      tabs.push({ key: 'financial', label: 'Financial', count: invoices.length + payments.length });
    }
    tabs.push({ key: 'activity', label: 'Activity', count: consentLog.length });
    return tabs;
  }, [contact, conversations, jobs, invoices, payments, consentLog]);

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;
  if (!contact) return null;

  const roleColor = ROLE_COLORS[contact.role] || ROLE_COLORS.other;
  const roleLabel = ROLE_LABELS[contact.role] || contact.role;

  return (
    <PullToRefresh onRefresh={loadData}>
      <div className="cp-page">
        {/* ── Top bar ── */}
        <div className="cp-topbar">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/customers')}>
            <IconBack style={{ width: 18, height: 18 }} /> Customers
          </button>
          {!editing && (
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
              <IconEdit style={{ width: 14, height: 14 }} /> Edit
            </button>
          )}
        </div>

        {/* ── Header ── */}
        <div className="cp-header">
          {editing ? (
            <EditHeader
              form={editForm}
              setForm={setEditForm}
              onSave={handleSave}
              onCancel={() => { setEditing(false); setEditForm({ name: contact.name || '', phone: contact.phone || '', email: contact.email || '', company: contact.company || '', role: contact.role || 'homeowner', notes: contact.notes || '' }); }}
              saving={saving}
            />
          ) : (
            <ViewHeader
              contact={contact}
              roleColor={roleColor}
              roleLabel={roleLabel}
              onToggleDnd={handleToggleDnd}
            />
          )}
        </div>

        {/* ── Tabs ── */}
        <div className="cp-tabs">
          {tabDefs.map(t => (
            <button
              key={t.key}
              className={`job-page-tab${activeTab === t.key ? ' active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
              {t.count > 0 && <span className="job-page-tab-count">{t.count}</span>}
            </button>
          ))}
        </div>

        {/* ── Tab Content ── */}
        <div className="cp-content">
          {activeTab === 'conversations' && <ConversationsTab conversations={conversations} navigate={navigate} />}
          {activeTab === 'jobs' && <JobsTab jobs={jobs} navigate={navigate} />}
          {activeTab === 'financial' && <FinancialTab invoices={invoices} payments={payments} />}
          {activeTab === 'activity' && <ActivityTab contact={contact} consentLog={consentLog} />}
        </div>
      </div>
    </PullToRefresh>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   VIEW HEADER — read-only contact info
   ═══════════════════════════════════════════════════════════════════ */

function ViewHeader({ contact, roleColor, roleLabel, onToggleDnd }) {
  return (
    <div className="cp-header-view">
      <div className="cp-header-top">
        {/* Avatar + name + role */}
        <div className="cp-avatar-lg">{getInitials(contact.name)}</div>
        <div className="cp-header-info">
          <h1 className="cp-name">{contact.name || 'Unknown'}</h1>
          {contact.company && (
            <div className="cp-company">
              <IconBuilding style={{ width: 13, height: 13 }} /> {contact.company}
            </div>
          )}
          <span className="customer-role-tag" style={{ background: roleColor.bg, color: roleColor.text, marginTop: 4 }}>
            {roleLabel}
          </span>
        </div>
      </div>

      {/* Contact actions + DND */}
      <div className="cp-header-actions">
        {contact.phone && (
          <a href={`tel:${contact.phone}`} className="cp-action-btn">
            <IconPhone style={{ width: 16, height: 16 }} />
            <span>{formatPhone(contact.phone)}</span>
          </a>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} className="cp-action-btn">
            <IconMail style={{ width: 16, height: 16 }} />
            <span>{contact.email}</span>
          </a>
        )}

        <div className="cp-meta-row">
          {/* Opt-in status */}
          <span className={`cp-opt-badge ${contact.opt_in_status ? 'opted-in' : 'opted-out'}`}>
            {contact.opt_in_status ? 'Opted In' : 'Not Opted In'}
          </span>

          {/* DND toggle */}
          <div className="conv-dnd-row" style={{ flex: 'none' }}>
            <div className="conv-dnd-info">
              <div className="conv-dnd-title">DND</div>
            </div>
            <button className={`conv-dnd-toggle${contact.dnd ? ' on' : ''}`} onClick={onToggleDnd}>
              <div className="conv-dnd-knob" />
            </button>
          </div>
        </div>

        {/* Notes preview */}
        {contact.notes && !contact.notes.match(/^\[DEMO\]$/) && (
          <div className="cp-notes-preview">{contact.notes}</div>
        )}

        {/* Timestamps */}
        <div className="cp-timestamps">
          <span>Added {fmtDate(contact.created_at)}</span>
          {contact.opt_in_at && <span>Opted in {fmtDate(contact.opt_in_at)}</span>}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   EDIT HEADER — inline edit form
   ═══════════════════════════════════════════════════════════════════ */

function EditHeader({ form, setForm, onSave, onCancel, saving }) {
  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }));
  const nameRef = useRef(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  return (
    <div className="cp-edit-form">
      <div className="cp-edit-row">
        <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
          <label className="label">Name</label>
          <input ref={nameRef} className="input" value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
          <label className="label">Phone</label>
          <input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </div>
      </div>
      <div className="cp-edit-row">
        <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
          <label className="label">Email</label>
          <input className="input" value={form.email} onChange={e => set('email', e.target.value)} />
        </div>
        <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
          <label className="label">Company</label>
          <input className="input" value={form.company} onChange={e => set('company', e.target.value)} />
        </div>
      </div>
      <div className="cp-edit-row">
        <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
          <label className="label">Role</label>
          <select className="input" value={form.role} onChange={e => set('role', e.target.value)} style={{ cursor: 'pointer' }}>
            {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="label">Notes</label>
        <textarea className="input textarea" value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} />
      </div>
      <div className="cp-edit-actions">
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CONVERSATIONS TAB
   ═══════════════════════════════════════════════════════════════════ */

function ConversationsTab({ conversations, navigate }) {
  if (conversations.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">💬</div>
        <div className="empty-state-title">No conversations</div>
        <div className="empty-state-text">Start a conversation from the Messages page.</div>
      </div>
    );
  }

  return (
    <div className="cp-conv-list">
      {conversations.map(conv => {
        const statusClass = CONV_STATUS_CLASS[conv.status] || 'active';
        return (
          <div
            key={conv.id}
            className="cp-conv-card"
            onClick={() => navigate('/conversations')}
          >
            <div className="cp-conv-card-left">
              <div className="cp-conv-card-icon">
                <IconMessageCircle style={{ width: 18, height: 18 }} />
              </div>
              <div className="cp-conv-card-body">
                <div className="cp-conv-card-top">
                  <span className="cp-conv-card-title">{conv.title || 'Conversation'}</span>
                  <span className="cp-conv-card-time">{relativeTime(conv.last_message_at)}</span>
                </div>
                <div className="cp-conv-card-preview">{conv.last_message_preview || 'No messages yet'}</div>
              </div>
            </div>
            <div className="cp-conv-card-right">
              <span className={`status-badge status-${statusClass}`}>
                {conv.status?.replace(/_/g, ' ')}
              </span>
              {conv.unread_count > 0 && <span className="conv-unread-badge">{conv.unread_count}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   JOBS TAB
   ═══════════════════════════════════════════════════════════════════ */

function JobsTab({ jobs, navigate }) {
  if (jobs.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🔧</div>
        <div className="empty-state-title">No linked jobs</div>
        <div className="empty-state-text">Jobs are linked when you associate this contact with a job.</div>
      </div>
    );
  }

  return (
    <div className="cp-jobs-list">
      {jobs.map(job => (
        <div
          key={job.id}
          className="job-list-card"
          onClick={() => navigate(`/jobs/${job.id}`)}
        >
          <div className="job-list-card-icon">
            {DIVISION_EMOJI[job.division] || '📁'}
          </div>
          <div className="job-list-card-body">
            <div className="job-list-card-top">
              <span className="job-list-card-name">{job.insured_name || 'Unknown'}</span>
              {job._isPrimary && <span className="cp-primary-badge">Primary</span>}
            </div>
            <div className="job-list-card-row">
              <span className="job-list-card-jobnumber">{job.job_number || '—'}</span>
              {job.division && (
                <span className="division-badge" data-division={job.division}>{job.division}</span>
              )}
              {job._contactRole && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  as {job._contactRole}
                </span>
              )}
            </div>
            {job.address && <div className="job-list-card-address">{job.address}</div>}
            <div className="job-list-card-meta">
              {job.phase && <span>{job.phase.replace(/_/g, ' ')}</span>}
              {job.date_of_loss && <span>Loss {fmtDate(job.date_of_loss)}</span>}
            </div>
          </div>
          <div className="job-list-card-chevron">›</div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   FINANCIAL TAB
   ═══════════════════════════════════════════════════════════════════ */

function FinancialTab({ invoices, payments }) {
  const totalInvoiced = invoices.reduce((sum, inv) => sum + Number(inv.adjusted_total || inv.original_total || 0), 0);
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const totalOutstanding = invoices.reduce((sum, inv) => sum + Number(inv.balance_due || 0), 0);

  return (
    <div className="cp-financial">
      {/* Summary cards */}
      <div className="cp-fin-summary">
        <div className="cp-fin-stat">
          <div className="cp-fin-stat-label">Invoiced</div>
          <div className="cp-fin-stat-value">{fmtCurrency(totalInvoiced)}</div>
        </div>
        <div className="cp-fin-stat">
          <div className="cp-fin-stat-label">Paid</div>
          <div className="cp-fin-stat-value" style={{ color: 'var(--status-resolved)' }}>{fmtCurrency(totalPaid)}</div>
        </div>
        <div className="cp-fin-stat">
          <div className="cp-fin-stat-label">Outstanding</div>
          <div className="cp-fin-stat-value" style={{ color: totalOutstanding > 0 ? 'var(--status-waiting)' : 'var(--text-primary)' }}>
            {fmtCurrency(totalOutstanding)}
          </div>
        </div>
      </div>

      {/* Invoices */}
      <div className="cp-fin-section">
        <div className="job-page-section-title">Invoices</div>
        {invoices.length === 0 ? (
          <div className="cp-fin-empty">No invoices</div>
        ) : (
          invoices.map(inv => (
            <div key={inv.id} className="cp-fin-row">
              <div className="cp-fin-row-left">
                <span className="cp-fin-row-label" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  #{inv.invoice_number || '—'}
                </span>
                <span className="cp-fin-row-date">{fmtDate(inv.invoice_date)}</span>
              </div>
              <div className="cp-fin-row-right">
                <span className="cp-fin-row-amount">{fmtCurrency(inv.adjusted_total || inv.original_total)}</span>
                <span className={`status-badge status-${inv.status === 'paid' ? 'resolved' : inv.status === 'overdue' ? 'needs-response' : 'waiting'}`}>
                  {inv.status || 'draft'}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Payments */}
      <div className="cp-fin-section">
        <div className="job-page-section-title">Payments</div>
        {payments.length === 0 ? (
          <div className="cp-fin-empty">No payments</div>
        ) : (
          payments.map(p => (
            <div key={p.id} className="cp-fin-row">
              <div className="cp-fin-row-left">
                <span className="cp-fin-row-label">{p.payer_name || p.payer_type || 'Payment'}</span>
                <span className="cp-fin-row-date">{fmtDate(p.payment_date)}</span>
              </div>
              <div className="cp-fin-row-right">
                <span className="cp-fin-row-amount" style={{ color: 'var(--status-resolved)' }}>
                  +{fmtCurrency(p.amount)}
                </span>
                {p.payment_method && (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{p.payment_method}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ACTIVITY TAB — consent log + system events
   ═══════════════════════════════════════════════════════════════════ */

function ActivityTab({ contact, consentLog }) {
  // Build timeline from consent log + key contact events
  const timeline = useMemo(() => {
    const items = [];

    // Consent log entries
    for (const entry of consentLog) {
      items.push({
        id: entry.id,
        type: 'consent',
        date: entry.created_at,
        event: entry.event_type?.replace(/_/g, ' ') || 'Event',
        detail: entry.details || '',
        source: entry.source,
      });
    }

    // Contact creation
    items.push({
      id: 'created',
      type: 'system',
      date: contact.created_at,
      event: 'Contact created',
      detail: contact.opt_in_source ? `Source: ${contact.opt_in_source}` : '',
    });

    // Opt-in
    if (contact.opt_in_at) {
      items.push({
        id: 'opt_in',
        type: 'consent',
        date: contact.opt_in_at,
        event: 'Opted in',
        detail: contact.opt_in_source ? `via ${contact.opt_in_source}` : '',
      });
    }

    // Opt-out
    if (contact.opt_out_at) {
      items.push({
        id: 'opt_out',
        type: 'consent',
        date: contact.opt_out_at,
        event: 'Opted out',
        detail: contact.opt_out_reason || '',
      });
    }

    // DND
    if (contact.dnd && contact.dnd_at) {
      items.push({
        id: 'dnd',
        type: 'dnd',
        date: contact.dnd_at,
        event: 'DND enabled',
        detail: '',
      });
    }

    items.sort((a, b) => new Date(b.date) - new Date(a.date));
    return items;
  }, [contact, consentLog]);

  if (timeline.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📋</div>
        <div className="empty-state-title">No activity</div>
        <div className="empty-state-text">Consent changes and system events will appear here.</div>
      </div>
    );
  }

  return (
    <div className="cp-activity">
      <div className="job-page-timeline">
        {timeline.map(item => (
          <div key={item.id} className={`job-page-timeline-item timeline-${item.type}`}>
            <div className="job-page-timeline-dot" />
            <div className="job-page-timeline-content">
              <div className="job-page-timeline-header">
                <span className="job-page-timeline-author" style={{ textTransform: 'capitalize' }}>{item.event}</span>
                <span className="job-page-timeline-time">{fmtDateTime(item.date)}</span>
              </div>
              {item.detail && (
                <div className="job-page-timeline-text">{item.detail}</div>
              )}
              {item.source && (
                <div className="job-page-timeline-text" style={{ fontStyle: 'italic' }}>Source: {item.source}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
