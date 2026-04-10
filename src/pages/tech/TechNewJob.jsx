import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import CarrierSelect, { OOP_VALUE as OOP } from '@/components/CarrierSelect';
import { toast } from '@/lib/toast';
import { normalizePhone } from '@/lib/phone';

const DIVISIONS = [
  { value: 'water', emoji: '\u{1F4A7}', label: 'Water', color: '#2563eb' },
  { value: 'mold', emoji: '\u{1F9A0}', label: 'Mold', color: '#9d174d' },
  { value: 'reconstruction', emoji: '\u{1F3D7}\uFE0F', label: 'Recon', color: '#d97706' },
  { value: 'fire', emoji: '\u{1F525}', label: 'Fire', color: '#dc2626' },
  { value: 'contents', emoji: '\u{1F4E6}', label: 'Contents', color: '#059669' },
];

const SOURCES = [
  { value: 'insurance', label: 'Insurance' },
  { value: 'retail', label: 'Retail / Cash' },
  { value: 'hoa', label: 'HOA' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'tpa', label: 'TPA' },
];

function fmtPhone(phone) {
  if (!phone) return '';
  const d = phone.replace(/\D/g, '');
  const n = d.startsWith('1') ? d.slice(1) : d;
  if (n.length === 10) return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  return phone;
}

/* ── input style helper ── */
const inputStyle = {
  width: '100%', height: 48, padding: '0 14px',
  fontSize: 16, borderRadius: 'var(--tech-radius-button)',
  border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
  color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
};

const labelStyle = {
  fontSize: 'var(--tech-text-label)', fontWeight: 600, color: 'var(--text-tertiary)',
  textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6,
};

