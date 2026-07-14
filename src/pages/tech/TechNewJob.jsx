/**
 * ════════════════════════════════════════════════
 * FILE: TechNewJob.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A full-screen form a field technician uses on their phone to start a new
 *   job. First they find an existing client by name or phone (or quick-add a
 *   new one right inline), then they pick the division (water, mold, etc.), the
 *   referral source, the loss/service address, the insurance carrier, and a few
 *   optional details. Saving creates the job (and its claim + contact links) in
 *   one step, then pushes the new claim up to Encircle before leaving the screen.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/new-job
 *   Rendered by:  src/App.jsx (the "tech/new-job" route, inside the TechLayout
 *                  shell)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext, @/components/CarrierSelect,
 *              @/components/AddressAutocomplete, @/lib/toast, @/lib/phone,
 *              @/lib/realtime
 *   Data:      All access goes through the db client from useAuth (RPC + REST).
 *              Tables below were resolved from each RPC's SQL definition.
 *              reads  → insurance_carriers (get_insurance_carriers);
 *                        contact_jobs + contacts (search_contacts_for_job);
 *                        contact_addresses + contacts + jobs
 *                        (create_job_with_contact); contacts (db.select on the
 *                        duplicate-phone fallback)
 *              writes → contacts (db.insert for inline quick-add);
 *                        insurance_carriers (upsert_insurance_carrier);
 *                        claims + contact_addresses + contact_jobs + contacts +
 *                        jobs (create_job_with_contact)
 *
 * NOTES / GOTCHAS:
 *   - After the job is created, syncClaimToEncircle() POSTs to the
 *     /api/sync-claim-to-encircle worker and is AWAITED (with an 8s internal
 *     timeout) before navigating away — a fire-and-forget call was being torn
 *     down on mobile, leaving claims unsynced with no error recorded.
 *   - Inline quick-add: a duplicate phone (contacts_phone_key / Postgres 23505)
 *     is caught and the existing contact is auto-selected instead of erroring.
 *   - "Out of pocket" (OOP) carrier selection stores NULL for insurance_company
 *     and hides the claim-number field.
 *   - Fires a window 'upr:contact-created' event after an inline quick-add so
 *     other open screens can refresh their contact lists.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import CarrierSelect, { OOP_VALUE as OOP } from '@/components/CarrierSelect';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { toast } from '@/lib/toast';
import { normalizePhone } from '@/lib/phone';
import { getAuthHeader } from '@/lib/realtime';
import TechHelpButton from '@/components/tech/TechHelpButton';
import i18n from '@/i18n';

// ─── SECTION: Helpers ──────────────
// Push a new claim up to Encircle. Awaited by the caller (with an internal
// timeout) BEFORE navigating away — a fire-and-forget request was being
// abandoned when this screen tore down on mobile, leaving claims unsynced with
// no error recorded. Always resolves so the caller can proceed regardless.
async function syncClaimToEncircle(claimId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const auth = await getAuthHeader();
    const res = await fetch('/api/sync-claim-to-encircle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ claim_id: claimId }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      if (!data.skipped) toast(i18n.t('newJob:toastSynced'), 'success');
    } else {
      toast(i18n.t('newJob:toastSyncFailed'), 'error');
    }
  } catch (e) {
    // AbortError = request likely still completing server-side; stay quiet so we
    // don't show a false failure. Real network errors surface to the user.
    if (e.name !== 'AbortError') toast(i18n.t('newJob:toastSyncError', { message: e.message }), 'error');
  } finally {
    clearTimeout(timer);
  }
}

// ─── SECTION: Constants ──────────────
// Labels resolved at render via t('division.<value>') / t('source.<value>');
// emoji + value + color stay static.
const DIVISIONS = [
  { value: 'water', emoji: '\u{1F4A7}', color: '#2563eb' },
  { value: 'mold', emoji: '\u{1F9A0}', color: '#9d174d' },
  { value: 'reconstruction', emoji: '\u{1F3D7}\uFE0F', color: '#d97706' },
  { value: 'remodeling', emoji: '\u{1F528}', color: '#f2664a' },
  { value: 'fire', emoji: '\u{1F525}', color: '#dc2626' },
  { value: 'contents', emoji: '\u{1F4E6}', color: '#059669' },
];

const SOURCES = ['insurance', 'retail', 'hoa', 'commercial', 'tpa'];

// division → emoji, for the existing-claim picker's mini job pills
const DIV_EMOJI = DIVISIONS.reduce((m, d) => { m[d.value] = d.emoji; return m; }, {});

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
  // ─── SECTION: State & hooks ──────────────
  const { t } = useTranslation('newJob');
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

  /* ── Claim state (new claim vs. file under one of the customer's existing claims) ── */
  const [claimMode, setClaimMode] = useState('new');         // 'new' | 'existing'
  const [contactClaims, setContactClaims] = useState([]);    // claims belonging to the selected contact
  const [selectedClaimId, setSelectedClaimId] = useState(null);
  const [editFromClaim, setEditFromClaim] = useState(false); // reveal prefilled fields under an existing claim
  const selectedClaim = contactClaims.find(c => c.id === selectedClaimId) || null;
  // When an existing claim is picked, collapse Address/Insurance/Claim# into a summary (still editable).
  const claimLocked = claimMode === 'existing' && !!selectedClaimId && !editFromClaim;

  /* ── Cleanup search debounce timer on unmount ── */
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  // ─── SECTION: Data fetching ──────────────
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

  // ─── SECTION: Event handlers ──────────────
  const onSearch = e => {
    const v = e.target.value;
    setContactSearch(v);
    clearTimeout(searchTimer.current);
    if (v.trim().length >= 2) searchTimer.current = setTimeout(() => doSearch(v), 400);
    else { setResults([]); setShowDrop(false); }
  };

  /* ── Load the selected customer's existing claims (for the "existing claim" picker) ── */
  const loadContactClaims = useCallback(async (contactId) => {
    if (!contactId) { setContactClaims([]); return; }
    try {
      const data = await db.rpc('get_customer_detail', { p_contact_id: contactId });
      setContactClaims(Array.isArray(data?.claims) ? data.claims : []);
    } catch {
      setContactClaims([]);
    }
  }, [db]);

  const selectContact = c => {
    setContact(c);
    setContactSearch('');
    setShowDrop(false);
    setShowInlineCreate(false);
    // Reset the claim choice for the newly-selected customer, then load their claims.
    setClaimMode('new');
    setSelectedClaimId(null);
    setEditFromClaim(false);
    setContactClaims([]);
    if (c.billing_address || c.billing_city) {
      sF(prev => ({
        ...prev,
        address: c.billing_address || '',
        city: c.billing_city || '',
        state: c.billing_state || 'UT',
        zip: c.billing_zip || '',
      }));
    }
    loadContactClaims(c.id);
  };

  /* Pick one of the customer's existing claims — prefill loss/insurance fields from it */
  const selectClaim = (cl) => {
    setSelectedClaimId(cl.id);
    const hasAddr = !!(cl.loss_address || cl.loss_city);
    const hasCarrier = !!cl.insurance_carrier;
    // If the claim is missing required loss/carrier data, open the fields so the tech can fill them.
    setEditFromClaim(!(hasAddr && hasCarrier));
    sF(prev => ({
      ...prev,
      address: cl.loss_address || '',
      city: cl.loss_city || '',
      state: cl.loss_state || prev.state,
      zip: cl.loss_zip || '',
      insurance_company: cl.insurance_carrier || '',
      claim_number: cl.insurance_claim_number || '',
    }));
  };

  const clearContact = () => {
    setContact(null);
    setContactClaims([]);
    setClaimMode('new');
    setSelectedClaimId(null);
    setEditFromClaim(false);
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
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: t('toastInvalidPhone'), type: 'error' } }));
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
        toast(t('toastCustomerCreated'));
        window.dispatchEvent(new CustomEvent('upr:contact-created'));
      }
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('contacts_phone_key') || msg.includes('23505')) {
        // Duplicate phone — auto-select the existing contact so the user can proceed
        try {
          const existing = await db.select('contacts', `phone=eq.${encodeURIComponent(phone)}&select=*&limit=1`);
          if (existing?.length > 0) {
            selectContact(existing[0]);
            toast(t('toastFoundExisting', { name: existing[0].name }), 'success');
            return;
          }
        } catch { /* fall through */ }
        toast(t('toastDuplicatePhone'), 'error');
      } else {
        toast(t('toastCustomerFailed'), 'error');
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
    toast(t('toastCarrierAdded', { name }));
  };

  /* ── Submit ── */
  const canSubmit = contact && (f.address?.trim() || f.city?.trim()) && f.insurance_company && f.source;

  const handleSubmit = async () => {
    if (!contact) { toast(t('toastSelectClient'), 'error'); return; }
    if (!f.address?.trim() && !f.city?.trim()) { toast(t('toastEnterAddress'), 'error'); return; }
    if (!f.source) { toast(t('toastSelectSource'), 'error'); return; }
    if (!f.insurance_company) { toast(t('toastSelectCarrier'), 'error'); return; }
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
        // When filing under an existing claim, reuse it instead of minting a new CLM.
        p_existing_claim_id: claimMode === 'existing' ? selectedClaimId : null,
      });
      const jobNum = result?.job?.job_number || '';
      toast(jobNum ? t('toastJobCreated', { num: jobNum }) : t('toastJobCreatedNoNum'));
      // Encircle: only push when we minted a NEW claim. A job filed under an
      // existing claim is already synced — re-pushing would risk a duplicate.
      // Awaited (with an internal timeout) so the request completes while this
      // screen is still alive — a fire-and-forget call was abandoned on mobile.
      if (claimMode === 'new' && result?.claim_id) await syncClaimToEncircle(result.claim_id);
      // Open the new job's page instead of dead-ending back on the Dash.
      const newJobId = result?.job?.id;
      if (newJobId) navigate(`/tech/jobs/${newJobId}`, { replace: true });
      else navigate(-1);
    } catch (err) {
      toast(t('toastJobFailed', { message: err.message || '' }), 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─── SECTION: Render ──────────────
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
          {t('title')}
        </span>
        <TechHelpButton topicKey="newjob" style={{ marginLeft: 'auto' }} />
      </div>

      {/* Scrollable form */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, paddingBottom: 100 }}>

        {/* ═══ CLIENT ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>
            {t('labelClient')} <span style={{ color: '#ef4444' }}>*</span>
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
                  placeholder={t('clientSearchPlaceholder')}
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
                      <div style={{ fontSize: 14, color: 'var(--text-tertiary)', marginBottom: 12 }}>{t('noClientsFound')}</div>
                      <button
                        onClick={() => { setShowDrop(false); setShowInlineCreate(true); setInlineName(contactSearch); }}
                        style={{
                          height: 44, padding: '0 20px', borderRadius: 'var(--tech-radius-button)',
                          background: 'var(--accent)', color: '#fff', border: 'none',
                          fontSize: 14, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        {t('createNewCustomer')}
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
                              {fmtPhone(c.phone)}{c.job_count ? ` · ${t('jobCount', { count: c.job_count })}` : ''}
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
                        {t('createNewCustomer')}
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
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 12 }}>{t('quickAddCustomer')}</div>
                  <input
                    type="text"
                    value={inlineName}
                    onChange={e => setInlineName(e.target.value)}
                    placeholder={t('quickNamePlaceholder')}
                    style={{ ...inputStyle, marginBottom: 8 }}
                  />
                  <input
                    type="tel"
                    value={inlinePhone}
                    onChange={e => setInlinePhone(e.target.value)}
                    placeholder={t('quickPhonePlaceholder')}
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
                      {t('cancel')}
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
                      {inlineSaving ? t('btnSaving') : t('btnSaveSelect')}
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

        {/* ═══ CLAIM ═══ */}
        {contact && (
          <div style={{ marginBottom: 20 }}>
            <div style={labelStyle}>{t('labelClaim')}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => { setClaimMode('new'); setSelectedClaimId(null); setEditFromClaim(false); }}
                style={{
                  flex: 1, height: 48, borderRadius: 'var(--tech-radius-button)',
                  border: claimMode === 'new' ? '2px solid var(--accent)' : '2px solid var(--border-color)',
                  background: claimMode === 'new' ? 'var(--accent-light)' : 'var(--bg-primary)',
                  fontSize: 14, fontWeight: 600,
                  color: claimMode === 'new' ? 'var(--accent)' : 'var(--text-secondary)',
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                }}
              >
                {t('newClaim')}
              </button>
              <button
                type="button"
                onClick={() => { if (contactClaims.length) setClaimMode('existing'); }}
                disabled={!contactClaims.length}
                style={{
                  flex: 1, height: 48, borderRadius: 'var(--tech-radius-button)',
                  border: claimMode === 'existing' ? '2px solid var(--accent)' : '2px solid var(--border-color)',
                  background: claimMode === 'existing' ? 'var(--accent-light)' : 'var(--bg-primary)',
                  fontSize: 14, fontWeight: 600,
                  color: !contactClaims.length ? 'var(--text-tertiary)'
                    : claimMode === 'existing' ? 'var(--accent)' : 'var(--text-secondary)',
                  cursor: contactClaims.length ? 'pointer' : 'default',
                  opacity: contactClaims.length ? 1 : 0.6,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {contactClaims.length ? t('existingClaimCount', { count: contactClaims.length }) : t('existingClaim')}
              </button>
            </div>

            {/* Existing-claim picker — this customer's claims only */}
            {claimMode === 'existing' && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {contactClaims.map(cl => {
                  const sel = selectedClaimId === cl.id;
                  const jobs = cl.jobs || [];
                  const loc = [cl.loss_address, cl.loss_city].filter(Boolean).join(', ');
                  return (
                    <button
                      key={cl.id}
                      type="button"
                      onClick={() => selectClaim(cl)}
                      style={{
                        width: '100%', textAlign: 'left', padding: '12px 14px',
                        borderRadius: 'var(--tech-radius-button)',
                        border: sel ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                        background: sel ? 'var(--accent-light)' : 'var(--bg-primary)',
                        cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                        minHeight: 'var(--tech-min-tap)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                          {cl.claim_number}
                        </span>
                        {jobs.length > 0 && (
                          <span style={{ fontSize: 13 }}>
                            {jobs.map(j => DIV_EMOJI[j.division] || '\u{1F4C1}').join(' ')}
                          </span>
                        )}
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-tertiary)' }}>
                          {t('jobCount', { count: jobs.length })}
                        </span>
                      </div>
                      {loc && (
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{loc}</div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ DIVISION ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>{t('labelDivision')} <span style={{ color: '#ef4444' }}>*</span></div>
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
                }}>{t('division.' + d.value)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ═══ REFERRAL SOURCE ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>{t('labelReferralSource')} <span style={{ color: '#ef4444' }}>*</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {SOURCES.map(src => (
              <button
                key={src}
                onClick={() => s('source', src)}
                style={{
                  height: 44, padding: '0 16px', borderRadius: 'var(--tech-radius-button)',
                  border: f.source === src ? '2px solid var(--accent)' : '2px solid var(--border-color)',
                  background: f.source === src ? 'var(--accent-light)' : 'var(--bg-primary)',
                  fontSize: 14, fontWeight: 600,
                  color: f.source === src ? 'var(--accent)' : 'var(--text-secondary)',
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                }}
              >
                {t('source.' + src)}
              </button>
            ))}
          </div>
        </div>

        {claimLocked ? (
          /* Existing-claim summary — Address / Insurance / Claim# come from the claim (tap Edit to change) */
          <div style={{ marginBottom: 20 }}>
            <div style={labelStyle}>{t('labelLossDetails')}</div>
            <div style={{
              padding: '12px 14px', borderRadius: 'var(--tech-radius-card)',
              border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                  {selectedClaim?.claim_number}
                </span>
                <button
                  type="button"
                  onClick={() => setEditFromClaim(true)}
                  style={{
                    marginLeft: 'auto', height: 32, padding: '0 14px', borderRadius: 'var(--radius-full)',
                    border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
                    fontSize: 12, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer',
                  }}
                >
                  {t('edit')}
                </button>
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 2 }}>
                {[f.address, f.city, f.state, f.zip].filter(Boolean).join(', ') || t('noAddressOnClaim')}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {isOop ? t('outOfPocket') : (f.insurance_company || t('noCarrier'))}
                {f.claim_number ? ` · ${f.claim_number}` : ''}
              </div>
            </div>
          </div>
        ) : (
        <>
        {/* ═══ ADDRESS ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>{t('labelLossAddress')} <span style={{ color: '#ef4444' }}>*</span></div>
          <AddressAutocomplete
            value={f.address}
            onChange={v => s('address', v)}
            onSelect={p => sF(prev => ({ ...prev, address: p.address, city: p.city, state: p.state || prev.state, zip: p.zip }))}
            placeholder={t('streetPlaceholder')}
            style={{ ...inputStyle, marginBottom: 8 }}
            touchTarget
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={f.city}
              onChange={e => s('city', e.target.value)}
              placeholder={t('cityPlaceholder')}
              style={{ ...inputStyle, flex: 2 }}
            />
            <input
              type="text"
              value={f.state}
              onChange={e => s('state', e.target.value)}
              placeholder={t('statePlaceholder')}
              style={{ ...inputStyle, flex: 0.6, padding: '0 10px', textAlign: 'center' }}
            />
            <input
              type="text"
              value={f.zip}
              onChange={e => s('zip', e.target.value)}
              placeholder={t('zipPlaceholder')}
              style={{ ...inputStyle, flex: 1, padding: '0 10px' }}
            />
          </div>
          {contact?.billing_address && f.address === contact.billing_address && (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8, fontStyle: 'italic', lineHeight: 1.4 }}>
              {t('prefilledHint', { name: contact.name })}
            </div>
          )}
        </div>

        {/* ═══ INSURANCE ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>{t('labelInsuranceCarrier')} <span style={{ color: '#ef4444' }}>*</span></div>
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
            <div style={labelStyle}>{t('labelClaimNumber')}</div>
            <input
              type="text"
              value={f.claim_number}
              onChange={e => s('claim_number', e.target.value)}
              placeholder={t('optionalPlaceholder')}
              style={inputStyle}
            />
          </div>
        )}
        </>
        )}

        {/* ═══ TYPE OF LOSS ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>{t('labelTypeOfLoss')}</div>
          <input
            type="text"
            value={f.type_of_loss}
            onChange={e => s('type_of_loss', e.target.value)}
            placeholder={t('typeOfLossPlaceholder')}
            style={inputStyle}
          />
        </div>

        {/* ═══ NOTES ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>{t('labelInternalNotes')}</div>
          <textarea
            value={f.internal_notes}
            onChange={e => s('internal_notes', e.target.value)}
            placeholder={t('notesPlaceholder')}
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
          className="btn"
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
          {saving ? t('btnCreating') : t('btnCreate')}
        </button>
      </div>
    </div>
  );
}
