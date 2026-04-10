import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';

/* ── Field configs per entity type ── */
const MERGE_FIELDS = {
  contact: [
    { key: 'name', label: 'Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'phone_secondary', label: 'Secondary Phone' },
    { key: 'role', label: 'Role' },
    { key: 'billing_address', label: 'Billing Address' },
    { key: 'billing_city', label: 'City' },
    { key: 'billing_state', label: 'State' },
    { key: 'billing_zip', label: 'Zip' },
    { key: 'insurance_carrier', label: 'Insurance Carrier' },
    { key: 'policy_number', label: 'Policy #' },
    { key: 'notes', label: 'Notes', type: 'text' },
    { key: 'relationship_notes', label: 'Relationship Notes', type: 'text' },
    { key: 'created_at', label: 'Created', type: 'date' },
  ],
  claim: [
    { key: 'claim_number', label: 'Claim #', immutable: true },
    { key: 'insurance_carrier', label: 'Insurance' },
    { key: 'insurance_claim_number', label: 'Insurance Claim #' },
    { key: 'policy_number', label: 'Policy #' },
    { key: 'date_of_loss', label: 'Date of Loss', type: 'date' },
    { key: 'loss_address', label: 'Address' },
    { key: 'loss_city', label: 'City' },
    { key: 'loss_state', label: 'State' },
    { key: 'loss_zip', label: 'Zip' },
    { key: 'loss_type', label: 'Loss Type' },
    { key: 'status', label: 'Status' },
    { key: 'notes', label: 'Notes', type: 'text' },
    { key: 'created_at', label: 'Created', type: 'date' },
  ],
  job: [
    { key: 'job_number', label: 'Job #', immutable: true },
    { key: 'division', label: 'Division', immutable: true },
    { key: 'insured_name', label: 'Insured' },
    { key: 'address', label: 'Address' },
    { key: 'insurance_company', label: 'Insurance' },
    { key: 'adjuster_name', label: 'Adjuster' },
    { key: 'date_of_loss', label: 'DOL', type: 'date' },
    { key: 'phase', label: 'Phase' },
    { key: 'estimated_value', label: 'Estimated $', type: 'currency', merge: 'sum' },
    { key: 'approved_value', label: 'Approved $', type: 'currency', merge: 'sum' },
    { key: 'invoiced_value', label: 'Invoiced $', type: 'currency', merge: 'sum' },
    { key: 'collected_value', label: 'Collected $', type: 'currency', merge: 'sum' },
    { key: 'encircle_claim_id', label: 'Encircle ID' },
    { key: 'internal_notes', label: 'Notes', type: 'text' },
    { key: 'created_at', label: 'Created', type: 'date' },
  ],
};

const LABELS = {
  contact: { singular: 'Contact', searchPlaceholder: 'Search by name or phone...', identifier: r => r.name || r.phone || 'Unnamed' },
  claim:   { singular: 'Claim',   searchPlaceholder: 'Search by claim # or insured...', identifier: r => r.claim_number || 'No claim #' },
  job:     { singular: 'Job',     searchPlaceholder: 'Search by job # or insured...', identifier: r => r.job_number || 'No job #' },
};

const RPC_MAP = { contact: 'merge_contacts', claim: 'merge_claims', job: 'merge_jobs' };

function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtCurrency(v) {
  if (v == null) return '';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtValue(val, field) {
  if (val == null || val === '') return null;
  if (field.type === 'date') return fmtDate(val);
  if (field.type === 'currency') return fmtCurrency(val);
  if (field.type === 'text' && typeof val === 'string' && val.length > 80) return val.slice(0, 80) + '...';
  return String(val);
}

const toast = (msg, type = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type } }));

