import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import AddContactModal, { LookupSelect } from '@/components/AddContactModal';

/* ═══ ICONS ═══ */
function IconSearch(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>);}
function IconPlus(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);}
function IconCheck(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="20 6 9 17 4 12"/></svg>);}
function IconUser(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>);}
function IconX(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>);}
function IconEdit(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>);}
function IconMapPin(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>);}

const DIVISION_OPTIONS = [
  { value: 'water', label: '💧 Water Mitigation' },
  { value: 'mold', label: '🦠 Mold Remediation' },
  { value: 'reconstruction', label: '🏗️ Reconstruction' },
  { value: 'fire', label: '🔥 Fire' },
  { value: 'contents', label: '📦 Contents' },
];

const SOURCE_OPTIONS = [
  { value: 'insurance', label: 'Insurance' },
  { value: 'retail', label: 'Retail / Cash' },
  { value: 'hoa', label: 'HOA' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'tpa', label: 'TPA' },
];

const PRIORITY_OPTIONS = [
  { value: 1, label: 'Urgent' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Normal' },
  { value: 4, label: 'Low' },
];

export default function CreateJob() {
  const navigate = useNavigate();
  const { db, employee: currentUser } = useAuth();

  // ── Contact state ──
  const [contactSearch, setContactSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null); // existing contact object
  const [showAddContact, setShowAddContact] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef(null);
  const searchTimer = useRef(null);

  // ── Address confirmation ──
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);

  // ── Job form ──
  const [form, setForm] = useState({
    division: 'water',
    source: 'insurance',
    priority: 3,
    type_of_loss: '',
    address: '',
    city: '',
    state: 'UT',
    zip: '',
    insurance_company: '',
    claim_number: '',
    policy_number: '',
    adjuster_name: '',
    adjuster_phone: '',
    adjuster_email: '',
    cat_code: '',
    date_of_loss: '',
    target_completion: '',
    project_manager_id: currentUser?.role === 'project_manager' ? currentUser?.id : '',
    lead_tech_id: '',
    internal_notes: '',
  });

  const [employees, setEmployees] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Load supporting data
  useEffect(() => {
    (async () => {
      try {
        const [emps, carr] = await Promise.all([
          db.select('employees', 'is_active=eq.true&order=full_name.asc&select=id,full_name,role'),
          db.select('insurance_carriers', 'order=name.asc&select=id,name,short_name').catch(() => []),
        ]);
        setEmployees(emps);
        setCarriers(carr);
      } catch (err) { console.error('Load data:', err); }
    })();
  }, []);

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  // ── Contact Search (debounced) ──
  const handleContactSearch = useCallback(async (query) => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    setSearching(true);
    try {
      const results = await db.rpc('search_contacts_for_job', { p_query: query.trim() });
      setSearchResults(Array.isArray(results) ? results : []);
      setShowDropdown(true);
    } catch (err) {
      console.error('Contact search:', err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [db]);

  const onSearchChange = (e) => {
    const val = e.target.value;
    setContactSearch(val);
    clearTimeout(searchTimer.current);
    if (val.trim().length >= 2) {
      searchTimer.current = setTimeout(() => handleContactSearch(val), 300);
    } else {
      setSearchResults([]);
      setShowDropdown(false);
    }
  };

  // ── Select existing contact ──
  const handleSelectContact = (contact) => {
    setSelectedContact(contact);
    setContactSearch('');
    setShowDropdown(false);
    setAddressConfirmed(false);
    setEditingAddress(false);

    // Auto-fill job address from contact's billing address
    const hasAddress = contact.billing_address || contact.billing_city;
    if (hasAddress) {
      setForm(prev => ({
        ...prev,
        address: contact.billing_address || '',
        city: contact.billing_city || '',
        state: contact.billing_state || 'UT',
        zip: contact.billing_zip || '',
      }));
    } else {
      // No address on contact — go straight to editable
      setAddressConfirmed(true);
      setEditingAddress(true);
    }
  };

  // ── New contact created from AddContactModal ──
  const handleNewContact = async (contactData) => {
    try {
      const result = await db.insert('contacts', contactData);
      if (result?.length > 0) {
        const newContact = result[0];
        setSelectedContact(newContact);
        setShowAddContact(false);

        // Auto-fill address
        const hasAddr = newContact.billing_address || newContact.billing_city;
        if (hasAddr) {
          setForm(prev => ({
            ...prev,
            address: newContact.billing_address || '',
            city: newContact.billing_city || '',
            state: newContact.billing_state || 'UT',
            zip: newContact.billing_zip || '',
          }));
        }
        setAddressConfirmed(true); // New contact — address is fresh, auto-confirm
      }
    } catch (err) {
      console.error('Create contact:', err);
      alert('Failed to create contact: ' + err.message);
      throw err;
    }
  };

  // ── Clear selected contact ──
  const handleClearContact = () => {
    setSelectedContact(null);
    setAddressConfirmed(false);
    setEditingAddress(false);
    setForm(prev => ({ ...prev, address: '', city: '', state: 'UT', zip: '' }));
  };

  // ── Confirm address ──
  const handleConfirmAddress = () => {
    setAddressConfirmed(true);
    setEditingAddress(false);
  };

  // ── Normalize phone ──
  const normalizePhone = (raw) => {
    let p = (raw || '').replace(/\D/g, '');
    if (p.length === 10) p = '1' + p;
    if (!p.startsWith('+')) p = '+' + p;
    return p;
  };

  // ── Format phone for display ──
  const fmtPhone = (phone) => {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    const n = digits.startsWith('1') ? digits.slice(1) : digits;
    if (n.length === 10) return `(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}`;
    return phone;
  };

  // ── SUBMIT ──
  const handleSubmit = async () => {
    if (!selectedContact) {
      setError('Please select or create a client first.');
      return;
    }
    if (!addressConfirmed) {
      setError('Please confirm the job address.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const result = await db.rpc('create_job_with_contact', {
        p_contact_id: selectedContact.id,
        p_contact_name: selectedContact.name,
        p_contact_phone: selectedContact.phone,
        p_contact_email: selectedContact.email || null,
        p_contact_role: selectedContact.role || 'homeowner',
        p_billing_address: selectedContact.billing_address || form.address || null,
        p_billing_city: selectedContact.billing_city || form.city || null,
        p_billing_state: selectedContact.billing_state || form.state || null,
        p_billing_zip: selectedContact.billing_zip || form.zip || null,
        // Job fields
        p_division: form.division,
        p_source: form.source,
        p_priority: form.priority,
        p_type_of_loss: form.type_of_loss || null,
        p_date_of_loss: form.date_of_loss || null,
        p_target_completion: form.target_completion || null,
        p_address: form.address || null,
        p_city: form.city || null,
        p_state: form.state || null,
        p_zip: form.zip || null,
        p_insurance_company: form.insurance_company || null,
        p_claim_number: form.claim_number || null,
        p_job_policy_number: form.policy_number || null,
        p_adjuster_name: form.adjuster_name || null,
        p_adjuster_phone: form.adjuster_phone || null,
        p_adjuster_email: form.adjuster_email || null,
        p_cat_code: form.cat_code || null,
        p_project_manager_id: form.project_manager_id || null,
        p_lead_tech_id: form.lead_tech_id || null,
        p_internal_notes: form.internal_notes || null,
      });

      if (result?.job?.id) {
        navigate(`/jobs/${result.job.id}`, { replace: true });
      } else {
        navigate('/jobs', { replace: true });
      }
    } catch (err) {
      console.error('Create job error:', err);
      setError('Failed to create job: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Close dropdown on outside click ──
  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="create-job-page">
      {/* ══ Header ══ */}
      <div className="create-job-header">
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ marginBottom: 8, gap: 4 }}>← Back</button>
          <h1 className="page-title">New Job</h1>
        </div>
        <div className="create-job-header-actions">
          <button className="btn btn-secondary" onClick={() => navigate(-1)} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit}
            disabled={saving || !selectedContact || !addressConfirmed}>
            {saving ? 'Creating...' : 'Create Job'}
          </button>
        </div>
      </div>

      {error && <div className="create-job-error">{error}</div>}

      {/* ═══════════════════════════════════════════════════
          STEP 1: CLIENT SELECTION
          ═══════════════════════════════════════════════════ */}
      <div className="create-job-client-section">
        <div className="create-job-section-title">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="create-job-step-num">1</span>
            Client
          </span>
          {selectedContact && <span style={{ fontSize: 11, color: 'var(--status-resolved)', fontWeight: 600 }}>✓ Selected</span>}
        </div>

        {!selectedContact ? (
          /* ── Search bar ── */
          <div className="create-job-client-search" ref={searchRef}>
            <div className="create-job-search-row">
              <div className="create-job-search-wrap">
                <IconSearch style={{ width: 14, height: 14, position: 'absolute', left: 10, top: 10, color: 'var(--text-tertiary)' }} />
                <input
                  className="input"
                  placeholder="Search existing clients by name, phone, or email..."
                  value={contactSearch}
                  onChange={onSearchChange}
                  autoFocus
                  style={{ paddingLeft: 32 }}
                />
                {searching && <div className="create-job-search-spinner"><div className="spinner" style={{ width: 14, height: 14 }} /></div>}
              </div>
              <button className="btn btn-primary" onClick={() => setShowAddContact(true)}
                style={{ flexShrink: 0, gap: 4 }}>
                <IconPlus style={{ width: 14, height: 14 }} /> New Client
              </button>
            </div>

            {/* Search results dropdown */}
            {showDropdown && (
              <div className="create-job-search-dropdown">
                {searchResults.length === 0 ? (
                  <div className="create-job-search-empty">
                    {contactSearch.trim().length >= 2 ? (
                      <>No clients found for "{contactSearch}". <button className="btn-link" onClick={() => setShowAddContact(true)}>Create new client</button></>
                    ) : 'Type at least 2 characters to search'}
                  </div>
                ) : (
                  searchResults.map(c => (
                    <button key={c.id} className="create-job-search-result" onClick={() => handleSelectContact(c)}>
                      <div className="create-job-result-left">
                        <IconUser style={{ width: 16, height: 16, color: 'var(--text-tertiary)', flexShrink: 0 }} />
                        <div>
                          <div className="create-job-result-name">{c.name}</div>
                          <div className="create-job-result-meta">
                            {fmtPhone(c.phone)}
                            {c.email && <> · {c.email}</>}
                          </div>
                          {c.billing_address && (
                            <div className="create-job-result-meta">{c.billing_address}{c.billing_city ? `, ${c.billing_city}` : ''}</div>
                          )}
                        </div>
                      </div>
                      {c.job_count > 0 && (
                        <span className="create-job-result-badge">{c.job_count} job{c.job_count !== 1 ? 's' : ''}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          /* ── Selected contact card ── */
          <div className="create-job-selected-contact">
            <div className="create-job-contact-card">
              <div className="create-job-contact-avatar">
                {selectedContact.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'}
              </div>
              <div className="create-job-contact-info">
                <div className="create-job-contact-name">{selectedContact.name}</div>
                <div className="create-job-contact-meta">
                  {fmtPhone(selectedContact.phone)}
                  {selectedContact.email && <> · {selectedContact.email}</>}
                </div>
                {selectedContact.job_count > 0 && (
                  <div className="create-job-contact-jobs">{selectedContact.job_count} existing job{selectedContact.job_count !== 1 ? 's' : ''}</div>
                )}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={handleClearContact}
                style={{ flexShrink: 0 }} title="Change client">
                <IconX style={{ width: 14, height: 14 }} />
              </button>
            </div>

            {/* ── Address Confirmation ── */}
            {!addressConfirmed ? (
              <div className="create-job-address-confirm">
                <div className="create-job-address-label">
                  <IconMapPin style={{ width: 14, height: 14, color: 'var(--text-tertiary)' }} />
                  <span>Is this the job/loss address?</span>
                </div>
                {(form.address || form.city) ? (
                  <div className="create-job-address-display">
                    <div className="create-job-address-text">
                      {form.address && <div>{form.address}</div>}
                      <div>{[form.city, form.state, form.zip].filter(Boolean).join(', ')}</div>
                    </div>
                    <div className="create-job-address-actions">
                      <button className="btn btn-primary btn-sm" onClick={handleConfirmAddress} style={{ gap: 4 }}>
                        <IconCheck style={{ width: 12, height: 12 }} /> Yes
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditingAddress(true)} style={{ gap: 4 }}>
                        <IconEdit style={{ width: 12, height: 12 }} /> Edit
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="create-job-address-display">
                    <div className="create-job-address-text" style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                      No address on file — please enter the loss address
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => { setEditingAddress(true); setAddressConfirmed(false); }}>
                      Add Address
                    </button>
                  </div>
                )}

                {editingAddress && (
                  <div className="create-job-address-edit">
                    <div className="add-contact-row">
                      <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                        <label className="label">Street</label>
                        <input className="input" value={form.address} onChange={e => set('address', e.target.value)} placeholder="1422 E Maple Ridge Dr" autoFocus />
                      </div>
                    </div>
                    <div className="add-contact-row">
                      <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                        <label className="label">City</label>
                        <input className="input" value={form.city} onChange={e => set('city', e.target.value)} placeholder="Lehi" />
                      </div>
                      <div className="form-group" style={{ flex: 0, minWidth: 70, marginBottom: 0 }}>
                        <label className="label">State</label>
                        <input className="input" value={form.state} onChange={e => set('state', e.target.value)} placeholder="UT" />
                      </div>
                      <div className="form-group" style={{ flex: 0, minWidth: 90, marginBottom: 0 }}>
                        <label className="label">ZIP</label>
                        <input className="input" value={form.zip} onChange={e => set('zip', e.target.value)} placeholder="84043" />
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
                      <button className="btn btn-primary btn-sm" onClick={handleConfirmAddress}
                        disabled={!form.address?.trim() && !form.city?.trim()}>
                        Confirm Address
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Address confirmed — show summary with edit button */
              <div className="create-job-address-confirmed">
                <IconMapPin style={{ width: 12, height: 12, color: 'var(--status-resolved)', flexShrink: 0 }} />
                <span className="create-job-address-summary">
                  {[form.address, form.city, form.state, form.zip].filter(Boolean).join(', ') || 'No address'}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => { setAddressConfirmed(false); setEditingAddress(true); }}
                  style={{ padding: '0 4px', height: 20 }}>
                  <IconEdit style={{ width: 11, height: 11 }} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════
          STEP 2: JOB DETAILS (only shown after client selected + address confirmed)
          ═══════════════════════════════════════════════════ */}
      {selectedContact && addressConfirmed && (
        <div className="create-job-details-section" style={{ animation: 'fadeIn 0.2s ease' }}>
          <div className="create-job-grid">
            {/* ── Job Info ── */}
            <div className="create-job-section">
              <div className="create-job-section-title">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span className="create-job-step-num">2</span>
                  Job Information
                </span>
              </div>

              <div className="create-job-field">
                <label className="label">Division *</label>
                <select className="input" value={form.division} onChange={e => set('division', e.target.value)}>
                  {DIVISION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <div className="create-job-row">
                <div className="create-job-field">
                  <label className="label">Source</label>
                  <select className="input" value={form.source} onChange={e => set('source', e.target.value)}>
                    {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="create-job-field">
                  <label className="label">Priority</label>
                  <select className="input" value={form.priority} onChange={e => set('priority', parseInt(e.target.value))}>
                    {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="create-job-field">
                <label className="label">Type of Loss</label>
                <input className="input" value={form.type_of_loss} onChange={e => set('type_of_loss', e.target.value)} placeholder="e.g. Pipe burst, Storm, Sewage backup" />
              </div>

              <div className="create-job-row">
                <div className="create-job-field">
                  <label className="label">Date of Loss</label>
                  <input className="input" type="date" value={form.date_of_loss} onChange={e => set('date_of_loss', e.target.value)} />
                </div>
                <div className="create-job-field">
                  <label className="label">Target Completion</label>
                  <input className="input" type="date" value={form.target_completion} onChange={e => set('target_completion', e.target.value)} />
                </div>
              </div>
            </div>

            {/* ── Insurance ── */}
            <div className="create-job-section">
              <div className="create-job-section-title">Insurance</div>

              <div className="create-job-field">
                <LookupSelect label="Insurance Company" value={form.insurance_company}
                  onChange={v => set('insurance_company', v)} items={carriers} placeholder="Search carriers..." />
              </div>

              <div className="create-job-row">
                <div className="create-job-field">
                  <label className="label">Claim #</label>
                  <input className="input" value={form.claim_number} onChange={e => set('claim_number', e.target.value)} placeholder="Claim number" />
                </div>
                <div className="create-job-field">
                  <label className="label">Policy #</label>
                  <input className="input" value={form.policy_number} onChange={e => set('policy_number', e.target.value)} placeholder="Policy number" />
                </div>
              </div>

              <div className="create-job-field">
                <label className="label">Adjuster Name</label>
                <input className="input" value={form.adjuster_name} onChange={e => set('adjuster_name', e.target.value)} placeholder="Adjuster full name" />
              </div>

              <div className="create-job-row">
                <div className="create-job-field">
                  <label className="label">Adjuster Phone</label>
                  <input className="input" type="tel" value={form.adjuster_phone} onChange={e => set('adjuster_phone', e.target.value)} placeholder="(801) 555-0000" />
                </div>
                <div className="create-job-field">
                  <label className="label">Adjuster Email</label>
                  <input className="input" type="email" value={form.adjuster_email} onChange={e => set('adjuster_email', e.target.value)} placeholder="adjuster@email.com" />
                </div>
              </div>

              <div className="create-job-field">
                <label className="label">CAT Code</label>
                <input className="input" value={form.cat_code} onChange={e => set('cat_code', e.target.value)} placeholder="CAT code (if applicable)" />
              </div>
            </div>

            {/* ── Team ── */}
            <div className="create-job-section">
              <div className="create-job-section-title">Team Assignment</div>

              <div className="create-job-field">
                <label className="label">Project Manager</label>
                <select className="input" value={form.project_manager_id} onChange={e => set('project_manager_id', e.target.value)}>
                  <option value="">Unassigned</option>
                  {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.full_name}</option>)}
                </select>
              </div>

              <div className="create-job-field">
                <label className="label">Lead Tech</label>
                <select className="input" value={form.lead_tech_id} onChange={e => set('lead_tech_id', e.target.value)}>
                  <option value="">Unassigned</option>
                  {employees.filter(e => e.role === 'field_tech').map(emp => <option key={emp.id} value={emp.id}>{emp.full_name}</option>)}
                </select>
              </div>

              <div className="create-job-field">
                <label className="label">Internal Notes</label>
                <textarea className="input textarea" value={form.internal_notes} onChange={e => set('internal_notes', e.target.value)} rows={3} placeholder="Initial notes about the job..." />
              </div>
            </div>
          </div>

          {/* Bottom action bar */}
          <div className="create-job-bottom-bar">
            <button className="btn btn-secondary" onClick={() => navigate(-1)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary btn-lg" onClick={handleSubmit} disabled={saving}>
              {saving ? 'Creating...' : 'Create Job'}
            </button>
          </div>
        </div>
      )}

      {/* ══ Add Contact Modal ══ */}
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
