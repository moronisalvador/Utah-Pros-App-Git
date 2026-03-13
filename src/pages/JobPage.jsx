import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const PRIORITY_LABELS = { 1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low' };
const PRIORITY_COLORS = { 1: '#ef4444', 2: '#f59e0b', 3: '#2563eb', 4: '#8b929e' };

const FILE_CATEGORIES = [
  { key: 'photo', label: 'Photos' },
  { key: 'estimate', label: 'Estimates' },
  { key: 'invoice', label: 'Invoices' },
  { key: 'moisture_log', label: 'Moisture Logs' },
  { key: 'receipt', label: 'Receipts' },
  { key: 'contract', label: 'Contracts' },
  { key: 'other', label: 'Other' },
];

const DIVISION_EMOJI = { water: '💧', mold: '🦠', reconstruction: '🏗️' };

export default function JobPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { db, employee: currentUser } = useAuth();

  const [job, setJob] = useState(null);
  const [phases, setPhases] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  // Sub-data
  const [documents, setDocuments] = useState([]);
  const [notes, setNotes] = useState([]);
  const [history, setHistory] = useState([]);

  // Edit states
  const [saving, setSaving] = useState(false);
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    loadJob();
  }, [jobId]);

  const loadJob = async () => {
    setLoading(true);
    try {
      const [jobsData, phasesData, empsData, docsData, notesData, histData] = await Promise.all([
        db.select('jobs', `id=eq.${jobId}`),
        db.select('job_phases', 'is_active=eq.true&order=display_order.asc'),
        db.select('employees', 'is_active=eq.true&order=full_name.asc&select=id,full_name,role'),
        db.select('job_documents', `job_id=eq.${jobId}&order=created_at.desc`).catch(() => []),
        db.select('job_notes', `job_id=eq.${jobId}&order=created_at.desc`).catch(() => []),
        db.select('job_phase_history', `job_id=eq.${jobId}&order=changed_at.desc&limit=50`).catch(() => []),
      ]);
      if (jobsData.length === 0) {
        navigate('/jobs', { replace: true });
        return;
      }
      setJob(jobsData[0]);
      setPhases(phasesData);
      setEmployees(empsData);
      setDocuments(docsData);
      setNotes(notesData);
      setHistory(histData);
    } catch (err) {
      console.error('Job load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const phaseMap = useMemo(() => {
    const m = {};
    for (const p of phases) m[p.key] = p;
    return m;
  }, [phases]);

  // ── Field save ──
  const handleFieldSave = async (field, value) => {
    setSaving(true);
    try {
      const update = { [field]: value || null, updated_at: new Date().toISOString() };
      await db.update('jobs', `id=eq.${job.id}`, update);
      setJob(prev => ({ ...prev, ...update }));
      setEditingField(null);
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Phase change ──
  const handlePhaseChange = async (newPhase) => {
    if (newPhase === job.phase) return;
    setSaving(true);
    try {
      await db.update('jobs', `id=eq.${job.id}`, {
        phase: newPhase,
        phase_entered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await db.insert('job_phase_history', {
        job_id: job.id,
        from_phase: job.phase,
        to_phase: newPhase,
        changed_by: currentUser?.id || null,
        changed_at: new Date().toISOString(),
      });
      setJob(prev => ({ ...prev, phase: newPhase, phase_entered_at: new Date().toISOString() }));
      // Refresh history
      const histData = await db.select('job_phase_history', `job_id=eq.${job.id}&order=changed_at.desc&limit=50`).catch(() => []);
      setHistory(histData);
    } catch (err) {
      alert('Failed to update phase: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (field, currentValue) => {
    setEditingField(field);
    setEditValue(currentValue || '');
  };

  const cancelEdit = () => { setEditingField(null); setEditValue(''); };

  const fmt = (val) => {
    if (val === null || val === undefined) return '—';
    return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const fmtDate = (val) => {
    if (!val) return '—';
    return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const fmtDateTime = (val) => {
    if (!val) return '—';
    return new Date(val).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;
  if (!job) return null;

  const phaseLabel = phaseMap[job.phase]?.label || job.phase;
  const divEmoji = DIVISION_EMOJI[job.division] || '📁';

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'files', label: 'Files', count: documents.length },
    { key: 'financial', label: 'Financial' },
    { key: 'activity', label: 'Activity', count: notes.length + history.length },
  ];

  return (
    <div className="job-page">
      {/* ══ Top Bar ══ */}
      <div className="job-page-topbar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ gap: 4 }}>
          ← Back
        </button>
        <div className="job-page-topbar-actions">
          <select
            className="input"
            value={job.phase}
            onChange={e => handlePhaseChange(e.target.value)}
            disabled={saving}
            style={{ width: 'auto', minWidth: 160, fontWeight: 600, height: 32 }}
          >
            {phases.map(p => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ══ Header ══ */}
      <div className="job-page-header">
        <div className="job-page-header-left">
          <div className="job-page-division-icon">{divEmoji}</div>
          <div>
            <div className="job-page-jobnumber">{job.job_number || 'No Job #'}</div>
            <div className="job-page-client">{job.insured_name || 'Unknown Client'}</div>
            {job.address && (
              <div className="job-page-address">{job.address}{job.city ? `, ${job.city}` : ''}{job.state ? ` ${job.state}` : ''}</div>
            )}
          </div>
        </div>
        <div className="job-page-header-right">
          <div className="job-page-phase-badge">
            <span className={`status-badge status-${phaseClass(job.phase)}`}>{phaseLabel}</span>
          </div>
          {job.priority && (
            <span style={{ fontSize: 13, fontWeight: 600, color: PRIORITY_COLORS[job.priority] }}>
              {PRIORITY_LABELS[job.priority]}
            </span>
          )}
          {(job.is_cat_loss || job.has_asbestos || job.has_lead) && (
            <div style={{ display: 'flex', gap: 4 }}>
              {job.is_cat_loss && <span className="job-flag flag-red">CAT</span>}
              {job.has_asbestos && <span className="job-flag flag-red">ASB</span>}
              {job.has_lead && <span className="job-flag flag-red">LEAD</span>}
            </div>
          )}
        </div>
      </div>

      {/* ══ Tabs ══ */}
      <div className="job-page-tabs">
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`job-page-tab${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {tab.count > 0 && <span className="job-page-tab-count">{tab.count}</span>}
          </button>
        ))}
      </div>

      {/* ══ Tab Content ══ */}
      <div className="job-page-content">
        {activeTab === 'overview' && (
          <OverviewTab
            job={job}
            phases={phases}
            employees={employees}
            phaseMap={phaseMap}
            editingField={editingField}
            editValue={editValue}
            saving={saving}
            onStartEdit={startEdit}
            onCancelEdit={cancelEdit}
            onFieldSave={handleFieldSave}
            onEditValueChange={setEditValue}
            fmt={fmt}
            fmtDate={fmtDate}
          />
        )}
        {activeTab === 'files' && (
          <FilesTab
            job={job}
            documents={documents}
            setDocuments={setDocuments}
            db={db}
            currentUser={currentUser}
          />
        )}
        {activeTab === 'financial' && (
          <FinancialTab job={job} fmt={fmt} />
        )}
        {activeTab === 'activity' && (
          <ActivityTab
            job={job}
            notes={notes}
            setNotes={setNotes}
            history={history}
            employees={employees}
            phaseMap={phaseMap}
            db={db}
            currentUser={currentUser}
            fmtDateTime={fmtDateTime}
          />
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   OVERVIEW TAB
   ═══════════════════════════════════════════════════ */
function OverviewTab({ job, employees, phaseMap, editingField, editValue, saving, onStartEdit, onCancelEdit, onFieldSave, onEditValueChange, fmt, fmtDate }) {
  const pmName = employees.find(e => e.id === job.project_manager_id)?.full_name;
  const ltName = employees.find(e => e.id === job.lead_tech_id)?.full_name;

  return (
    <div className="job-page-grid">
      {/* Client Info */}
      <div className="job-page-section">
        <div className="job-page-section-title">Client Information</div>
        <InfoRow label="Name" value={job.insured_name} />
        <InfoRow label="Phone" value={job.client_phone} href={job.client_phone ? `tel:${job.client_phone}` : null} />
        <InfoRow label="Email" value={job.client_email} href={job.client_email ? `mailto:${job.client_email}` : null} />
        <InfoRow label="Address" value={job.address} />
        <InfoRow label="City / State" value={[job.city, job.state].filter(Boolean).join(', ') || null} />
      </div>

      {/* Insurance */}
      <div className="job-page-section">
        <div className="job-page-section-title">Insurance</div>
        <InfoRow label="Company" value={job.insurance_company} />
        <InfoRow label="Claim #" value={job.claim_number} />
        <InfoRow label="Policy #" value={job.policy_number} />
        <InfoRow label="Adjuster" value={job.adjuster_name || job.adjuster} />
        <InfoRow label="Adj. Phone" value={job.adjuster_phone} href={job.adjuster_phone ? `tel:${job.adjuster_phone}` : null} />
        <InfoRow label="Adj. Email" value={job.adjuster_email} href={job.adjuster_email ? `mailto:${job.adjuster_email}` : null} />
        <InfoRow label="CAT Code" value={job.cat_code} />
      </div>

      {/* Job Details */}
      <div className="job-page-section">
        <div className="job-page-section-title">Job Details</div>
        <InfoRow label="Division" value={job.division} />
        <InfoRow label="Source" value={job.source} />
        <InfoRow label="Type of Loss" value={job.type_of_loss} />
        <InfoRow label="Date of Loss" value={fmtDate(job.date_of_loss)} />
        <InfoRow label="Received" value={fmtDate(job.received_date)} />
        <InfoRow label="Target Complete" value={fmtDate(job.target_completion)} />
        <InfoRow label="Encircle ID" value={job.encircle_claim_id} />
      </div>

      {/* Team */}
      <div className="job-page-section">
        <div className="job-page-section-title">Team</div>
        <InfoRow label="Project Manager" value={pmName || job.project_manager || 'Unassigned'} />
        <InfoRow label="Lead Tech" value={ltName || 'Unassigned'} />
        {job.broker_agent && <InfoRow label="Broker/Agent" value={job.broker_agent} />}
      </div>

      {/* Internal Notes — full width */}
      <div className="job-page-section job-page-section-full">
        <div className="job-page-section-title">Internal Notes</div>
        {editingField === 'internal_notes' ? (
          <div>
            <textarea
              className="input textarea"
              value={editValue}
              onChange={e => onEditValueChange(e.target.value)}
              rows={5}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => onFieldSave('internal_notes', editValue)} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={onCancelEdit}>Cancel</button>
            </div>
          </div>
        ) : (
          <div
            className="job-page-notes-content"
            onClick={() => onStartEdit('internal_notes', job.internal_notes)}
          >
            {job.internal_notes || 'Click to add notes...'}
          </div>
        )}
      </div>

      {/* Encircle Summary — full width if present */}
      {job.encircle_summary && (
        <div className="job-page-section job-page-section-full">
          <div className="job-page-section-title">Encircle Summary</div>
          <div style={{ fontSize: 'var(--text-sm)', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
            {job.encircle_summary}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   FILES TAB
   ═══════════════════════════════════════════════════ */
function FilesTab({ job, documents, setDocuments, db, currentUser }) {
  const [uploading, setUploading] = useState(false);
  const [filterCat, setFilterCat] = useState('all');
  const [uploadCategory, setUploadCategory] = useState('photo');
  const fileInputRef = useRef(null);

  const filtered = filterCat === 'all' ? documents : documents.filter(d => d.category === filterCat);

  const catCounts = useMemo(() => {
    const c = { all: documents.length };
    for (const d of documents) c[d.category] = (c[d.category] || 0) + 1;
    return c;
  }, [documents]);

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    setUploading(true);

    try {
      for (const file of files) {
        const ext = file.name.split('.').pop();
        const storagePath = `${job.id}/${Date.now()}-${file.name}`;

        // Upload to Supabase Storage
        const formData = new FormData();
        formData.append('file', file);

        // Use REST API for storage upload
        const uploadRes = await fetch(
          `${db.baseUrl}/storage/v1/object/job-files/${storagePath}`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${db.apiKey}`, 'apikey': db.apiKey },
            body: formData,
          }
        );

        if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          throw new Error(`Upload failed: ${errText}`);
        }

        // Insert document record
        const doc = {
          job_id: job.id,
          name: file.name,
          file_path: storagePath,
          file_size: file.size,
          mime_type: file.type,
          category: uploadCategory,
          uploaded_by: currentUser?.id || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const inserted = await db.insert('job_documents', doc);
        if (inserted && inserted.length > 0) {
          setDocuments(prev => [inserted[0], ...prev]);
        } else {
          // Reload if insert doesn't return
          const docsData = await db.select('job_documents', `job_id=eq.${job.id}&order=created_at.desc`);
          setDocuments(docsData);
        }
      }
    } catch (err) {
      console.error('Upload error:', err);
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (doc) => {
    if (!confirm(`Delete "${doc.name}"?`)) return;
    try {
      // Delete from storage
      await fetch(
        `${db.baseUrl}/storage/v1/object/job-files/${doc.file_path}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${db.apiKey}`, 'apikey': db.apiKey },
        }
      );
      // Delete record
      await db.delete('job_documents', `id=eq.${doc.id}`);
      setDocuments(prev => prev.filter(d => d.id !== doc.id));
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  const getFileUrl = (doc) => {
    return `${db.baseUrl}/storage/v1/object/public/job-files/${doc.file_path}`;
  };

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const isImage = (doc) => doc.mime_type?.startsWith('image/');

  return (
    <div className="job-page-files">
      {/* Upload bar */}
      <div className="job-page-files-toolbar">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
          <select
            className="input"
            value={uploadCategory}
            onChange={e => setUploadCategory(e.target.value)}
            style={{ width: 'auto', minWidth: 130, height: 32 }}
          >
            {FILE_CATEGORIES.map(c => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading...' : 'Upload Files'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleUpload}
            style={{ display: 'none' }}
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv"
          />
        </div>
      </div>

      {/* Category filter */}
      <div className="job-page-files-cats">
        <button
          className={`job-page-files-cat${filterCat === 'all' ? ' active' : ''}`}
          onClick={() => setFilterCat('all')}
        >
          All ({catCounts.all || 0})
        </button>
        {FILE_CATEGORIES.map(c => {
          const count = catCounts[c.key] || 0;
          if (count === 0 && filterCat !== c.key) return null;
          return (
            <button
              key={c.key}
              className={`job-page-files-cat${filterCat === c.key ? ' active' : ''}`}
              onClick={() => setFilterCat(c.key)}
            >
              {c.label} ({count})
            </button>
          );
        })}
      </div>

      {/* File grid */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📁</div>
          <div className="empty-state-text">No files yet</div>
          <div className="empty-state-sub">Upload photos, estimates, invoices, and more</div>
        </div>
      ) : (
        <div className="job-page-files-grid">
          {filtered.map(doc => (
            <div key={doc.id} className="job-page-file-card">
              {isImage(doc) ? (
                <a href={getFileUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-preview">
                  <img src={getFileUrl(doc)} alt={doc.name} loading="lazy" />
                </a>
              ) : (
                <a href={getFileUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-preview job-page-file-icon-preview">
                  {doc.mime_type?.includes('pdf') ? '📄' : '📎'}
                </a>
              )}
              <div className="job-page-file-info">
                <a href={getFileUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-name">{doc.name}</a>
                <div className="job-page-file-meta">
                  <span className="job-page-file-cat-badge">{doc.category}</span>
                  {doc.file_size && <span>{formatSize(doc.file_size)}</span>}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(doc)} title="Delete" style={{ flexShrink: 0, padding: '2px 6px', fontSize: 14 }}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   FINANCIAL TAB
   ═══════════════════════════════════════════════════ */
function FinancialTab({ job, fmt }) {
  const estimated = Number(job.estimated_value || 0);
  const approved = Number(job.approved_value || 0);
  const invoiced = Number(job.invoiced_value || 0);
  const collected = Number(job.collected_value || 0);
  const deductible = Number(job.deductible || 0);
  const deprecHeld = Number(job.depreciation_held || 0);
  const deprecReleased = Number(job.depreciation_released || 0);
  const supplement = Number(job.supplement_value || 0);

  const laborCost = Number(job.total_labor_cost || 0);
  const materialCost = Number(job.total_material_cost || 0);
  const equipCost = Number(job.total_equipment_cost || 0);
  const subCost = Number(job.total_sub_cost || 0);
  const otherCost = Number(job.total_other_cost || 0);
  const totalCost = laborCost + materialCost + equipCost + subCost + otherCost;

  const grossProfit = approved > 0 ? approved - totalCost : estimated - totalCost;
  const margin = (approved > 0 ? approved : estimated) > 0
    ? ((grossProfit / (approved > 0 ? approved : estimated)) * 100).toFixed(1)
    : 0;

  const outstanding = invoiced - collected;

  return (
    <div className="job-page-financial">
      {/* Revenue cards */}
      <div className="job-page-fin-cards">
        <FinCard label="Estimated" value={fmt(estimated)} color="var(--text-secondary)" />
        <FinCard label="Approved" value={fmt(approved)} color="var(--accent)" highlight={approved > 0} />
        <FinCard label="Invoiced" value={fmt(invoiced)} color="#8b5cf6" />
        <FinCard label="Collected" value={fmt(collected)} color="var(--status-resolved)" highlight={collected > 0} />
      </div>

      {/* Key metrics */}
      <div className="job-page-fin-cards" style={{ marginTop: 16 }}>
        <FinCard label="Deductible" value={fmt(deductible)} color="var(--text-tertiary)" />
        <FinCard label="Depreciation Held" value={fmt(deprecHeld)} color="#d97706" />
        <FinCard label="Depreciation Released" value={fmt(deprecReleased)} color="var(--status-resolved)" />
        <FinCard label="Supplement" value={fmt(supplement)} color="#8b5cf6" />
      </div>

      {/* Costs breakdown */}
      <div className="job-page-section" style={{ marginTop: 24 }}>
        <div className="job-page-section-title">Cost Breakdown</div>
        <div className="job-page-fin-table">
          <FinRow label="Labor" value={fmt(laborCost)} />
          <FinRow label="Materials" value={fmt(materialCost)} />
          <FinRow label="Equipment" value={fmt(equipCost)} />
          <FinRow label="Subcontractors" value={fmt(subCost)} />
          <FinRow label="Other" value={fmt(otherCost)} />
          <div className="job-page-fin-divider" />
          <FinRow label="Total Cost" value={fmt(totalCost)} bold />
        </div>
      </div>

      {/* Profitability */}
      <div className="job-page-section" style={{ marginTop: 16 }}>
        <div className="job-page-section-title">Profitability</div>
        <div className="job-page-fin-table">
          <FinRow label={approved > 0 ? 'Approved Revenue' : 'Estimated Revenue'} value={fmt(approved > 0 ? approved : estimated)} />
          <FinRow label="Total Cost" value={fmt(totalCost)} />
          <div className="job-page-fin-divider" />
          <FinRow
            label="Gross Profit"
            value={fmt(grossProfit)}
            bold
            color={grossProfit >= 0 ? 'var(--status-resolved)' : 'var(--status-needs-response)'}
          />
          <FinRow
            label="Margin"
            value={`${margin}%`}
            bold
            color={grossProfit >= 0 ? 'var(--status-resolved)' : 'var(--status-needs-response)'}
          />
          {outstanding > 0 && (
            <FinRow label="Outstanding (Invoiced − Collected)" value={fmt(outstanding)} color="#d97706" />
          )}
        </div>
      </div>
    </div>
  );
}

function FinCard({ label, value, color, highlight }) {
  return (
    <div className={`job-page-fin-card${highlight ? ' highlight' : ''}`}>
      <div className="job-page-fin-card-label">{label}</div>
      <div className="job-page-fin-card-value" style={{ color }}>{value}</div>
    </div>
  );
}

function FinRow({ label, value, bold, color }) {
  return (
    <div className="job-page-fin-row">
      <span style={{ fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 400, color: color || 'inherit' }}>{value}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   ACTIVITY TAB
   ═══════════════════════════════════════════════════ */
function ActivityTab({ job, notes, setNotes, history, employees, phaseMap, db, currentUser, fmtDateTime }) {
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const empMap = useMemo(() => {
    const m = {};
    for (const e of employees) m[e.id] = e;
    return m;
  }, [employees]);

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    setSavingNote(true);
    try {
      const note = {
        job_id: job.id,
        author_id: currentUser?.id || null,
        content: newNote.trim(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const inserted = await db.insert('job_notes', note);
      if (inserted?.length > 0) {
        setNotes(prev => [inserted[0], ...prev]);
      } else {
        const notesData = await db.select('job_notes', `job_id=eq.${job.id}&order=created_at.desc`);
        setNotes(notesData);
      }
      setNewNote('');
    } catch (err) {
      alert('Failed to add note: ' + err.message);
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = async (noteId) => {
    if (!confirm('Delete this note?')) return;
    try {
      await db.delete('job_notes', `id=eq.${noteId}`);
      setNotes(prev => prev.filter(n => n.id !== noteId));
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  };

  // Merge notes + history into unified timeline
  const timeline = useMemo(() => {
    const items = [];

    for (const note of notes) {
      items.push({
        type: 'note',
        id: note.id,
        date: note.created_at,
        content: note.content,
        author: empMap[note.author_id]?.full_name || 'Unknown',
        raw: note,
      });
    }

    for (const h of history) {
      const fromLabel = phaseMap[h.from_phase]?.label || h.from_phase;
      const toLabel = phaseMap[h.to_phase]?.label || h.to_phase;
      items.push({
        type: 'phase_change',
        id: h.id,
        date: h.changed_at,
        content: `Phase changed: ${fromLabel} → ${toLabel}`,
        author: empMap[h.changed_by]?.full_name || 'System',
      });
    }

    items.sort((a, b) => new Date(b.date) - new Date(a.date));
    return items;
  }, [notes, history, empMap, phaseMap]);

  return (
    <div className="job-page-activity">
      {/* New note input */}
      <div className="job-page-note-compose">
        <textarea
          className="input textarea"
          placeholder="Add a note..."
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          rows={3}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleAddNote}
            disabled={savingNote || !newNote.trim()}
          >
            {savingNote ? 'Saving...' : 'Add Note'}
          </button>
        </div>
      </div>

      {/* Timeline */}
      {timeline.length === 0 ? (
        <div className="empty-state" style={{ paddingTop: 32 }}>
          <div className="empty-state-icon">📝</div>
          <div className="empty-state-text">No activity yet</div>
        </div>
      ) : (
        <div className="job-page-timeline">
          {timeline.map(item => (
            <div key={`${item.type}-${item.id}`} className={`job-page-timeline-item timeline-${item.type}`}>
              <div className="job-page-timeline-dot" />
              <div className="job-page-timeline-content">
                <div className="job-page-timeline-header">
                  <span className="job-page-timeline-author">{item.author}</span>
                  <span className="job-page-timeline-time">{fmtDateTime(item.date)}</span>
                </div>
                <div className="job-page-timeline-text">{item.content}</div>
                {item.type === 'note' && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleDeleteNote(item.id)}
                    style={{ padding: '0 4px', fontSize: 11, marginTop: 4, height: 20 }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Shared helpers ── */
function InfoRow({ label, value, href }) {
  const display = value || '—';
  const empty = !value || value === '—';
  return (
    <div className="job-page-info-row">
      <span className="job-page-info-label">{label}</span>
      {href ? (
        <a href={href} className="job-page-info-value">{display}</a>
      ) : (
        <span className="job-page-info-value" style={{ color: empty ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>
          {display}
        </span>
      )}
    </div>
  );
}

function phaseClass(phase) {
  if (!phase) return 'active';
  if (['completed', 'closed', 'paid'].includes(phase)) return 'resolved';
  if (['on_hold', 'cancelled', 'waiting_on_approval', 'waiting_for_deductible', 'awaiting_payment'].includes(phase)) return 'waiting';
  if (['lead', 'emergency', 'job_received'].includes(phase)) return 'needs-response';
  return 'active';
}
