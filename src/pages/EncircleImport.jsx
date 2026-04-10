import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';

const DIVISIONS = [
  { key: 'water',          label: 'Water Mitigation', prefix: 'W-' },
  { key: 'mold',           label: 'Mold Remediation', prefix: 'M-' },
  { key: 'fire',           label: 'Fire',             prefix: 'F-' },
  { key: 'reconstruction', label: 'Reconstruction',   prefix: 'R-' },
  { key: 'contents',       label: 'Contents',         prefix: 'C-' },
  { key: 'general',        label: 'General',          prefix: 'G-' },
];

const SEARCH_MODES = [
  { key: 'policyholder_name',    label: 'Name' },
  { key: 'contractor_identifier', label: 'Job #' },
  { key: 'assignment_identifier', label: 'Assignment #' },
];

function parseAddressParts(fullAddress) {
  if (!fullAddress) return { address: '', city: '', state: '', zip: '' };
  const parts = fullAddress.split(',').map(s => s.trim());
  if (parts.length >= 3) {
    const stateZip = parts[parts.length - 1].split(/\s+/);
    return { address: parts[0], city: parts[1], state: stateZip[0] || '', zip: stateZip[1] || '' };
  }
  if (parts.length === 2) return { address: parts[0], city: parts[1], state: '', zip: '' };
  return { address: fullAddress, city: '', state: '', zip: '' };
}

function toast(message, type = 'success') {
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));
}

