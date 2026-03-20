import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import EditContactModal from '@/components/EditContactModal';
import AddRelatedJobModal from '@/components/AddRelatedJobModal';

/* ═══ ICONS ═══ */
function IconPhone(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>);}
function IconMail(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>);}
function IconMsg(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>);}
function IconEdit(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>);}
function IconPlus(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);}

const DIVISION_EMOJI = { water: '💧', mold: '🦠', reconstruction: '🏗️', fire: '🔥', contents: '📦' };
const DIVISION_COLORS = { water: '#2563eb', mold: '#9d174d', reconstruction: '#d97706', fire: '#dc2626', contents: '#059669' };
const ROLE_LABELS = { homeowner: 'Homeowner', tenant: 'Tenant', property_manager: 'Property Manager' };
const LANG_LABELS = { en: 'English', es: 'Spanish', pt: 'Portuguese' };
const PHASE_STYLES = {
  job_received: { label: 'Received', bg: '#fff7ed', color: '#ea580c' },
  mitigation_in_progress: { label: 'Mitigation', bg: '#eff6ff', color: '#2563eb' },
  drying: { label: 'Drying', bg: '#eff6ff', color: '#2563eb' },
  monitoring: { label: 'Monitoring', bg: '#eff6ff', color: '#2563eb' },
  reconstruction_in_progress: { label: 'In Progress', bg: '#eff6ff', color: '#2563eb' },
  reconstruction_punch_list: { label: 'Punch List', bg: '#fef9c3', color: '#a16207' },
  completed: { label: 'Completed', bg: '#ecfdf5', color: '#10b981' },
  closed: { label: 'Closed', bg: '#f1f3f5', color: '#6b7280' },
  invoiced: { label: 'Invoiced', bg: '#f0f9ff', color: '#0369a1' },
  paid: { label: 'Paid', bg: '#ecfdf5', color: '#059669' },
};
function getPhaseStyle(p) { return PHASE_STYLES[p] || { label: p?.replace(/_/g, ' ') || '—', bg: '#f1f3f5', color: '#6b7280' }; }