export default function MergeModal({ type, keepRecord, onClose, onMerged }) {
  const { db } = useAuth();
  const [step, setStep] = useState(1);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [keepSide, setKeepSide] = useState('left'); // left = keepRecord is keeper
  const [impact, setImpact] = useState(null);
  const [confirmState, setConfirmState] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState(null);
  const searchTimer = useRef(null);
  const confirmRef = useRef(null);

  const keeper = keepSide === 'left' ? keepRecord : selected;
  const loser  = keepSide === 'left' ? selected : keepRecord;

  /* ── Search ── */
  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      let rows = [];
      const eq = encodeURIComponent(q);
      if (type === 'contact') {
        rows = await db.select('contacts', `or=(name.ilike.*${eq}*,phone.ilike.*${eq}*)&select=id,name,phone,email,role&limit=20&order=name.asc`);
      } else if (type === 'claim') {
        rows = await db.select('claims', `or=(claim_number.ilike.*${eq}*,insurance_carrier.ilike.*${eq}*)&select=id,claim_number,insurance_carrier,date_of_loss,status&limit=20&order=claim_number.asc`);
      } else {
        rows = await db.select('jobs', `or=(job_number.ilike.*${eq}*,insured_name.ilike.*${eq}*)&select=id,job_number,insured_name,division,phase&limit=20&order=job_number.desc`);
      }
      setResults((rows || []).filter(r => r.id !== keepRecord.id));
    } catch { setResults([]); }
    setSearching(false);
  }, [db, type, keepRecord.id]);

  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(search), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search, doSearch]);

  /* ── Select duplicate & load full record + impact counts ── */
  const selectRecord = useCallback(async (row) => {
    setSearching(true);
    try {
      let full;
      if (type === 'contact') {
        const r = await db.select('contacts', `id=eq.${row.id}`);
        full = r?.[0];
      } else if (type === 'claim') {
        const r = await db.select('claims', `id=eq.${row.id}`);
        full = r?.[0];
      } else {
        const r = await db.select('jobs', `id=eq.${row.id}`);
        full = r?.[0];
      }
      if (!full) { toast('Record not found', 'error'); return; }
      setSelected(full);
      setKeepSide('left');
      setStep(2);

      // Load impact counts for the merge candidate (loser defaults to selected)
      await loadImpact(row.id);
    } catch (e) { toast('Failed to load record: ' + e.message, 'error'); }
    setSearching(false);
  }, [db, type]);

  const loadImpact = useCallback(async (mergeId) => {
    try {
      let counts = {};
      if (type === 'contact') {
        const [claims, jobs, convos] = await Promise.all([
          db.select('claims', `contact_id=eq.${mergeId}&select=id`),
          db.select('jobs', `primary_contact_id=eq.${mergeId}&select=id`),
          db.select('conversation_participants', `contact_id=eq.${mergeId}&select=id`),
        ]);
        counts = { claims: claims?.length || 0, jobs: jobs?.length || 0, conversations: convos?.length || 0 };
      } else if (type === 'claim') {
        const jobs = await db.select('jobs', `claim_id=eq.${mergeId}&select=id`);
        counts = { jobs: jobs?.length || 0 };
      } else {
        const [docs, payments, time] = await Promise.all([
          db.select('job_documents', `job_id=eq.${mergeId}&select=id`),
          db.select('payments', `job_id=eq.${mergeId}&select=id`),
          db.select('job_time_entries', `job_id=eq.${mergeId}&select=id`),
        ]);
        counts = { documents: docs?.length || 0, payments: payments?.length || 0, timeEntries: time?.length || 0 };
      }
      setImpact(counts);
    } catch { setImpact(null); }
  }, [db, type]);

  /* When user swaps sides, reload impact for the new loser */
  const handleSwap = useCallback(() => {
    const newSide = keepSide === 'left' ? 'right' : 'left';
    setKeepSide(newSide);
    setConfirmState(false);
    const newLoserId = newSide === 'left' ? selected.id : keepRecord.id;
    loadImpact(newLoserId);
  }, [keepSide, selected, keepRecord, loadImpact]);

  /* ── Execute merge ── */
  const executeMerge = useCallback(async () => {
    if (!confirmState) { setConfirmState(true); return; }
    setMerging(true);
    setError(null);
    try {
      const result = await db.rpc(RPC_MAP[type], { p_keep_id: keeper.id, p_merge_id: loser.id });
      if (result?.ok === false) throw new Error(result.error || 'Merge failed');
      toast(`${LABELS[type].singular} merged successfully`);
      onMerged(result);
    } catch (e) {
      const msg = e?.message || 'Merge failed';
      setError(msg);
      setConfirmState(false);
      setMerging(false);
    }
  }, [confirmState, db, type, keeper, loser, onMerged]);

  const fields = MERGE_FIELDS[type] || [];
  const label = LABELS[type];

  /* ── Overlay + panel styles ── */
  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 40, overflowY: 'auto' };
  const panel = { background: 'var(--bg-primary)', borderRadius: 'var(--radius-xl)', width: '95%', maxWidth: 820, maxHeight: 'calc(100vh - 80px)', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', border: '1px solid var(--border-color)' };
  const header = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border-color)' };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={header}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
            {step === 1 ? `Merge ${label.singular} — Find Duplicate` : `Merge ${label.singular} — Compare & Confirm`}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-tertiary)', padding: 4 }}>×</button>
        </div>

        <div style={{ padding: '16px 20px' }}>
          {step === 1 && <StepSearch
            search={search} setSearch={setSearch} results={results}
            searching={searching} label={label} type={type}
            keepRecord={keepRecord} onSelect={selectRecord}
          />}
          {step === 2 && selected && <StepCompare
            type={type} fields={fields} keeper={keeper} loser={loser}
            keepSide={keepSide} onSwap={handleSwap} impact={impact}
            confirmState={confirmState} merging={merging} error={error}
            onConfirm={executeMerge} onBack={() => { setStep(1); setSelected(null); setImpact(null); setConfirmState(false); setError(null); }}
            confirmRef={confirmRef} setConfirmState={setConfirmState}
          />}
        </div>
      </div>
    </div>
  );
}