export default function EncircleImport() {
  const { db } = useAuth();

  // Search state
  const [searchMode, setSearchMode] = useState('policyholder_name');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [importedIds, setImportedIds] = useState(new Set());
  const debounceRef = useRef(null);

  // Selected claim / preview
  const [selected, setSelected] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Import form state
  const [form, setForm] = useState({});
  const [selectedDivisions, setSelectedDivisions] = useState(['water']);

  // Import progress
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importStep, setImportStep] = useState(null); // 'contact' | 'claim' | 'jobs' | 'encircle' | 'done'

  // ── Search ──────────────────────────────────────────────────────────────────

  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch(`/api/encircle-import?action=search&${searchMode}=${encodeURIComponent(q)}&limit=20`, { headers: auth });
      const data = await res.json();
      const list = data.list || [];
      setResults(list);

      // Batch check which are already imported
      if (list.length > 0) {
        const ids = list.map(c => String(c.id));
        const existing = await db.select('jobs', `encircle_claim_id=in.(${ids.join(',')})&select=encircle_claim_id`);
        setImportedIds(new Set((existing || []).map(j => j.encircle_claim_id)));
      }
    } catch (e) {
      toast('Search failed: ' + e.message, 'error');
    } finally {
      setSearching(false);
    }
  }, [searchMode, db]);

  const handleQueryChange = useCallback((val) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  }, [doSearch]);

  // Reset search when mode changes
  useEffect(() => {
    setResults([]);
    setSelected(null);
    setImportResult(null);
    if (query.length >= 2) doSearch(query);
  }, [searchMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Select claim → load detail ──────────────────────────────────────────────

  const selectClaim = useCallback(async (claim) => {
    setImportResult(null);
    setImportStep(null);
    setLoadingDetail(true);
    setSelected(claim);

    try {
      const auth = await getAuthHeader();
      const res = await fetch(`/api/encircle-import?action=get&claim_id=${claim.id}`, { headers: auth });
      const detail = await res.json();
      const parsed = parseAddressParts(detail.full_address);

      setForm({
        name: detail.policyholder_name || '',
        phone: detail.policyholder_phone_number || '',
        email: detail.policyholder_email_address || '',
        address: parsed.address,
        city: parsed.city,
        state: parsed.state,
        zip: parsed.zip,
        insurance_company: detail.insurance_company_name || '',
        insurance_claim_number: detail.insurer_identifier || '',
        policy_number: detail.policy_number || '',
        adjuster_name: detail.adjuster_name || '',
        date_of_loss: detail.date_of_loss || '',
        type_of_loss: detail.type_of_loss || '',
        cat_code: detail.cat_code || '',
        broker_agent: detail.broker_or_agent_name || '',
        project_manager: detail.project_manager_name || '',
        encircle_summary: detail.loss_details || '',
        carrier_identifier: detail.carrier_identifier || '',
        assignment_identifier: detail.assignment_identifier || '',
      });
      setSelectedDivisions(['water']);
    } catch (e) {
      toast('Failed to load claim details', 'error');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  // ── Import ──────────────────────────────────────────────────────────────────

  const doImport = useCallback(async () => {
    if (!form.phone) { toast('Phone is required', 'error'); return; }
    if (selectedDivisions.length === 0) { toast('Select at least one division', 'error'); return; }

    setImporting(true);
    setImportStep('contact');

    try {
      // Simulate progress steps with slight delay for UX
      setTimeout(() => setImportStep('claim'), 400);
      setTimeout(() => setImportStep('jobs'), 800);
      setTimeout(() => setImportStep('encircle'), 1200);

      const auth = await getAuthHeader();
      const res = await fetch('/api/encircle-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          action: 'import',
          encircle_claim_id: selected.id,
          ...form,
          divisions: selectedDivisions,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        toast(data.error || 'Import failed', 'error');
        setImportStep(null);
        return;
      }

      setImportStep('done');
      setImportResult(data);
      setImportedIds(prev => new Set([...prev, String(selected.id)]));
      toast(`Imported ${data.claim_number} — ${data.jobs.length} job(s) created`, 'success');
    } catch (e) {
      toast('Import failed: ' + e.message, 'error');
      setImportStep(null);
    } finally {
      setImporting(false);
    }
  }, [form, selectedDivisions, selected]);

  const resetImport = () => {
    setSelected(null);
    setImportResult(null);
    setImportStep(null);
    setForm({});
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: 1200, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0, marginBottom: 4 }}>
          Encircle Import
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
          Search Encircle claims, preview data, select divisions, and import as UPR jobs.
        </p>
      </div>

      {/* Search bar */}
      <div style={{
        display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)',
        flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{
          display: 'flex', borderRadius: 'var(--radius-md)', overflow: 'hidden',
          border: '1px solid var(--border-color)',
        }}>
          {SEARCH_MODES.map(m => (
            <button
              key={m.key}
              onClick={() => setSearchMode(m.key)}
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: searchMode === m.key ? 'var(--accent)' : 'var(--bg-secondary)',
                color: searchMode === m.key ? '#fff' : 'var(--text-secondary)',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          placeholder={`Search by ${SEARCH_MODES.find(m => m.key === searchMode)?.label.toLowerCase()}...`}
          style={{
            flex: 1, minWidth: 200, padding: '8px 12px', fontSize: 14,
            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
            background: 'var(--bg-primary)', color: 'var(--text-primary)',
            fontFamily: 'var(--font-sans)', outline: 'none',
          }}
        />

        {results.length > 0 && (
          <span style={{
            fontSize: 12, fontWeight: 600, padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            background: 'var(--accent-light)', color: 'var(--accent)',
          }}>
            {results.length} result{results.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Main content: results list + preview side by side */}
      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
        {/* Results column */}
        <div style={{ flex: '0 0 420px', maxWidth: 420 }}>
          {searching && (
            <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-tertiary)', fontSize: 13 }}>
              Searching Encircle...
            </div>
          )}

          {!searching && results.length === 0 && query.length >= 2 && (
            <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-tertiary)', fontSize: 13 }}>
              No claims found.
            </div>
          )}

          {!searching && results.length === 0 && query.length < 2 && (
            <div style={{
              textAlign: 'center', padding: 'var(--space-8)',
              color: 'var(--text-tertiary)', fontSize: 13,
              border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-lg)',
            }}>
              Type at least 2 characters to search Encircle claims.
            </div>
          )}

          {results.map(claim => {
            const isImported = importedIds.has(String(claim.id));
            const isSelected = selected?.id === claim.id;
            return (
              <div
                key={claim.id}
                onClick={() => selectClaim(claim)}
                style={{
                  padding: 'var(--space-3) var(--space-4)',
                  borderRadius: 'var(--radius-lg)',
                  border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border-color)'}`,
                  background: isSelected ? 'var(--accent-light)' : 'var(--bg-primary)',
                  marginBottom: 'var(--space-2)',
                  cursor: 'pointer',
                  transition: 'border-color 0.12s, background 0.12s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {claim.policyholder_name || 'Unknown'}
                  </span>
                  <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                    {claim.contractor_identifier && (
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px',
                        borderRadius: 'var(--radius-full)',
                        background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe',
                      }}>
                        {claim.contractor_identifier}
                      </span>
                    )}
                    {isImported && (
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px',
                        borderRadius: 'var(--radius-full)',
                        background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0',
                      }}>
                        Imported
                      </span>
                    )}
                  </div>
                </div>
                {claim.full_address && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>
                    {claim.full_address}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'flex', gap: 'var(--space-3)' }}>
                  {claim.insurance_company_name && <span>{claim.insurance_company_name}</span>}
                  {claim.date_of_loss && <span>DOL: {claim.date_of_loss}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Preview / Import panel */}
        {selected && (
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Success state */}
            {importResult && (
              <div style={{
                borderRadius: 'var(--radius-lg)',
                border: '1px solid #bbf7d0',
                background: '#f0fdf4',
                padding: 'var(--space-5)',
              }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#16a34a', marginBottom: 'var(--space-3)' }}>
                  Import Successful
                </div>
                <div style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>
                  <strong>CLM Number:</strong> {importResult.claim_number}
                </div>
                <div style={{ fontSize: 14, marginBottom: 'var(--space-3)' }}>
                  <strong>Jobs Created:</strong>{' '}
                  {importResult.jobs.map(j => j.job_number).join(', ')}
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <a
                    href={`/claims/${importResult.claim_id}`}
                    className="btn btn-primary btn-sm"
                    style={{ textDecoration: 'none' }}
                  >
                    View Claim
                  </a>
                  <button className="btn btn-secondary btn-sm" onClick={resetImport}>
                    Import Another
                  </button>
                </div>
                {importResult.encircle_writeback && (
                  <div style={{ fontSize: 11, color: '#16a34a', marginTop: 'var(--space-2)' }}>
                    CLM number written back to Encircle.
                  </div>
                )}
              </div>
            )}

            {/* Import form */}
            {!importResult && (
              <div style={{
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-color)',
                overflow: 'hidden',
              }}>
                {/* Header */}
                <div style={{
                  padding: 'var(--space-3) var(--space-4)',
                  background: 'var(--bg-secondary)',
                  borderBottom: '1px solid var(--border-color)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                    Import Preview
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setSelected(null); setForm({}); }}
                  >
                    Close
                  </button>
                </div>

                {loadingDetail ? (
                  <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-tertiary)', fontSize: 13 }}>
                    Loading claim details...
                  </div>
                ) : (
                  <div style={{ padding: 'var(--space-4)' }}>
                    {/* Progress indicator */}
                    {importStep && (
                      <div style={{
                        display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)',
                        fontSize: 12, fontWeight: 600,
                      }}>
                        {['contact', 'claim', 'jobs', 'encircle'].map(step => {
                          const steps = ['contact', 'claim', 'jobs', 'encircle'];
                          const currentIdx = steps.indexOf(importStep);
                          const stepIdx = steps.indexOf(step);
                          const done = importStep === 'done' || stepIdx < currentIdx;
                          const active = stepIdx === currentIdx && importStep !== 'done';
                          return (
                            <span key={step} style={{
                              color: done ? '#16a34a' : active ? 'var(--accent)' : 'var(--text-tertiary)',
                            }}>
                              {done ? '\u2713' : active ? '\u25CF' : '\u25CB'}{' '}
                              {step.charAt(0).toUpperCase() + step.slice(1)}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Form fields */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                      <FormField label="Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
                      <FormField label="Phone *" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} required />
                      <FormField label="Email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} />
                      <FormField label="Address" value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} />
                      <FormField label="City" value={form.city} onChange={v => setForm(f => ({ ...f, city: v }))} />
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <FormField label="State" value={form.state} onChange={v => setForm(f => ({ ...f, state: v }))} style={{ flex: 1 }} />
                        <FormField label="Zip" value={form.zip} onChange={v => setForm(f => ({ ...f, zip: v }))} style={{ flex: 1 }} />
                      </div>
                      <FormField label="Insurance Company" value={form.insurance_company} onChange={v => setForm(f => ({ ...f, insurance_company: v }))} />
                      <FormField label="Insurance Claim #" value={form.insurance_claim_number} onChange={v => setForm(f => ({ ...f, insurance_claim_number: v }))} />
                      <FormField label="Policy #" value={form.policy_number} onChange={v => setForm(f => ({ ...f, policy_number: v }))} />
                      <FormField label="Adjuster" value={form.adjuster_name} onChange={v => setForm(f => ({ ...f, adjuster_name: v }))} />
                      <FormField label="Date of Loss" value={form.date_of_loss} onChange={v => setForm(f => ({ ...f, date_of_loss: v }))} type="date" />
                      <FormField label="Type of Loss" value={form.type_of_loss} onChange={v => setForm(f => ({ ...f, type_of_loss: v }))} />
                      <FormField label="CAT Code" value={form.cat_code} onChange={v => setForm(f => ({ ...f, cat_code: v }))} />
                      <FormField label="Broker/Agent" value={form.broker_agent} onChange={v => setForm(f => ({ ...f, broker_agent: v }))} />
                      <FormField label="Project Manager" value={form.project_manager} onChange={v => setForm(f => ({ ...f, project_manager: v }))} span2 />
                    </div>

                    {/* Summary */}
                    {form.encircle_summary && (
                      <div style={{ marginTop: 'var(--space-3)' }}>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>
                          Loss Details
                        </label>
                        <div style={{
                          fontSize: 13, color: 'var(--text-secondary)',
                          padding: 'var(--space-2) var(--space-3)',
                          background: 'var(--bg-secondary)',
                          borderRadius: 'var(--radius-md)',
                          maxHeight: 80, overflow: 'auto',
                        }}>
                          {form.encircle_summary}
                        </div>
                      </div>
                    )}

                    {/* Division checkboxes */}
                    <div style={{ marginTop: 'var(--space-4)' }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 'var(--space-2)' }}>
                        Divisions (select at least one)
                      </label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                        {DIVISIONS.map(d => {
                          const checked = selectedDivisions.includes(d.key);
                          return (
                            <label
                              key={d.key}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '6px 12px', borderRadius: 'var(--radius-md)',
                                border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-color)'}`,
                                background: checked ? 'var(--accent-light)' : 'var(--bg-primary)',
                                cursor: 'pointer', fontSize: 13, fontWeight: 500,
                                color: checked ? 'var(--accent)' : 'var(--text-secondary)',
                                userSelect: 'none',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setSelectedDivisions(prev =>
                                    checked ? prev.filter(k => k !== d.key) : [...prev, d.key]
                                  );
                                }}
                                style={{ accentColor: 'var(--accent)' }}
                              />
                              {d.label} <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>({d.prefix})</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Import button */}
                    <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' }}>
                      {importedIds.has(String(selected.id)) ? (
                        <ReimportButton onClick={doImport} importing={importing} />
                      ) : (
                        <button
                          className="btn btn-primary"
                          onClick={doImport}
                          disabled={importing || !form.phone || selectedDivisions.length === 0}
                          style={{ fontSize: 14, padding: '10px 24px' }}
                        >
                          {importing ? 'Importing...' : `Import ${selectedDivisions.length} Job${selectedDivisions.length !== 1 ? 's' : ''}`}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FormField({ label, value, onChange, type = 'text', required, span2, style }) {
  return (
    <div style={{ ...(span2 ? { gridColumn: 'span 2' } : {}), ...style }}>
      <label style={{
        fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        display: 'block', marginBottom: 4,
      }}>
        {label}
      </label>
      <input
        type={type}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        required={required}
        style={{
          width: '100%', padding: '6px 10px', fontSize: 13,
          border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
          background: 'var(--bg-primary)', color: 'var(--text-primary)',
          fontFamily: 'var(--font-sans)', outline: 'none',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

// Two-click re-import button (from CLAUDE.md pattern)
function ReimportButton({ onClick, importing }) {
  const [confirmState, setConfirmState] = useState(false);

  const handleClick = () => {
    if (!confirmState) { setConfirmState(true); return; }
    setConfirmState(false);
    onClick();
  };

  return (
    <button
      onClick={handleClick}
      onBlur={() => setConfirmState(false)}
      disabled={importing}
      style={{
        fontSize: 14, padding: '10px 24px', fontWeight: 600, cursor: 'pointer',
        borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-sans)',
        border: `1px solid ${confirmState ? '#fde68a' : 'var(--accent)'}`,
        background: confirmState ? '#fffbeb' : 'var(--accent)',
        color: confirmState ? '#d97706' : '#fff',
        transition: 'all 0.12s',
      }}
    >
      {importing ? 'Importing...' : confirmState ? 'Confirm Re-import?' : 'Re-import'}
    </button>
  );
}