export default function CustomerPage() {
  const { contactId } = useParams();
  const navigate = useNavigate();
  const { db } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [showEdit, setShowEdit] = useState(false);
  const [carriers, setCarriers] = useState([]);
  const [employees, setEmployees] = useState([]);

  // For Add Related Job modal
  const [addRelatedSource, setAddRelatedSource] = useState(null); // { job, claimData, siblings }

  useEffect(() => { loadData(); }, [contactId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const result = await db.rpc('get_customer_detail', { p_contact_id: contactId });
      if (!result?.contact) { navigate('/customers', { replace: true }); return; }
      setData(result);
      // Lazy load carriers + employees
      db.select('insurance_carriers', 'order=name.asc&select=id,name,short_name').then(setCarriers).catch(() => {});
      db.select('employees', 'is_active=eq.true&order=full_name.asc&select=id,full_name,role').then(setEmployees).catch(() => {});
    } catch (err) {
      console.error('Customer load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveContact = async (updatedFields) => {
    await db.update('contacts', `id=eq.${contactId}`, updatedFields);
    setShowEdit(false);
    loadData();
  };

  // Helpers
  const fmtPhone = (phone) => {
    if (!phone) return '';
    const d = phone.replace(/\D/g, '');
    const n = d.startsWith('1') ? d.slice(1) : d;
    if (n.length === 10) return `(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}`;
    return phone;
  };
  const fmtDate = (val) => {
    if (!val) return '—';
    return new Date(val + (val.includes('T') ? '' : 'T00:00:00')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const fmtCurrency = (val) => {
    if (val === null || val === undefined) return '$0';
    return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };
  const fmtCurrency2 = (val) => {
    if (val === null || val === undefined) return '—';
    return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;
  if (!data) return null;

  const c = data.contact;
  const claims = data.claims || [];
  const fin = data.financials || {};
  const files = data.files || [];
  const activity = data.activity || [];
  const initials = c.name ? c.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?';

  const totalJobs = claims.reduce((s, cl) => s + (cl.jobs?.length || 0), 0);

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'claims', label: 'Claims & Jobs', count: totalJobs },
    { key: 'financial', label: 'Financial' },
    { key: 'files', label: 'Files', count: files.length },
    { key: 'activity', label: 'Activity', count: activity.length },
  ];

  return (
    <div className="job-page">
      {/* ══ Top Bar ══ */}
      <div className="job-page-topbar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/customers')} style={{ gap: 4 }}>← Customers</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowEdit(true)} style={{ gap: 4 }}>
          <IconEdit style={{ width: 13, height: 13 }} /> Edit
        </button>
      </div>

      {/* ══ Header ══ */}
      <div className="job-page-header">
        <div className="job-page-header-left">
          <div className="customer-card-avatar" style={{ width: 48, height: 48, fontSize: 16 }}>{initials}</div>
          <div>
            <div className="job-page-client" style={{ fontSize: 'var(--text-xl)' }}>{c.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <span className="customer-card-role-badge">{ROLE_LABELS[c.role] || c.role}</span>
              {c.dnd && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: '#fef2f2', color: '#ef4444' }}>DND</span>}
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{totalJobs} job{totalJobs !== 1 ? 's' : ''} · {claims.length} claim{claims.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {c.phone && <a href={`tel:${c.phone}`} className="customer-action-btn"><IconPhone style={{ width: 16, height: 16 }} />Call</a>}
          {c.phone && <button className="customer-action-btn" onClick={() => navigate('/conversations')}><IconMsg style={{ width: 16, height: 16 }} />Text</button>}
          {c.email && <a href={`mailto:${c.email}`} className="customer-action-btn"><IconMail style={{ width: 16, height: 16 }} />Email</a>}
        </div>
      </div>

      {/* ══ Tabs ══ */}
      <div className="job-page-tabs">
        {TABS.map(tab => (
          <button key={tab.key} className={`job-page-tab${activeTab === tab.key ? ' active' : ''}`} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
            {tab.count > 0 && <span className="job-page-tab-count">{tab.count}</span>}
          </button>
        ))}
      </div>

      {/* ══ Tab Content ══ */}
      <PullToRefresh onRefresh={loadData} className="job-page-content">
        {activeTab === 'overview' && <OverviewTab contact={c} fmtPhone={fmtPhone} fmtDate={fmtDate} />}
        {activeTab === 'claims' && (
          <ClaimsTab claims={claims} fmtDate={fmtDate} fmtCurrency={fmtCurrency}
            onNavigateJob={(id) => navigate(`/jobs/${id}`)}
            onAddRelatedJob={(job, claim, siblings) => setAddRelatedSource({ job, claimData: claim, siblings })} />
        )}
        {activeTab === 'financial' && <FinancialTab fin={fin} claims={claims} fmtCurrency2={fmtCurrency2} onNavigateJob={(id) => navigate(`/jobs/${id}`)} />}
        {activeTab === 'files' && <FilesTab files={files} fmtDate={fmtDate} db={db} />}
        {activeTab === 'activity' && <ActivityTab activity={activity} fmtDate={fmtDate} />}
      </PullToRefresh>

      {/* Edit Modal */}
      {showEdit && (
        <EditContactModal contact={c} carriers={carriers} onClose={() => setShowEdit(false)} onSave={handleSaveContact} />
      )}

      {/* Add Related Job Modal */}
      {addRelatedSource && (
        <AddRelatedJobModal
          sourceJob={addRelatedSource.job}
          claimData={addRelatedSource.claimData}
          siblingJobs={addRelatedSource.siblings}
          employees={employees}
          db={db}
          onClose={() => setAddRelatedSource(null)}
          onCreated={(result) => {
            setAddRelatedSource(null);
            if (result?.job?.id) navigate(`/jobs/${result.job.id}`);
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   OVERVIEW TAB
   ═══════════════════════════════════════════════════ */
function OverviewTab({ contact, fmtPhone, fmtDate }) {
  const c = contact;
  const hasAddress = c.billing_address || c.billing_city;
  return (
    <div className="job-page-grid">
      {/* Contact Info */}
      <div className="job-page-section">
        <div className="job-page-section-title">Contact Information</div>
        <InfoRow label="Phone" value={fmtPhone(c.phone)} href={`tel:${c.phone}`} />
        {c.phone_secondary && <InfoRow label="Secondary Phone" value={fmtPhone(c.phone_secondary)} href={`tel:${c.phone_secondary}`} />}
        <InfoRow label="Email" value={c.email} href={c.email ? `mailto:${c.email}` : null} />
        <InfoRow label="Company" value={c.company} />
        <InfoRow label="Preferred Contact" value={c.preferred_contact_method?.toUpperCase()} />
        {c.preferred_language && c.preferred_language !== 'en' && (
          <InfoRow label="Language" value={LANG_LABELS[c.preferred_language] || c.preferred_language} />
        )}
        <InfoRow label="Referral Source" value={c.referral_source} />
      </div>

      {/* Address */}
      <div className="job-page-section">
        <div className="job-page-section-title">Billing Address</div>
        {hasAddress ? (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', lineHeight: 1.6 }}>
            {c.billing_address && <div>{c.billing_address}</div>}
            <div>{[c.billing_city, c.billing_state, c.billing_zip].filter(Boolean).join(', ')}</div>
          </div>
        ) : (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No address on file</div>
        )}
      </div>

      {/* Insurance */}
      <div className="job-page-section">
        <div className="job-page-section-title">Insurance</div>
        <InfoRow label="Carrier" value={c.insurance_carrier} />
        <InfoRow label="Policy #" value={c.policy_number} />
      </div>

      {/* Tags */}
      {c.tags && Array.isArray(c.tags) && c.tags.length > 0 && (
        <div className="job-page-section">
          <div className="job-page-section-title">Tags</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
            {c.tags.map((t, i) => (
              <span key={i} style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 99,
                background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{t}</span>
            ))}
          </div>
        </div>
      )}

      {/* Notes — full width */}
      <div className="job-page-section job-page-section-full">
        <div className="job-page-section-title">Notes</div>
        <div style={{ fontSize: 'var(--text-sm)', color: c.notes ? 'var(--text-secondary)' : 'var(--text-tertiary)',
          lineHeight: 1.5, whiteSpace: 'pre-wrap', fontStyle: c.notes ? 'normal' : 'italic' }}>
          {c.notes || 'No notes'}
        </div>
      </div>

      {/* Meta */}
      <div className="job-page-section job-page-section-full" style={{ opacity: 0.5 }}>
        <InfoRow label="Created" value={fmtDate(c.created_at)} />
        <InfoRow label="Updated" value={fmtDate(c.updated_at)} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   CLAIMS & JOBS TAB
   ═══════════════════════════════════════════════════ */
function ClaimsTab({ claims, fmtDate, fmtCurrency, onNavigateJob, onAddRelatedJob }) {
  if (claims.length === 0) {
    return (
      <div className="empty-state" style={{ paddingTop: 40 }}>
        <div className="empty-state-icon">📋</div>
        <div className="empty-state-text">No claims yet</div>
        <div className="empty-state-sub">Create a job from the Jobs page to start</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {claims.map(claim => {
        const jobs = claim.jobs || [];
        return (
          <div key={claim.id} className="job-page-section" style={{ padding: 0, overflow: 'hidden' }}>
            {/* Claim header */}
            <div style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--bg-secondary)',
              borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{claim.claim_number}</span>
              {claim.insurance_carrier && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{claim.insurance_carrier}</span>}
              {claim.date_of_loss && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Loss: {fmtDate(claim.date_of_loss)}</span>}
              {claim.insurance_claim_number && (
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Ins. Claim#: {claim.insurance_claim_number}</span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
                background: claim.status === 'open' ? '#eff6ff' : claim.status === 'closed' ? '#f1f3f5' : '#fffbeb',
                color: claim.status === 'open' ? '#2563eb' : claim.status === 'closed' ? '#6b7280' : '#d97706' }}>
                {claim.status}
              </span>
            </div>

            {/* Address */}
            {claim.loss_address && (
              <div style={{ padding: 'var(--space-2) var(--space-4)', fontSize: 12, color: 'var(--text-tertiary)',
                borderBottom: '1px solid var(--border-light)' }}>
                📍 {claim.loss_address}{claim.loss_city ? `, ${claim.loss_city}` : ''}{claim.loss_state ? ` ${claim.loss_state}` : ''}
              </div>
            )}

            {/* Jobs under this claim */}
            <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
              {jobs.map(j => {
                const ps = getPhaseStyle(j.phase);
                const divColor = DIVISION_COLORS[j.division] || '#6b7280';
                const emoji = DIVISION_EMOJI[j.division] || '📁';
                const est = j.estimated_value || j.approved_value;
                return (
                  <div key={j.id} onClick={() => onNavigateJob(j.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                      padding: 'var(--space-3)', marginBottom: 'var(--space-2)',
                      background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-light)', borderLeft: `3px solid ${divColor}`,
                      cursor: 'pointer', transition: 'border-color 0.15s' }}>
                    <span style={{ fontSize: 18 }}>{emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{j.job_number || 'New'}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{j.division?.replace(/_/g, ' ')}</span>
                      </div>
                      {est > 0 && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>{fmtCurrency(est)}</div>}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: ps.bg, color: ps.color, whiteSpace: 'nowrap' }}>
                      {ps.label}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--brand-primary)', fontWeight: 600 }}>→</span>
                  </div>
                );
              })}

              {/* Add Related Job button */}
              <button className="btn btn-ghost btn-sm" onClick={() => {
                const firstJob = jobs[0];
                if (firstJob) onAddRelatedJob(firstJob, claim, jobs);
              }}
                style={{ width: '100%', justifyContent: 'center', gap: 4, marginTop: 'var(--space-1)',
                  color: 'var(--brand-primary)', fontSize: 12 }}>
                <IconPlus style={{ width: 12, height: 12 }} /> Add Related Job
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   FINANCIAL TAB
   ═══════════════════════════════════════════════════ */
function FinancialTab({ fin, claims, fmtCurrency2, onNavigateJob }) {
  const totalCost = Number(fin.total_labor_cost || 0) + Number(fin.total_material_cost || 0) +
    Number(fin.total_equipment_cost || 0) + Number(fin.total_sub_cost || 0) + Number(fin.total_other_cost || 0);
  const revenueBase = Number(fin.total_approved || 0) > 0 ? Number(fin.total_approved) : Number(fin.total_estimated || 0);
  const grossProfit = revenueBase - totalCost;
  const margin = revenueBase > 0 ? ((grossProfit / revenueBase) * 100).toFixed(1) : '0.0';
  const outstanding = Number(fin.total_invoiced || 0) - Number(fin.total_collected || 0);

  // Flatten all jobs from claims for the per-job breakdown
  const allJobs = claims.flatMap(cl => (cl.jobs || []).map(j => ({ ...j, claim_number: cl.claim_number })));

  return (
    <div className="job-page-financial">
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
        <SummaryCard label="Estimated" value={fmtCurrency2(fin.total_estimated)} />
        <SummaryCard label="Approved" value={fmtCurrency2(fin.total_approved)} />
        <SummaryCard label="Invoiced" value={fmtCurrency2(fin.total_invoiced)} />
        <SummaryCard label="Collected" value={fmtCurrency2(fin.total_collected)} color="#059669" />
        {outstanding > 0 && <SummaryCard label="Outstanding" value={fmtCurrency2(outstanding)} color="#d97706" />}
      </div>

      {/* Aggregate Revenue */}
      <div className="job-page-section">
        <div className="job-page-section-title">Revenue (All Jobs)</div>
        <FinRow label="Total Estimated" value={fmtCurrency2(fin.total_estimated)} />
        <FinRow label="Total Approved" value={fmtCurrency2(fin.total_approved)} />
        <FinRow label="Total Invoiced" value={fmtCurrency2(fin.total_invoiced)} />
        <FinRow label="Total Collected" value={fmtCurrency2(fin.total_collected)} />
      </div>

      {/* Insurance */}
      <div className="job-page-section">
        <div className="job-page-section-title">Insurance (All Jobs)</div>
        <FinRow label="Total Deductible" value={fmtCurrency2(fin.total_deductible)} />
        <FinRow label="Depreciation Held" value={fmtCurrency2(fin.total_depreciation_held)} />
        <FinRow label="Depreciation Released" value={fmtCurrency2(fin.total_depreciation_released)} />
        <FinRow label="Supplement" value={fmtCurrency2(fin.total_supplement)} />
      </div>

      {/* Costs */}
      <div className="job-page-section">
        <div className="job-page-section-title">Cost Breakdown</div>
        <FinRow label="Labor" value={fmtCurrency2(fin.total_labor_cost)} />
        <FinRow label="Materials" value={fmtCurrency2(fin.total_material_cost)} />
        <FinRow label="Equipment" value={fmtCurrency2(fin.total_equipment_cost)} />
        <FinRow label="Subcontractors" value={fmtCurrency2(fin.total_sub_cost)} />
        <FinRow label="Other" value={fmtCurrency2(fin.total_other_cost)} />
        <div className="job-page-fin-divider" />
        <FinRow label="Total Cost" value={fmtCurrency2(totalCost)} bold />
      </div>

      {/* Profitability */}
      <div className="job-page-section">
        <div className="job-page-section-title">Profitability</div>
        <FinRow label={Number(fin.total_approved) > 0 ? 'Approved Revenue' : 'Estimated Revenue'} value={fmtCurrency2(revenueBase)} />
        <FinRow label="Total Cost" value={fmtCurrency2(totalCost)} />
        <div className="job-page-fin-divider" />
        <FinRow label="Gross Profit" value={fmtCurrency2(grossProfit)} bold color={grossProfit >= 0 ? '#10b981' : '#ef4444'} />
        <FinRow label="Margin" value={`${margin}%`} bold color={grossProfit >= 0 ? '#10b981' : '#ef4444'} />
        {outstanding > 0 && <FinRow label="Outstanding" value={fmtCurrency2(outstanding)} color="#d97706" bold />}
      </div>

      {/* Per-Job Breakdown */}
      {allJobs.length > 1 && (
        <div className="job-page-section job-page-section-full">
          <div className="job-page-section-title">Per-Job Breakdown</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                  <th style={thStyle}>Job</th>
                  <th style={thStyle}>Division</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Estimated</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Approved</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Invoiced</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Collected</th>
                </tr>
              </thead>
              <tbody>
                {allJobs.map(j => (
                  <tr key={j.id} style={{ borderBottom: '1px solid var(--border-light)', cursor: 'pointer' }}
                    onClick={() => onNavigateJob(j.id)}>
                    <td style={tdStyle}><span style={{ fontWeight: 600, color: 'var(--brand-primary)' }}>{j.job_number || '—'}</span></td>
                    <td style={tdStyle}>{DIVISION_EMOJI[j.division] || ''} {j.division}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtCurrency2(j.estimated_value)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtCurrency2(j.approved_value)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtCurrency2(j.invoiced_value)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtCurrency2(j.collected_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   FILES TAB
   ═══════════════════════════════════════════════════ */
function FilesTab({ files, fmtDate, db }) {
  if (files.length === 0) {
    return (
      <div className="empty-state" style={{ paddingTop: 40 }}>
        <div className="empty-state-icon">📁</div>
        <div className="empty-state-text">No files yet</div>
        <div className="empty-state-sub">Files uploaded to jobs linked to this customer will appear here</div>
      </div>
    );
  }

  // Group by job
  const byJob = {};
  for (const f of files) {
    const key = f.job_number || f.job_id || 'unknown';
    if (!byJob[key]) byJob[key] = { job_number: f.job_number, files: [] };
    byJob[key].files.push(f);
  }

  const isImage = (f) => f.mime_type?.startsWith('image/');
  const getUrl = (f) => {
    const base = import.meta.env.VITE_SUPABASE_URL;
    return `${base}/storage/v1/object/public/job-files/${f.file_path}`;
  };
  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  return (
    <div>
      {Object.entries(byJob).map(([key, group]) => (
        <div key={key} style={{ marginBottom: 'var(--space-5)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase',
            letterSpacing: '0.05em', marginBottom: 'var(--space-2)', padding: '0 var(--space-1)' }}>
            Job: {group.job_number || 'Unknown'}
          </div>
          <div className="job-page-files-grid">
            {group.files.map(doc => (
              <div key={doc.id} className="job-page-file-card">
                {isImage(doc) ? (
                  <a href={getUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-preview">
                    <img src={getUrl(doc)} alt={doc.name} loading="lazy" />
                  </a>
                ) : (
                  <a href={getUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-preview job-page-file-icon-preview">
                    {doc.mime_type?.includes('pdf') ? '📄' : '📎'}
                  </a>
                )}
                <div className="job-page-file-info">
                  <a href={getUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-name">{doc.name}</a>
                  <div className="job-page-file-meta">
                    <span className="job-page-file-cat-badge">{doc.category}</span>
                    {doc.file_size && <span>{formatSize(doc.file_size)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   ACTIVITY TAB
   ═══════════════════════════════════════════════════ */
function ActivityTab({ activity, fmtDate }) {
  if (activity.length === 0) {
    return (
      <div className="empty-state" style={{ paddingTop: 40 }}>
        <div className="empty-state-icon">📝</div>
        <div className="empty-state-text">No activity yet</div>
      </div>
    );
  }

  const fmtDateTime = (val) => {
    if (!val) return '—';
    return new Date(val).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div className="job-page-timeline">
      {activity.map(item => (
        <div key={`${item.type}-${item.id}`} className={`job-page-timeline-item timeline-${item.type}`}>
          <div className="job-page-timeline-dot" />
          <div className="job-page-timeline-content">
            <div className="job-page-timeline-header">
              <span className="job-page-timeline-author">{item.author}</span>
              <span className="job-page-timeline-time">{fmtDateTime(item.date)}</span>
            </div>
            <div className="job-page-timeline-text">{item.content}</div>
            {item.job_number && (
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', marginTop: 2, display: 'inline-block' }}>
                Job: {item.job_number}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══ Shared sub-components ═══ */

function InfoRow({ label, value, href }) {
  if (!value) return (
    <div className="job-page-info-row">
      <span className="job-page-info-label">{label}</span>
      <span className="job-page-info-value" style={{ color: 'var(--text-tertiary)' }}>—</span>
    </div>
  );
  return (
    <div className="job-page-info-row">
      <span className="job-page-info-label">{label}</span>
      {href ? (
        <a href={href} className="job-page-info-value" style={{ color: 'var(--brand-primary)', textDecoration: 'none' }}>{value}</a>
      ) : (
        <span className="job-page-info-value">{value}</span>
      )}
    </div>
  );
}

function FinRow({ label, value, bold, color }) {
  return (
    <div className="job-page-info-row">
      <span className="job-page-info-label" style={bold ? { fontWeight: 600 } : undefined}>{label}</span>
      <span className="job-page-info-value" style={{ fontWeight: bold ? 700 : 400, color: color || 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <div className="job-page-section" style={{ padding: '12px 14px', textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
    </div>
  );
}

const thStyle = { padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--text-tertiary)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' };
const tdStyle = { padding: '8px 10px', color: 'var(--text-secondary)' };