/* ── Step 1: Search ── */
function StepSearch({ search, setSearch, results, searching, label, type, keepRecord, onSelect }) {
  const sub = type === 'contact' ? (keepRecord.name || keepRecord.phone)
    : type === 'claim' ? keepRecord.claim_number
    : keepRecord.job_number;
  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
        Keeping: <strong>{sub || 'Current record'}</strong> — search for the duplicate to merge into it.
      </div>
      <input
        type="text" value={search} onChange={e => setSearch(e.target.value)}
        placeholder={label.searchPlaceholder} autoFocus
        style={{ width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
      />
      {searching && <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Searching...</div>}
      {!searching && results.length > 0 && (
        <div style={{ marginTop: 8, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {results.map((r, i) => (
            <button key={r.id} onClick={() => onSelect(r)} style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 14px',
              background: 'var(--bg-primary)', border: 'none', borderBottom: i < results.length - 1 ? '1px solid var(--border-light)' : 'none',
              cursor: 'pointer', textAlign: 'left', fontSize: 13, color: 'var(--text-primary)',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{label.identifier(r)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {type === 'contact' && [r.phone, r.email, r.role].filter(Boolean).join(' · ')}
                  {type === 'claim' && [r.insurance_carrier, r.date_of_loss ? fmtDate(r.date_of_loss) : null, r.status].filter(Boolean).join(' · ')}
                  {type === 'job' && [r.insured_name, r.division, r.phase].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>Select</span>
            </button>
          ))}
        </div>
      )}
      {!searching && search.length >= 2 && results.length === 0 && (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>No results found</div>
      )}
    </div>
  );
}

/* ── Step 2: Compare ── */
function StepCompare({ type, fields, keeper, loser, keepSide, onSwap, impact, confirmState, merging, error, onConfirm, onBack, confirmRef, setConfirmState }) {
  const keepBorder = '2px solid #16a34a';
  const loseBorder = '2px solid #dc2626';
  const label = LABELS[type];

  return (
    <div>
      {/* Back button */}
      <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--accent)', padding: 0, marginBottom: 12 }}>
        ← Back to search
      </button>

      {/* Swap button */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <button onClick={onSwap} className="btn btn-secondary btn-sm" style={{ gap: 6 }}>
          ⇄ Swap Keep / Delete
        </button>
      </div>

      {/* Two-column comparison */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Keep column */}
        <div style={{ border: keepBorder, borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <div style={{ background: '#f0fdf4', padding: '8px 12px', fontSize: 12, fontWeight: 600, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Keep
          </div>
          <div style={{ padding: 0 }}>
            {fields.map((f, i) => <FieldRow key={f.key} field={f} value={keeper?.[f.key]} otherValue={loser?.[f.key]} side="keep" isLast={i === fields.length - 1} />)}
          </div>
        </div>
        {/* Delete column */}
        <div style={{ border: loseBorder, borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <div style={{ background: '#fef2f2', padding: '8px 12px', fontSize: 12, fontWeight: 600, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Merge &amp; Delete
          </div>
          <div style={{ padding: 0 }}>
            {fields.map((f, i) => <FieldRow key={f.key} field={f} value={loser?.[f.key]} otherValue={keeper?.[f.key]} side="lose" isLast={i === fields.length - 1} />)}
          </div>
        </div>
      </div>

      {/* Impact summary */}
      {impact && <ImpactSummary type={type} impact={impact} />}

      {/* Error */}
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#dc2626' }}>
          {error}
        </div>
      )}

      {/* Confirm button — two-click pattern */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button onClick={onBack} className="btn btn-secondary btn-sm">Cancel</button>
        <button
          ref={confirmRef}
          onClick={onConfirm}
          onBlur={() => setConfirmState(false)}
          disabled={merging}
          style={{
            padding: '8px 20px', fontSize: 13, fontWeight: 600, borderRadius: 'var(--radius-md)', border: 'none', cursor: merging ? 'wait' : 'pointer',
            background: confirmState ? '#dc2626' : 'var(--accent)',
            color: '#fff',
            opacity: merging ? 0.6 : 1,
          }}
        >
          {merging ? 'Merging...' : confirmState ? 'Confirm Merge — This cannot be undone' : `Merge ${label.singular}`}
        </button>
      </div>
    </div>
  );
}

/* ── Field Row ── */
function FieldRow({ field, value, otherValue, side, isLast }) {
  const display = fmtValue(value, field);
  const otherDisplay = fmtValue(otherValue, field);
  const isEmpty = display == null;
  const willAutoFill = side === 'keep' && isEmpty && otherDisplay != null && !field.immutable && field.merge !== 'sum';
  const willSum = field.merge === 'sum';

  let bg = 'var(--bg-primary)';
  let extra = null;
  if (willAutoFill) {
    bg = '#eff6ff';
    extra = <span style={{ fontSize: 10, color: '#2563eb', fontWeight: 500, marginLeft: 4 }}>← will auto-fill</span>;
  }
  if (willSum && side === 'keep') {
    const sum = (Number(value) || 0) + (Number(otherValue) || 0);
    if (sum > 0) extra = <span style={{ fontSize: 10, color: '#7c3aed', fontWeight: 500, marginLeft: 4 }}>sum: {fmtCurrency(sum)}</span>;
  }

  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '6px 12px', borderBottom: isLast ? 'none' : '1px solid var(--border-light)', background: bg, minHeight: 28 }}>
      <div style={{ width: 100, flexShrink: 0, fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500 }}>{field.label}</div>
      <div style={{ flex: 1, fontSize: 13, color: isEmpty ? 'var(--text-tertiary)' : 'var(--text-primary)', fontStyle: isEmpty ? 'italic' : 'normal', wordBreak: 'break-word' }}>
        {display || '—'}
        {extra}
      </div>
    </div>
  );
}

/* ── Impact Summary ── */
function ImpactSummary({ type, impact }) {
  let items = [];
  if (type === 'contact') {
    if (impact.claims) items.push(`${impact.claims} claim${impact.claims !== 1 ? 's' : ''}`);
    if (impact.jobs) items.push(`${impact.jobs} job${impact.jobs !== 1 ? 's' : ''}`);
    if (impact.conversations) items.push(`${impact.conversations} conversation${impact.conversations !== 1 ? 's' : ''}`);
  } else if (type === 'claim') {
    if (impact.jobs) items.push(`${impact.jobs} job${impact.jobs !== 1 ? 's' : ''}`);
  } else {
    if (impact.documents) items.push(`${impact.documents} document${impact.documents !== 1 ? 's' : ''}`);
    if (impact.payments) items.push(`${impact.payments} payment${impact.payments !== 1 ? 's' : ''}`);
    if (impact.timeEntries) items.push(`${impact.timeEntries} time entr${impact.timeEntries !== 1 ? 'ies' : 'y'}`);
  }

  if (items.length === 0) return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
      No related records will be moved.
    </div>
  );

  return (
    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#92400e' }}>
      <strong>Will move:</strong> {items.join(', ')} to the kept record.
    </div>
  );
}
