import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

// ── Toasts ────────────────────────────────────────────────────────────────────
const toast  = (msg, type = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type } }));
const errToast = (msg) => toast(msg, 'error');

// ── Constants ─────────────────────────────────────────────────────────────────
const DIV_EMOJI  = { water: '💧', mold: '🧬', reconstruction: '🏗️', fire: '🔥', contents: '📦', general: '📁' };
const DIV_COLOR  = { water: '#2563eb', mold: '#9d174d', reconstruction: '#d97706', fire: '#dc2626', contents: '#059669', general: '#6b7280' };
const DIV_LABEL  = { water: 'Water', mold: 'Mold', reconstruction: 'Reconstruction', fire: 'Fire', contents: 'Contents', general: 'General' };
const LOSS_TYPES = ['water', 'fire', 'mold', 'storm', 'sewer', 'vandalism', 'other'];
const CLAIM_STATUSES = ['open', 'in_progress', 'closed', 'denied', 'settled', 'supplementing'];
const AR_STATUSES = [
  { value: 'open',        label: 'Open',        color: '#6b7280', bg: '#f9fafb' },
  { value: 'invoiced',    label: 'Invoiced',    color: '#2563eb', bg: '#eff6ff' },
  { value: 'partial',     label: 'Partial',     color: '#d97706', bg: '#fffbeb' },
  { value: 'paid',        label: 'Paid',        color: '#059669', bg: '#ecfdf5' },
  { value: 'disputed',    label: 'Disputed',    color: '#dc2626', bg: '#fef2f2' },
  { value: 'written_off', label: 'Written Off', color: '#9ca3af', bg: '#f3f4f6' },
];

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt$  = (v) => v == null ? '—' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK  = (v) => { if (v == null) return '—'; const n = Number(v); if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(0) + 'k'; return '$' + Math.round(n); };
const fmtPh = (ph) => { if (!ph) return null; const d = ph.replace(/\D/g,''); const n = d.startsWith('1') ? d.slice(1) : d; return n.length === 10 ? `(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}` : ph; };
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtDateShort = (v) => v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';

function getBalances(job) {
  const invoiced   = Number(job.invoiced_value  || 0);
  const collected  = Number(job.collected_value || 0);
  const deductible = Number(job.deductible      || 0);
  const balance    = Math.max(0, invoiced - collected);
  const ded_owed   = (job.insurance_company && deductible > 0 && !job.deductible_collected)
    ? Math.min(deductible, balance) : 0;
  return { balance, ded_owed, ins_balance: Math.max(0, balance - ded_owed), invoiced, collected, deductible };
}