export default function TechNewJob() {
  const navigate = useNavigate();
  const { db, employee } = useAuth();
  const searchRef = useRef(null);
  const searchTimer = useRef(null);

  /* ── Contact state ── */
  const [contact, setContact] = useState(null);
  const [contactSearch, setContactSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDrop, setShowDrop] = useState(false);
  const [showInlineCreate, setShowInlineCreate] = useState(false);
  const [inlineName, setInlineName] = useState('');
  const [inlinePhone, setInlinePhone] = useState('');
  const [inlineSaving, setInlineSaving] = useState(false);

  /* ── Form state ── */
  const [carriers, setCarriers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [f, sF] = useState({
    division: 'water',
    source: '',
    address: '', city: '', state: 'UT', zip: '',
    insurance_company: '',
    claim_number: '',
    type_of_loss: '',
    internal_notes: '',
  });
  const s = (k, v) => sF(prev => ({ ...prev, [k]: v }));
  const isOop = f.insurance_company === OOP;

  /* ── Cleanup search debounce timer on unmount ── */
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  /* ── Load carriers ── */
  useEffect(() => {
    db.rpc('get_insurance_carriers').then(c => setCarriers(c || [])).catch(() => {});
  }, [db]);

  /* ── Contact search ── */
  const doSearch = useCallback(async (q) => {
    if (q.trim().length < 2) { setResults([]); setShowDrop(false); return; }
    setSearching(true);
    try {
      const r = await db.rpc('search_contacts_for_job', { p_query: q.trim() });
      setResults(Array.isArray(r) ? r : []);
      setShowDrop(true);
    } catch { setResults([]); } finally { setSearching(false); }
  }, [db]);

  const onSearch = e => {
    const v = e.target.value;
    setContactSearch(v);
    clearTimeout(searchTimer.current);
    if (v.trim().length >= 2) searchTimer.current = setTimeout(() => doSearch(v), 400);
    else { setResults([]); setShowDrop(false); }
  };

  const selectContact = c => {
    setContact(c);
    setContactSearch('');
    setShowDrop(false);
    setShowInlineCreate(false);
    if (c.billing_address || c.billing_city) {
      sF(prev => ({
        ...prev,
        address: c.billing_address || '',
        city: c.billing_city || '',
        state: c.billing_state || 'UT',
        zip: c.billing_zip || '',
      }));
    }
  };

  const clearContact = () => {
    setContact(null);
    sF(prev => ({ ...prev, address: '', city: '', state: 'UT', zip: '' }));
  };

  /* Close dropdown on outside click */
  useEffect(() => {
    const h = e => { if (searchRef.current && !searchRef.current.contains(e.target)) setShowDrop(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  /* ── Inline contact create ── */
  const handleInlineCreate = async () => {
    if (!inlineName.trim() || !inlinePhone.trim() || inlineSaving) return;
    const phone = normalizePhone(inlinePhone);
    if (!phone) {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Enter a valid 10-digit phone number', type: 'error' } }));
      return;
    }
    setInlineSaving(true);
    try {
      const data = {
        name: inlineName.trim(),
        phone,
        role: 'homeowner',
        opt_in_status: false,
        tags: [],
      };
      const result = await db.insert('contacts', data);
      if (result?.length > 0) {
        selectContact(result[0]);
        toast('Customer created');
        window.dispatchEvent(new CustomEvent('upr:contact-created'));
      }
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('contacts_phone_key') || msg.includes('23505')) {
        toast('A customer with this phone number already exists', 'error');
      } else {
        toast('Failed to create customer. Please try again.', 'error');
      }
    } finally {
      setInlineSaving(false);
    }
  };

  /* ── Add carrier ── */
  const handleAddCarrier = async (name) => {
    await db.rpc('upsert_insurance_carrier', { p_name: name, p_sort_order: 999 });
    const updated = await db.rpc('get_insurance_carriers').catch(() => carriers);
    setCarriers(updated);
    toast(`"${name}" added to carriers`);
  };

  /* ── Submit ── */
  const canSubmit = contact && (f.address?.trim() || f.city?.trim()) && f.insurance_company && f.source;

  const handleSubmit = async () => {
    if (!contact) { toast('Select or create a client first', 'error'); return; }
    if (!f.address?.trim() && !f.city?.trim()) { toast('Enter a loss/service address', 'error'); return; }
    if (!f.source) { toast('Select a referral source', 'error'); return; }
    if (!f.insurance_company) { toast('Select an insurance carrier', 'error'); return; }
    if (saving) return;
    setSaving(true);
    try {
      const insuranceCompany = f.insurance_company === OOP ? null : f.insurance_company;
      const result = await db.rpc('create_job_with_contact', {
        p_contact_id: contact.id,
        p_contact_name: contact.name,
        p_contact_phone: contact.phone,
        p_contact_email: contact.email || null,
        p_contact_role: contact.role || 'homeowner',
        p_billing_address: contact.billing_address || f.address || null,
        p_billing_city: contact.billing_city || f.city || null,
        p_billing_state: contact.billing_state || f.state || null,
        p_billing_zip: contact.billing_zip || f.zip || null,
        p_division: f.division,
        p_source: f.source,
        p_priority: 3,
        p_type_of_loss: f.type_of_loss || null,
        p_date_of_loss: null,
        p_target_completion: null,
        p_address: f.address || null,
        p_city: f.city || null,
        p_state: f.state || null,
        p_zip: f.zip || null,
        p_insurance_company: insuranceCompany,
        p_claim_number: f.claim_number || null,
        p_job_policy_number: null,
        p_adjuster_name: null,
        p_adjuster_phone: null,
        p_adjuster_email: null,
        p_cat_code: null,
        p_project_manager_id: null,
        p_lead_tech_id: employee?.id || null,
        p_internal_notes: f.internal_notes || null,
      });
      const jobNum = result?.job?.job_number || '';
      toast(jobNum ? `Job #${jobNum} created` : 'Job created');
      navigate(-1);
    } catch (err) {
      toast('Failed to create job: ' + (err.message || ''), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px', borderBottom: '1px solid var(--border-light)',
        background: 'var(--bg-primary)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            width: 48, height: 48, borderRadius: 'var(--tech-radius-button)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-tertiary)', border: 'none', cursor: 'pointer',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span style={{ fontSize: 'var(--tech-text-heading)', fontWeight: 700, color: 'var(--text-primary)' }}>
          New Job
        </span>
      </div>

      {/* Scrollable form */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, paddingBottom: 100 }}>

        {/* ═══ CLIENT ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>
            Client <span style={{ color: '#ef4444' }}>*</span>
          </div>

          {!contact ? (
            <div ref={searchRef} style={{ position: 'relative' }}>
              <div style={{ position: 'relative' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"
                  style={{ position: 'absolute', left: 14, top: 15, pointerEvents: 'none' }}>
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  value={contactSearch}
                  onChange={onSearch}
                  placeholder="Search by name or phone..."
                  autoFocus
                  style={{ ...inputStyle, paddingLeft: 40 }}
                />
                {searching && (
                  <div style={{ position: 'absolute', right: 14, top: 15 }}>
                    <div className="spinner" style={{ width: 16, height: 16 }} />
                  </div>
                )}
              </div>

              {/* Search results dropdown */}
              {showDrop && (
                <div style={{
                  position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4,
                  background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)',
                  zIndex: 50, maxHeight: '50vh', overflowY: 'auto',
                }}>
                  {results.length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center' }}>
                      <div style={{ fontSize: 14, color: 'var(--text-tertiary)', marginBottom: 12 }}>No clients found</div>
                      <button
                        onClick={() => { setShowDrop(false); setShowInlineCreate(true); setInlineName(contactSearch); }}
                        style={{
                          height: 44, padding: '0 20px', borderRadius: 'var(--tech-radius-button)',
                          background: 'var(--accent)', color: '#fff', border: 'none',
                          fontSize: 14, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        + Create New Customer
                      </button>
                    </div>
                  ) : (
                    <>
                      {results.map(c => (
                        <button
                          key={c.id}
                          onClick={() => selectContact(c)}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                            padding: '12px 16px', border: 'none', borderBottom: '1px solid var(--border-light)',
                            background: 'transparent', cursor: 'pointer', textAlign: 'left',
                            minHeight: 'var(--tech-min-tap)',
                          }}
                        >
                          {/* Avatar */}
                          <div style={{
                            width: 40, height: 40, borderRadius: 'var(--radius-full)',
                            background: 'var(--accent-light)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                          }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                            </svg>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</div>
                            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                              {fmtPhone(c.phone)}{c.job_count ? ` · ${c.job_count} job${c.job_count > 1 ? 's' : ''}` : ''}
                            </div>
                          </div>
                        </button>
                      ))}
                      <button
                        onClick={() => { setShowDrop(false); setShowInlineCreate(true); setInlineName(contactSearch); }}
                        style={{
                          width: '100%', padding: '12px 16px', border: 'none',
                          background: 'var(--bg-secondary)', cursor: 'pointer', textAlign: 'center',
                          fontSize: 14, fontWeight: 600, color: 'var(--accent)',
                          minHeight: 'var(--tech-min-tap)',
                        }}
                      >
                        + Create New Customer
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Inline create mini-form */}
              {showInlineCreate && (
                <div style={{
                  marginTop: 12, padding: 16, borderRadius: 'var(--tech-radius-card)',
                  border: '1px solid var(--accent)', background: 'var(--accent-light)',
                }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 12 }}>Quick Add Customer</div>
                  <input
                    type="text"
                    value={inlineName}
                    onChange={e => setInlineName(e.target.value)}
                    placeholder="Full name *"
                    style={{ ...inputStyle, marginBottom: 8 }}
                  />
                  <input
                    type="tel"
                    value={inlinePhone}
                    onChange={e => setInlinePhone(e.target.value)}
                    placeholder="Phone * (801) 555-1234"
                    style={{ ...inputStyle, marginBottom: 12 }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => { setShowInlineCreate(false); setInlineName(''); setInlinePhone(''); }}
                      style={{
                        flex: 1, height: 44, borderRadius: 'var(--tech-radius-button)',
                        background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
                        fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleInlineCreate}
                      disabled={!inlineName.trim() || !inlinePhone.trim() || inlineSaving}
                      style={{
                        flex: 1, height: 44, borderRadius: 'var(--tech-radius-button)',
                        background: inlineName.trim() && inlinePhone.trim() ? 'var(--accent)' : 'var(--bg-tertiary)',
                        color: inlineName.trim() && inlinePhone.trim() ? '#fff' : 'var(--text-tertiary)',
                        border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      {inlineSaving ? 'Saving...' : 'Save & Select'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Selected contact card */
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
              borderRadius: 'var(--tech-radius-card)', border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 'var(--radius-full)',
                background: 'var(--accent-light)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{contact.name}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{fmtPhone(contact.phone)}</div>
              </div>
              <button
                onClick={clearContact}
                style={{
                  width: 36, height: 36, borderRadius: 'var(--radius-full)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--bg-tertiary)', border: 'none', cursor: 'pointer', flexShrink: 0,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* ═══ DIVISION ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Division <span style={{ color: '#ef4444' }}>*</span></div>
          <div style={{ display: 'flex', gap: 8 }}>
            {DIVISIONS.map(d => (
              <button
                key={d.value}
                onClick={() => s('division', d.value)}
                style={{
                  flex: '1 1 0', minWidth: 0, padding: '10px 4px',
                  borderRadius: 'var(--tech-radius-button)',
                  border: f.division === d.value ? `2px solid ${d.color}` : '2px solid var(--border-color)',
                  background: f.division === d.value ? `${d.color}12` : 'var(--bg-primary)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                }}
              >
                <span style={{ fontSize: 24 }}>{d.emoji}</span>
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  color: f.division === d.value ? d.color : 'var(--text-secondary)',
                }}>{d.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ═══ REFERRAL SOURCE ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Referral Source <span style={{ color: '#ef4444' }}>*</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {SOURCES.map(src => (
              <button
                key={src.value}
                onClick={() => s('source', src.value)}
                style={{
                  height: 44, padding: '0 16px', borderRadius: 'var(--tech-radius-button)',
                  border: f.source === src.value ? '2px solid var(--accent)' : '2px solid var(--border-color)',
                  background: f.source === src.value ? 'var(--accent-light)' : 'var(--bg-primary)',
                  fontSize: 14, fontWeight: 600,
                  color: f.source === src.value ? 'var(--accent)' : 'var(--text-secondary)',
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                }}
              >
                {src.label}
              </button>
            ))}
          </div>
        </div>

        {/* ═══ ADDRESS ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Loss / Service Address <span style={{ color: '#ef4444' }}>*</span></div>
          <input
            type="text"
            value={f.address}
            onChange={e => s('address', e.target.value)}
            placeholder="Street address"
            style={{ ...inputStyle, marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={f.city}
              onChange={e => s('city', e.target.value)}
              placeholder="City"
              style={{ ...inputStyle, flex: 2 }}
            />
            <input
              type="text"
              value={f.state}
              onChange={e => s('state', e.target.value)}
              placeholder="ST"
              style={{ ...inputStyle, flex: 0.6, padding: '0 10px', textAlign: 'center' }}
            />
            <input
              type="text"
              value={f.zip}
              onChange={e => s('zip', e.target.value)}
              placeholder="ZIP"
              style={{ ...inputStyle, flex: 1, padding: '0 10px' }}
            />
          </div>
        </div>

        {/* ═══ INSURANCE ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Insurance Carrier <span style={{ color: '#ef4444' }}>*</span></div>
          <CarrierSelect
            value={f.insurance_company}
            onChange={v => s('insurance_company', v)}
            carriers={carriers}
            onAdd={handleAddCarrier}
            required
            height={48}
          />
        </div>

        {/* Claim number — only when not OOP */}
        {!isOop && f.insurance_company && (
          <div style={{ marginBottom: 20 }}>
            <div style={labelStyle}>Claim Number</div>
            <input
              type="text"
              value={f.claim_number}
              onChange={e => s('claim_number', e.target.value)}
              placeholder="Optional"
              style={inputStyle}
            />
          </div>
        )}

        {/* ═══ TYPE OF LOSS ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Type of Loss</div>
          <input
            type="text"
            value={f.type_of_loss}
            onChange={e => s('type_of_loss', e.target.value)}
            placeholder="Pipe burst, storm, sewage, etc."
            style={inputStyle}
          />
        </div>

        {/* ═══ NOTES ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Internal Notes</div>
          <textarea
            value={f.internal_notes}
            onChange={e => s('internal_notes', e.target.value)}
            placeholder="Optional notes..."
            rows={3}
            style={{
              ...inputStyle, height: 'auto', padding: '12px 14px',
              resize: 'vertical', fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      {/* Sticky submit */}
      <div style={{
        position: 'fixed', bottom: 'calc(var(--tech-nav-height) + max(12px, env(safe-area-inset-bottom, 12px)))',
        left: 0, right: 0, padding: '12px 16px',
        background: 'linear-gradient(transparent, var(--bg-primary) 8px)',
        zIndex: 10,
      }}>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || saving}
          style={{
            width: '100%', height: 52, borderRadius: 'var(--tech-radius-button)',
            background: canSubmit && !saving ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: canSubmit && !saving ? '#fff' : 'var(--text-tertiary)',
            border: 'none', fontSize: 16, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'default',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {saving ? 'Creating...' : 'Create Job'}
        </button>
      </div>
    </div>
  );
}