// ── Small shared UI ───────────────────────────────────────────────────────────
function IR({ label, value, href }) {
  return (
    <div className="job-page-info-row">
      <span className="job-page-info-label">{label}</span>
      {!value
        ? <span className="job-page-info-value" style={{ color: 'var(--text-tertiary)' }}>—</span>
        : href
          ? <a href={href} className="job-page-info-value" style={{ color: 'var(--brand-primary)', textDecoration: 'none' }}>{value}</a>
          : <span className="job-page-info-value">{value}</span>}
    </div>
  );
}
function EF({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 0' }}>
      <span className="job-page-info-label">{label}</span>
      <input className="input" type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder || label} style={{ height: 34 }} />
    </div>
  );
}
function ES({ label, value, onChange, options }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 0' }}>
      <span className="job-page-info-label">{label}</span>
      <select className="input" value={value || ''} onChange={e => onChange(e.target.value)} style={{ height: 34 }}>
        <option value="">—</option>
        {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════
export default function ClaimPage() {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const { db } = useAuth();

  const [claim,     setClaim]     = useState(null);
  const [jobs,      setJobs]      = useState([]);
  const [contact,   setContact]   = useState(null);
  const [adjuster,  setAdjuster]  = useState(null);
  const [documents, setDocuments] = useState([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [loading,   setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [saving,    setSaving]    = useState(null); // job id or 'claim'
  const [payModal,  setPayModal]  = useState(null);
  const [notesModal,setNotesModal]= useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await db.rpc('get_claim_detail', { p_claim_id: claimId });
      if (!data?.claim) { navigate('/jobs', { replace: true }); return; }
      setClaim(data.claim);
      setJobs(data.jobs || []);
      setContact(data.contact || null);
      setAdjuster(data.adjuster || null);
    } catch (e) {
      errToast('Failed to load claim: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [claimId]);

  // Load documents lazily when Documents tab opens
  useEffect(() => {
    if (activeTab !== 'documents' || docsLoaded || jobs.length === 0) return;
    const ids = jobs.map(j => `"${j.id}"`).join(',');
    db.select('job_documents', `job_id=in.(${ids})&order=created_at.desc`)
      .then(d => { setDocuments(d || []); setDocsLoaded(true); })
      .catch(() => setDocsLoaded(true));
  }, [activeTab, jobs, docsLoaded]);

  // ── Computed totals ────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let invoiced = 0, collected = 0, balance = 0, ded_total = 0, ded_owed = 0;
    let dep_held = 0, dep_released = 0, supplement = 0, estimated = 0, approved = 0;
    for (const j of jobs) {
      const b = getBalances(j);
      invoiced   += b.invoiced;
      collected  += b.collected;
      balance    += b.balance;
      ded_owed   += b.ded_owed;
      ded_total  += b.deductible;
      dep_held   += Number(j.depreciation_held     || 0);
      dep_released += Number(j.depreciation_released || 0);
      supplement += Number(j.supplement_value       || 0);
      estimated  += Number(j.estimated_value        || 0);
      approved   += Number(j.approved_value         || 0);
    }
    const net_dep = Math.max(0, dep_held - dep_released);
    return { invoiced, collected, balance, ded_total, ded_owed, dep_held, dep_released, net_dep, supplement, estimated, approved };
  }, [jobs]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const patchJob = async (jobId, fields) => {
    setSaving(jobId);
    try {
      await db.update('jobs', `id=eq.${jobId}`, { ...fields, updated_at: new Date().toISOString() });
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, ...fields } : j));
    } catch (e) {
      errToast('Update failed: ' + e.message);
    } finally {
      setSaving(null);
    }
  };

  const patchClaim = async (fields) => {
    setSaving('claim');
    try {
      await db.update('claims', `id=eq.${claimId}`, { ...fields, updated_at: new Date().toISOString() });
      setClaim(prev => ({ ...prev, ...fields }));
    } catch (e) {
      errToast('Update failed: ' + e.message);
    } finally {
      setSaving(null);
    }
  };

  const markDedPaid = async (job) => {
    const today = new Date().toISOString().split('T')[0];
    const { balance, deductible } = getBalances(job);
    await patchJob(job.id, {
      deductible_collected: true,
      deductible_collected_date: today,
      ar_status: (balance - deductible) <= 0 ? 'paid' : 'partial',
    });
    toast(`✓ Deductible of ${fmt$(job.deductible)} received`);
  };

  const handleLogPayment = async ({ job, amount, source, note, date }) => {
    const newCollected = Number(job.collected_value || 0) + Number(amount);
    const { invoiced } = getBalances(job);
    const newStatus = newCollected >= invoiced ? 'paid' : newCollected > 0 ? 'partial' : job.ar_status;
    const noteEntry = `[${date}] +${fmt$(amount)} (${source})${note ? ' – ' + note : ''}`;
    const updatedNotes = [job.ar_notes, noteEntry].filter(Boolean).join('\n');
    await patchJob(job.id, { collected_value: newCollected, ar_status: newStatus, ar_notes: updatedNotes, last_followup_date: date });
    setPayModal(null);
    toast(`Payment of ${fmt$(amount)} logged`);
  };

  const handleSaveNotes = async (job, notes, invoicedDate) => {
    const fields = { ar_notes: notes, last_followup_date: new Date().toISOString().split('T')[0] };
    if (invoicedDate !== undefined) fields.invoiced_date = invoicedDate || null;
    await patchJob(job.id, fields);
    setNotesModal(null);
    toast('Notes saved');
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return <div className="loading-page"><div className="spinner" /></div>;
  if (!claim)  return null;

  const openBalance  = jobs.filter(j => getBalances(j).balance > 0).length;
  const dedUnpaid    = jobs.filter(j => j.deductible > 0 && !j.deductible_collected).length;
  const insuredName  = contact?.name || jobs[0]?.insured_name || 'Unknown';
  const carrier      = claim.insurance_carrier || jobs[0]?.insurance_company || 'Out of pocket';
  const isInsurance  = !!claim.insurance_carrier;

  const TABS = [
    { key: 'overview',    label: 'Overview'    },
    { key: 'financial',   label: 'Financial'   },
    { key: 'collections', label: 'Collections', count: openBalance },
    { key: 'documents',   label: 'Documents'   },
  ];

  return (
    <div className="claim-page">

      {/* ── TOP BAR ── */}
      <div className="claim-topbar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ gap: 4 }}>← Back</button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {contact?.phone && (
            <a href={`tel:${contact.phone}`} className="btn btn-secondary btn-sm" style={{ textDecoration: 'none', gap: 5, height: 32 }}>
              📱 {fmtPh(contact.phone)}
            </a>
          )}
          {adjuster?.phone && (
            <a href={`tel:${adjuster.phone}`} className="btn btn-secondary btn-sm" style={{ textDecoration: 'none', gap: 5, height: 32 }}>
              📞 Adjuster
            </a>
          )}
          {adjuster?.email && (
            <a href={`mailto:${adjuster.email}`} className="btn btn-secondary btn-sm" style={{ textDecoration: 'none', gap: 5, height: 32 }}>
              ✉ Email Adj.
            </a>
          )}
        </div>
      </div>

      {/* ── CLAIM HEADER ── */}
      <div className="claim-header">
        <div className="claim-header-left">
          <div className="claim-number">{claim.claim_number}</div>
          <div className="claim-client">{insuredName}</div>
          <div className="claim-meta">
            <span>{carrier}</span>
            {claim.date_of_loss && <><span className="claim-meta-sep">·</span><span>Loss: {fmtDate(claim.date_of_loss)}</span></>}
            {claim.loss_type && <><span className="claim-meta-sep">·</span><span style={{ textTransform: 'capitalize' }}>{claim.loss_type}</span></>}
            {claim.insurance_claim_number && <><span className="claim-meta-sep">·</span><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>Ins# {claim.insurance_claim_number}</span></>}
          </div>
        </div>
        <div className="claim-header-right">
          <StatusBadge status={claim.status} />
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4, textAlign: 'right' }}>
            {jobs.length} job{jobs.length !== 1 ? 's' : ''}
            {jobs.length > 0 && <span style={{ marginLeft: 4 }}>· {jobs.map(j => DIV_EMOJI[j.division] || '📁').join(' ')}</span>}
          </div>
        </div>
      </div>

      {/* ── KPI STRIP ── */}
      <div className="claim-kpi-strip">
        <KPI label="Total Invoiced"  value={fmtK(totals.invoiced)}  sub={`${jobs.length} jobs`}        color="var(--accent)" />
        <KPI label="Collected"       value={fmtK(totals.collected)} sub={totals.invoiced > 0 ? Math.round((totals.collected / totals.invoiced) * 100) + '% of billed' : '—'} color="#059669" />
        <KPI label="Balance"         value={fmtK(totals.balance)}   sub={`${openBalance} open`}         color={totals.balance > 0 ? '#dc2626' : '#059669'} alert={totals.balance > 5000} />
        {isInsurance && <KPI label="Deductible Owed" value={fmtK(totals.ded_owed)} sub={`${dedUnpaid} uncollected`} color="#d97706" />}
        {totals.net_dep > 0 && <KPI label="Depreciation Held" value={fmtK(totals.net_dep)} sub="Supplement potential" color="#7c3aed" />}
        {totals.supplement > 0 && <KPI label="Supplement" value={fmtK(totals.supplement)} sub="Additional approved" color="#0891b2" />}
      </div>

      {/* ── TABS ── */}
      <div className="job-page-tabs">
        {TABS.map(t => (
          <button key={t.key} className={`job-page-tab${activeTab === t.key ? ' active' : ''}`} onClick={() => setActiveTab(t.key)}>
            {t.label}
            {t.count > 0 && <span className="job-page-tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ── TAB CONTENT ── */}
      <div className="claim-body">
        {activeTab === 'overview'    && <OverviewTab    claim={claim} jobs={jobs} contact={contact} adjuster={adjuster} patchClaim={patchClaim} saving={saving} navigate={navigate} />}
        {activeTab === 'financial'   && <FinancialTab   jobs={jobs} totals={totals} isInsurance={isInsurance} navigate={navigate} />}
        {activeTab === 'collections' && <CollectionsTab jobs={jobs} saving={saving} patchJob={patchJob} onPay={setPayModal} onNotes={setNotesModal} onMarkDed={markDedPaid} navigate={navigate} />}
        {activeTab === 'documents'   && <DocumentsTab   jobs={jobs} documents={documents} docsLoaded={docsLoaded} db={db} navigate={navigate} />}
      </div>

      {/* ── MODALS ── */}
      {payModal   && <PaymentModal job={payModal}   onClose={() => setPayModal(null)}   onSubmit={handleLogPayment} />}
      {notesModal && <NotesModal   job={notesModal} onClose={() => setNotesModal(null)} onSave={handleSaveNotes} />}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    open:          { label: 'Open',          color: '#2563eb', bg: '#eff6ff' },
    in_progress:   { label: 'In Progress',   color: '#d97706', bg: '#fffbeb' },
    closed:        { label: 'Closed',        color: '#059669', bg: '#ecfdf5' },
    denied:        { label: 'Denied',        color: '#dc2626', bg: '#fef2f2' },
    settled:       { label: 'Settled',       color: '#059669', bg: '#ecfdf5' },
    supplementing: { label: 'Supplementing', color: '#7c3aed', bg: '#f5f3ff' },
  };
  const s = map[status] || { label: status || 'Open', color: '#6b7280', bg: '#f9fafb' };
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: s.bg, color: s.color, border: `1px solid ${s.color}30` }}>
      {s.label}
    </span>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KPI({ label, value, sub, color, alert }) {
  return (
    <div className={`ar-kpi-card${alert ? ' ar-kpi-alert' : ''}`}>
      <div className="ar-kpi-label">{label}</div>
      <div className="ar-kpi-value" style={{ color }}>{value}</div>
      {sub && <div className="ar-kpi-sub">{sub}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════════════
function OverviewTab({ claim, jobs, contact, adjuster, patchClaim, saving, navigate }) {
  return (
    <div className="job-page-grid">
      <ClaimInfoTile claim={claim} patchClaim={patchClaim} saving={saving} />
      <ContactTile   contact={contact} />
      <AdjusterTile  adjuster={adjuster} />
      <JobsOverviewSection jobs={jobs} navigate={navigate} />
    </div>
  );
}

function ClaimInfoTile({ claim, patchClaim, saving }) {
  const [ed, setEd] = useState(false);
  const [f,  setF]  = useState({});
  const start = () => setF({
    insurance_carrier:       claim.insurance_carrier       || '',
    insurance_claim_number:  claim.insurance_claim_number  || '',
    policy_number:           claim.policy_number           || '',
    date_of_loss:            claim.date_of_loss            || '',
    loss_type:               claim.loss_type               || '',
    status:                  claim.status                  || 'open',
    loss_address:            claim.loss_address            || '',
    loss_city:               claim.loss_city               || '',
    loss_state:              claim.loss_state              || '',
    loss_zip:                claim.loss_zip                || '',
    notes:                   claim.notes                   || '',
  }) || setEd(true);
  const s = (k, v) => setF(p => ({ ...p, [k]: v }));
  const save = async () => {
    await patchClaim({
      insurance_carrier:      f.insurance_carrier?.trim()      || null,
      insurance_claim_number: f.insurance_claim_number?.trim() || null,
      policy_number:          f.policy_number?.trim()          || null,
      date_of_loss:           f.date_of_loss                   || null,
      loss_type:              f.loss_type                      || null,
      status:                 f.status                         || 'open',
      loss_address:           f.loss_address?.trim()           || null,
      loss_city:              f.loss_city?.trim()              || null,
      loss_state:             f.loss_state?.trim()             || null,
      loss_zip:               f.loss_zip?.trim()               || null,
      notes:                  f.notes?.trim()                  || null,
    });
    setEd(false);
  };

  return (
    <div className="job-page-section">
      <div className="job-page-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Claim Details</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {!ed
            ? <button className="btn btn-ghost btn-sm" onClick={() => { start(); }} style={{ height: 26, width: 26, padding: 0 }}>✏️</button>
            : <><button className="btn btn-ghost btn-sm" onClick={() => setEd(false)} style={{ height: 26, fontSize: 11 }}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={save} disabled={saving === 'claim'} style={{ height: 26, fontSize: 11 }}>{saving === 'claim' ? '…' : 'Save'}</button></>}
        </div>
      </div>
      {ed ? (<>
        <EF label="Insurance Carrier" value={f.insurance_carrier} onChange={v => s('insurance_carrier', v)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <EF label="Claim # (Ins.)" value={f.insurance_claim_number} onChange={v => s('insurance_claim_number', v)} />
          <EF label="Policy #"       value={f.policy_number}          onChange={v => s('policy_number', v)} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <EF label="Date of Loss"   value={f.date_of_loss} onChange={v => s('date_of_loss', v)} type="date" />
          <ES label="Loss Type"      value={f.loss_type}    onChange={v => s('loss_type', v)} options={LOSS_TYPES} />
        </div>
        <ES label="Claim Status" value={f.status} onChange={v => s('status', v)} options={CLAIM_STATUSES} />
        <EF label="Loss Address" value={f.loss_address} onChange={v => s('loss_address', v)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <EF label="City"  value={f.loss_city}  onChange={v => s('loss_city', v)} />
          <EF label="State" value={f.loss_state} onChange={v => s('loss_state', v)} />
          <EF label="ZIP"   value={f.loss_zip}   onChange={v => s('loss_zip', v)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 0' }}>
          <span className="job-page-info-label">Notes</span>
          <textarea className="input textarea" value={f.notes} onChange={e => s('notes', e.target.value)} rows={3} />
        </div>
      </>) : (<>
        <IR label="Carrier"      value={claim.insurance_carrier || 'Out of pocket'} />
        <IR label="Insurance #"  value={claim.insurance_claim_number} />
        <IR label="Policy #"     value={claim.policy_number} />
        <IR label="Date of Loss" value={fmtDate(claim.date_of_loss)} />
        <IR label="Loss Type"    value={claim.loss_type} />
        {(claim.loss_address || claim.loss_city) && (
          <IR label="Loss Address" value={[claim.loss_address, claim.loss_city, claim.loss_state, claim.loss_zip].filter(Boolean).join(', ')} />
        )}
        {claim.notes && <IR label="Notes" value={claim.notes} />}
      </>)}
    </div>
  );
}

function ContactTile({ contact }) {
  if (!contact) return null;
  return (
    <div className="job-page-section">
      <div className="job-page-section-title">Homeowner / Insured</div>
      <IR label="Name"    value={contact.name} />
      <IR label="Phone"   value={fmtPh(contact.phone)} href={contact.phone ? `tel:${contact.phone}` : null} />
      <IR label="Email"   value={contact.email} href={contact.email ? `mailto:${contact.email}` : null} />
      {contact.billing_address && (
        <IR label="Address" value={[contact.billing_address, contact.billing_city, contact.billing_state].filter(Boolean).join(', ')} />
      )}
    </div>
  );
}

function AdjusterTile({ adjuster }) {
  if (!adjuster) return null;
  return (
    <div className="job-page-section">
      <div className="job-page-section-title">Adjuster</div>
      <IR label="Name"      value={adjuster.name} />
      <IR label="Company"   value={adjuster.company} />
      <IR label="Cell"      value={fmtPh(adjuster.phone)} href={adjuster.phone ? `tel:${adjuster.phone}` : null} />
      <IR label="Desk"      value={fmtPh(adjuster.desk_phone)} href={adjuster.desk_phone ? `tel:${adjuster.desk_phone}` : null} />
      <IR label="Territory" value={adjuster.territory} />
      <IR label="Email"     value={adjuster.email} href={adjuster.email ? `mailto:${adjuster.email}` : null} />
    </div>
  );
}

function JobsOverviewSection({ jobs, navigate }) {
  return (
    <div className="job-page-section job-page-section-full">
      <div className="job-page-section-title">Jobs Under This Claim</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {jobs.map(job => {
          const b = getBalances(job);
          const color = DIV_COLOR[job.division] || '#6b7280';
          return (
            <div key={job.id}
              onClick={() => navigate(`/jobs/${job.id}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)', borderLeft: `4px solid ${color}`, cursor: 'pointer' }}>
              <span style={{ fontSize: 20 }}>{DIV_EMOJI[job.division] || '📁'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 12, fontFamily: 'var(--font-mono)' }}>{job.job_number}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>{DIV_LABEL[job.division]}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)', background: 'var(--bg-tertiary)', padding: '1px 6px', borderRadius: 99, textTransform: 'capitalize' }}>{job.phase?.replace(/_/g, ' ')}</span>
                </div>
                <div style={{ display: 'flex', gap: 14, marginTop: 3 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Inv: <strong style={{ color: 'var(--text-primary)' }}>{fmtK(b.invoiced)}</strong></span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Coll: <strong style={{ color: '#059669' }}>{fmtK(b.collected)}</strong></span>
                  {b.balance > 0 && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Bal: <strong style={{ color: '#dc2626' }}>{fmtK(b.balance)}</strong></span>}
                </div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--brand-primary)', fontWeight: 600 }}>→</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// FINANCIAL TAB
// ═══════════════════════════════════════════════════════════════════════
function FinancialTab({ jobs, totals, isInsurance, navigate }) {
  const hasDeductibles = jobs.some(j => Number(j.deductible) > 0);
  const hasDepreciation = jobs.some(j => Number(j.depreciation_held) > 0);
  const hasSupplement = jobs.some(j => Number(j.supplement_value) > 0);

  return (
    <div style={{ padding: '0 0 24px' }}>
      {/* Summary KPI row */}
      <div style={{ display: 'flex', gap: 1, background: 'var(--border-color)', borderBottom: '1px solid var(--border-color)', overflowX: 'auto' }}>
        <FinKPI label="Estimated"    value={fmt$(totals.estimated)}  />
        <FinKPI label="Approved"     value={fmt$(totals.approved)}   />
        <FinKPI label="Invoiced"     value={fmt$(totals.invoiced)}   color="var(--accent)" />
        <FinKPI label="Collected"    value={fmt$(totals.collected)}  color="#059669" />
        <FinKPI label="Balance"      value={fmt$(totals.balance)}    color={totals.balance > 0 ? '#dc2626' : '#059669'} />
        {isInsurance && hasDeductibles && <FinKPI label="Ded. Owed" value={fmt$(totals.ded_owed)} color="#d97706" />}
        {hasDepreciation && <FinKPI label="Depreciation Net" value={fmt$(totals.net_dep)} color="#7c3aed" />}
        {hasSupplement && <FinKPI label="Supplement" value={fmt$(totals.supplement)} color="#0891b2" />}
      </div>

      {/* Per-job table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)' }}>
              <th style={TH}>Division / Job</th>
              <th style={{ ...TH, textAlign: 'right' }}>Estimated</th>
              <th style={{ ...TH, textAlign: 'right' }}>Approved</th>
              <th style={{ ...TH, textAlign: 'right' }}>Invoiced</th>
              <th style={{ ...TH, textAlign: 'right' }}>Collected</th>
              <th style={{ ...TH, textAlign: 'right' }}>Balance</th>
              {isInsurance && hasDeductibles  && <th style={{ ...TH, textAlign: 'right' }}>Deductible</th>}
              {hasDepreciation && <th style={{ ...TH, textAlign: 'right' }}>Depr. Held</th>}
              {hasSupplement   && <th style={{ ...TH, textAlign: 'right' }}>Supplement</th>}
              <th style={{ ...TH, textAlign: 'right' }}>AR Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map(job => {
              const b = getBalances(job);
              const arObj = AR_STATUSES.find(s => s.value === job.ar_status) || AR_STATUSES[0];
              return (
                <tr key={job.id} onClick={() => navigate(`/jobs/${job.id}`)} style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 16 }}>{DIV_EMOJI[job.division] || '📁'}</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{job.job_number}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>{DIV_LABEL[job.division]}</div>
                      </div>
                    </div>
                  </td>
                  <td style={NUM_TD}>{fmt$(b.invoiced === 0 ? job.estimated_value : null)}{b.invoiced === 0 ? '' : ''}{job.estimated_value > 0 ? fmt$(job.estimated_value) : '—'}</td>
                  <td style={NUM_TD}>{job.approved_value > 0 ? fmt$(job.approved_value) : '—'}</td>
                  <td style={{ ...NUM_TD, fontWeight: 700 }}>{fmt$(b.invoiced)}</td>
                  <td style={{ ...NUM_TD, color: '#059669' }}>{fmt$(b.collected)}</td>
                  <td style={{ ...NUM_TD, fontWeight: 700, color: b.balance > 0 ? '#dc2626' : '#059669' }}>
                    {b.balance > 0 ? fmt$(b.balance) : '✓ Paid'}
                  </td>
                  {isInsurance && hasDeductibles && (
                    <td style={NUM_TD}>
                      {job.deductible > 0
                        ? <span style={{ fontWeight: 600, color: job.deductible_collected ? '#059669' : '#d97706' }}>
                            {job.deductible_collected ? `✓ ${fmt$(job.deductible)}` : fmt$(job.deductible)}
                          </span>
                        : '—'}
                    </td>
                  )}
                  {hasDepreciation && <td style={NUM_TD}>{job.depreciation_held > 0 ? fmt$(job.depreciation_held) : '—'}</td>}
                  {hasSupplement   && <td style={NUM_TD}>{job.supplement_value > 0 ? fmt$(job.supplement_value) : '—'}</td>}
                  <td style={NUM_TD}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: arObj.bg, color: arObj.color }}>
                      {arObj.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/* Totals row */}
          <tfoot>
            <tr style={{ background: 'var(--bg-secondary)', borderTop: '2px solid var(--border-color)', fontWeight: 700 }}>
              <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>TOTAL ({jobs.length} jobs)</td>
              <td style={NUM_TD}>{totals.estimated > 0 ? fmt$(totals.estimated) : '—'}</td>
              <td style={NUM_TD}>{totals.approved > 0 ? fmt$(totals.approved) : '—'}</td>
              <td style={{ ...NUM_TD, color: 'var(--accent)' }}>{fmt$(totals.invoiced)}</td>
              <td style={{ ...NUM_TD, color: '#059669' }}>{fmt$(totals.collected)}</td>
              <td style={{ ...NUM_TD, color: totals.balance > 0 ? '#dc2626' : '#059669' }}>{fmt$(totals.balance)}</td>
              {isInsurance && hasDeductibles && <td style={{ ...NUM_TD, color: '#d97706' }}>{fmt$(totals.ded_total)}</td>}
              {hasDepreciation && <td style={{ ...NUM_TD, color: '#7c3aed' }}>{fmt$(totals.dep_held)}</td>}
              {hasSupplement   && <td style={{ ...NUM_TD, color: '#0891b2' }}>{fmt$(totals.supplement)}</td>}
              <td style={NUM_TD} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Insurance breakdown note */}
      {isInsurance && (
        <div style={{ margin: '16px 20px', padding: '12px 14px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <strong>Insurance breakdown:</strong> Balance = <span style={{ color: '#dc2626' }}>{fmt$(totals.balance)}</span>
          {totals.ded_owed > 0 && <> · Homeowner deductible owed: <span style={{ color: '#d97706' }}>{fmt$(totals.ded_owed)}</span> · Insurance A/R: <span style={{ color: '#2563eb' }}>{fmt$(totals.balance - totals.ded_owed)}</span></>}
          {totals.net_dep > 0 && <> · Depreciation still held by carrier: <span style={{ color: '#7c3aed' }}>{fmt$(totals.net_dep)}</span></>}
        </div>
      )}
    </div>
  );
}
const TH = { padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' };
const NUM_TD = { padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: 12 };
function FinKPI({ label, value, color }) {
  return (
    <div style={{ flex: 1, minWidth: 100, padding: '10px 14px', background: 'var(--bg-primary)' }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || 'var(--text-primary)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// COLLECTIONS TAB
// ═══════════════════════════════════════════════════════════════════════
function CollectionsTab({ jobs, saving, patchJob, onPay, onNotes, onMarkDed, navigate }) {
  const totalBalance   = jobs.reduce((s, j) => s + getBalances(j).balance, 0);
  const totalCollected = jobs.reduce((s, j) => s + Number(j.collected_value || 0), 0);
  const totalInvoiced  = jobs.reduce((s, j) => s + getBalances(j).invoiced, 0);

  return (
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Claim-level summary */}
      <div style={{ display: 'flex', gap: 1, background: 'var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 4 }}>
        <div style={{ flex: 1, padding: '10px 14px', background: 'var(--bg-primary)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>Total Invoiced</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{fmt$(totalInvoiced)}</div>
        </div>
        <div style={{ flex: 1, padding: '10px 14px', background: 'var(--bg-primary)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>Collected</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#059669' }}>{fmt$(totalCollected)}</div>
        </div>
        <div style={{ flex: 1, padding: '10px 14px', background: totalBalance > 0 ? '#fef2f2' : 'var(--bg-primary)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>Balance</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: totalBalance > 0 ? '#dc2626' : '#059669' }}>{totalBalance > 0 ? fmt$(totalBalance) : '✓ Paid'}</div>
        </div>
      </div>

      {/* Per-job collection cards */}
      {jobs.map(job => {
        const b = getBalances(job);
        const arObj = AR_STATUSES.find(s => s.value === (job.ar_status || 'open')) || AR_STATUSES[0];
        const isSaving = saving === job.id;
        return (
          <div key={job.id} className="claim-coll-card">
            <div className="claim-coll-card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>{DIV_EMOJI[job.division] || '📁'}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 12, fontFamily: 'var(--font-mono)' }}>{job.job_number}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>{DIV_LABEL[job.division]} · {job.phase?.replace(/_/g, ' ')}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {b.balance > 0
                  ? <div style={{ fontWeight: 800, fontSize: 16, color: '#dc2626' }}>{fmt$(b.balance)}</div>
                  : <div style={{ fontWeight: 700, fontSize: 13, color: '#059669' }}>✓ Paid</div>}
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>{fmt$(b.invoiced)} billed / {fmt$(b.collected)} in</div>
              </div>
            </div>

            <div className="claim-coll-card-rows">
              {job.insurance_company && b.deductible > 0 && (
                <div className="ar-mobile-card-row">
                  <span>Deductible</span>
                  <button
                    onClick={() => !job.deductible_collected && !isSaving && onMarkDed(job)}
                    disabled={job.deductible_collected || isSaving}
                    style={{ fontWeight: 700, fontSize: 11, padding: '2px 10px', borderRadius: 99, border: `1px solid ${job.deductible_collected ? '#a7f3d0' : '#fde68a'}`, background: job.deductible_collected ? '#ecfdf5' : '#fffbeb', color: job.deductible_collected ? '#059669' : '#d97706', cursor: job.deductible_collected ? 'default' : 'pointer', fontFamily: 'var(--font-sans)' }}>
                    {job.deductible_collected ? `✓ Rcvd${job.deductible_collected_date ? ' ' + fmtDateShort(job.deductible_collected_date) : ''}` : `○ ${fmt$(b.deductible)} owed`}
                  </button>
                </div>
              )}
              {b.ins_balance > 0 && b.ded_owed > 0 && (
                <div className="ar-mobile-card-row">
                  <span>Insurance A/R</span>
                  <span style={{ fontWeight: 600, color: '#2563eb' }}>{fmt$(b.ins_balance)}</span>
                </div>
              )}
              {job.invoiced_date && (
                <div className="ar-mobile-card-row">
                  <span>Invoiced on</span>
                  <span>{fmtDateShort(job.invoiced_date)}</span>
                </div>
              )}
              {job.last_followup_date && (
                <div className="ar-mobile-card-row">
                  <span>Last follow-up</span>
                  <span>{fmtDateShort(job.last_followup_date)}</span>
                </div>
              )}
              {job.ar_notes && (
                <div style={{ padding: '6px 0', borderTop: '1px solid var(--border-light)', marginTop: 2 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 3 }}>Collections Log</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{job.ar_notes}</div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                className="input"
                value={job.ar_status || 'open'}
                onChange={e => patchJob(job.id, { ar_status: e.target.value })}
                disabled={isSaving}
                style={{ height: 30, fontSize: 11, fontWeight: 700, color: arObj.color, background: arObj.bg, borderColor: arObj.color + '50', width: 'auto', minWidth: 100 }}>
                {AR_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              {b.balance > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={() => onPay(job)} disabled={isSaving} style={{ fontSize: 12 }}>
                  + Log Payment
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => onNotes(job)} style={{ fontSize: 12 }}>
                📝 Notes
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate ? navigate(`/jobs/${job.id}`) : null} style={{ fontSize: 12, marginLeft: 'auto' }}>
                View Job →
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DOCUMENTS TAB
// ═══════════════════════════════════════════════════════════════════════
function DocumentsTab({ jobs, documents, docsLoaded, db, navigate }) {
  const jobMap = useMemo(() => {
    const m = {};
    for (const j of jobs) m[j.id] = j;
    return m;
  }, [jobs]);

  const grouped = useMemo(() => {
    const g = {};
    for (const doc of documents) {
      if (!g[doc.job_id]) g[doc.job_id] = [];
      g[doc.job_id].push(doc);
    }
    return g;
  }, [documents]);

  const getFileUrl = (doc) => `${db.baseUrl}/storage/v1/object/public/job-files/${doc.file_path}`;
  const fmtSize = (b) => { if (!b) return ''; if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`; return `${(b / 1048576).toFixed(1)} MB`; };
  const isImage = (doc) => doc.mime_type?.startsWith('image/');

  if (!docsLoaded) return <div className="loading-page"><div className="spinner" /></div>;

  if (documents.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '48px 20px' }}>
        <div className="empty-state-icon">📁</div>
        <div className="empty-state-title">No documents yet</div>
        <div className="empty-state-text">Files uploaded to individual jobs will appear here.</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 20px' }}>
      {jobs.map(job => {
        const docs = grouped[job.id] || [];
        if (docs.length === 0) return null;
        const color = DIV_COLOR[job.division] || '#6b7280';
        return (
          <div key={job.id} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingBottom: 6, borderBottom: `2px solid ${color}` }}>
              <span style={{ fontSize: 16 }}>{DIV_EMOJI[job.division] || '📁'}</span>
              <span style={{ fontWeight: 700, fontSize: 12, fontFamily: 'var(--font-mono)' }}>{job.job_number}</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{docs.length} file{docs.length !== 1 ? 's' : ''}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/jobs/${job.id}?tab=files`)} style={{ marginLeft: 'auto', fontSize: 11 }}>View in Job →</button>
            </div>
            <div className="job-page-files-grid">
              {docs.map(doc => (
                <div key={doc.id} className="job-page-file-card">
                  {isImage(doc)
                    ? <a href={getFileUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-preview"><img src={getFileUrl(doc)} alt={doc.name} loading="lazy" /></a>
                    : <a href={getFileUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-preview job-page-file-icon-preview">{doc.mime_type?.includes('pdf') ? '📄' : '📎'}</a>}
                  <div className="job-page-file-info">
                    <a href={getFileUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-name">{doc.name}</a>
                    <div className="job-page-file-meta">
                      <span className="job-page-file-cat-badge">{doc.category}</span>
                      {doc.file_size && <span>{fmtSize(doc.file_size)}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PAYMENT MODAL (reused from Collections)
// ═══════════════════════════════════════════════════════════════════════
function PaymentModal({ job, onClose, onSubmit }) {
  const b = getBalances(job);
  const [amount, setAmount] = useState(b.balance > 0 ? b.balance.toFixed(2) : '');
  const [source, setSource] = useState(job.insurance_company ? 'insurance' : 'homeowner');
  const [note,   setNote]   = useState('');
  const [date,   setDate]   = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const handleSubmit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { errToast('Enter a valid amount'); return; }
    setSaving(true);
    await onSubmit({ job, amount: amt, source, note: note.trim(), date });
    setSaving(false);
  };
  return (
    <div className="ar-modal-overlay" onClick={onClose}>
      <div className="ar-modal" onClick={e => e.stopPropagation()}>
        <div className="ar-modal-header">
          <div><div style={{ fontWeight: 700, fontSize: 15 }}>Log Payment</div><div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{job.insured_name} · {job.job_number}</div></div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ width: 30, height: 30, padding: 0 }}>✕</button>
        </div>
        <div className="ar-modal-body">
          <div className="ar-pay-summary">
            <div className="ar-pay-summary-item"><div className="ar-pay-summary-label">Balance Due</div><div className="ar-pay-summary-value" style={{ color: b.balance > 0 ? '#dc2626' : '#059669' }}>{fmt$(b.balance)}</div></div>
            {job.insurance_company && b.deductible > 0 && <><div className="ar-pay-summary-item"><div className="ar-pay-summary-label">Deductible</div><div className="ar-pay-summary-value" style={{ color: job.deductible_collected ? '#059669' : '#d97706' }}>{job.deductible_collected ? '✓' : fmt$(b.deductible)}</div></div><div className="ar-pay-summary-item"><div className="ar-pay-summary-label">Ins. A/R</div><div className="ar-pay-summary-value" style={{ color: '#2563eb' }}>{fmt$(b.ins_balance)}</div></div></>}
          </div>
          <div className="form-group"><label className="label">Amount Received *</label><input className="input" type="number" step="0.01" min="0.01" value={amount} onChange={e => setAmount(e.target.value)} autoFocus /></div>
          <div className="form-group"><label className="label">Payment Source</label>
            <select className="input" value={source} onChange={e => setSource(e.target.value)}>
              <option value="insurance">Insurance Company</option>
              <option value="homeowner">Homeowner / Client</option>
              <option value="deductible">Deductible</option>
              <option value="depreciation">Depreciation Release</option>
              <option value="supplement">Supplement</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="form-group"><label className="label">Date Received</label><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="form-group"><label className="label">Note (check #, ref…)</label><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Optional" /></div>
        </div>
        <div className="ar-modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || !amount}>{saving ? 'Saving…' : `Log ${amount ? '$' + parseFloat(amount || 0).toFixed(2) : 'Payment'}`}</button>
        </div>
      </div>
    </div>
  );
}

// ── Notes Modal ───────────────────────────────────────────────────────────────
function NotesModal({ job, onClose, onSave }) {
  const [notes,        setNotes]        = useState(job.ar_notes || '');
  const [invoicedDate, setInvoicedDate] = useState(job.invoiced_date || '');
  const [saving,       setSaving]       = useState(false);
  const handleSave = async () => { setSaving(true); await onSave(job, notes, invoicedDate); setSaving(false); };
  return (
    <div className="ar-modal-overlay" onClick={onClose}>
      <div className="ar-modal" onClick={e => e.stopPropagation()}>
        <div className="ar-modal-header">
          <div><div style={{ fontWeight: 700, fontSize: 15 }}>Collections Notes</div><div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{job.insured_name} · {job.job_number}</div></div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ width: 30, height: 30, padding: 0 }}>✕</button>
        </div>
        <div className="ar-modal-body">
          <div className="form-group"><label className="label">Invoice Date</label><input className="input" type="date" value={invoicedDate} onChange={e => setInvoicedDate(e.target.value)} /><div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>Used for aging.</div></div>
          <div className="form-group"><label className="label">Collections Log</label><textarea className="input textarea" value={notes} onChange={e => setNotes(e.target.value)} rows={9} autoFocus style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} placeholder="Log contacts, promises, disputes, follow-ups…" /></div>
          {job.last_followup_date && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Last follow-up: {fmtDateShort(job.last_followup_date)}</div>}
        </div>
        <div className="ar-modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Notes'}</button>
        </div>
      </div>
    </div>
  );
}
