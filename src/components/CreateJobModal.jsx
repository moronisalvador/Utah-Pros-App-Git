import { useState, useEffect, useRef, useCallback } from 'react';
import AddContactModal from '@/components/AddContactModal';
import DatePicker from '@/components/DatePicker';
import CarrierSelect, { OOP_VALUE as OOP } from '@/components/CarrierSelect';
import { getAuthHeader } from '@/lib/realtime';

async function syncClaimToEncircle(claimId) {
  try {
    const auth = await getAuthHeader();
    const res = await fetch('/api/sync-claim-to-encircle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ claim_id: claimId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      if (data.skipped) return; // already_synced
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: `Synced to Encircle (${data.encircle_claim_id})`, type: 'success' } }));
    } else {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Encircle sync failed — retry from Dev Tools → Backfill', type: 'error' } }));
    }
  } catch (e) {
    window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Encircle sync failed: ' + e.message, type: 'error' } }));
  }
}

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));
const okToast  = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'success' } }));

function IconSearch(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>);}
function IconPlus(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);}
function IconUser(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>);}
function IconX(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>);}

const DIVISIONS=[
  {value:'water',emoji:'\u{1F4A7}',label:'Water',color:'#2563eb'},
  {value:'mold',emoji:'\u{1F9A0}',label:'Mold',color:'#9d174d'},
  {value:'reconstruction',emoji:'\u{1F3D7}\uFE0F',label:'Recon',color:'#d97706'},
  {value:'fire',emoji:'\u{1F525}',label:'Fire',color:'#dc2626'},
  {value:'contents',emoji:'\u{1F4E6}',label:'Contents',color:'#059669'},
];
const LOSS_TYPES=['Pipe Burst','Sewer Backup','Storm / Wind','Appliance Failure','Roof Leak','Sprinkler','Flood','Toilet Overflow','Fire','Smoke','Mold','Vandalism','Other'];

export default function CreateJobModal({ db, onClose, onCreated, prefillContact }) {
  const [contact,        setContact]        = useState(prefillContact || null);
  const [search,         setSearch]         = useState('');
  const [results,        setResults]        = useState([]);
  const [searching,      setSearching]      = useState(false);
  const [showDrop,       setShowDrop]       = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const searchRef = useRef(null);
  const timer     = useRef(null);

  const [division,         setDivision]         = useState('water');
  const [address,          setAddress]          = useState(prefillContact?.billing_address || '');
  const [city,             setCity]             = useState(prefillContact?.billing_city    || '');
  const [state,            setState]            = useState(prefillContact?.billing_state   || 'UT');
  const [zip,              setZip]              = useState(prefillContact?.billing_zip     || '');
  const [dateOfLoss,       setDateOfLoss]       = useState('');
  const [typeOfLoss,       setTypeOfLoss]       = useState('');
  const [insuranceCompany, setInsuranceCompany] = useState('');
  const [claimNumber,      setClaimNumber]      = useState('');
  const [internalNotes,    setInternalNotes]    = useState('');

  const [carriers, setCarriers] = useState([]);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState(null);

  useEffect(() => {
    db.rpc('get_insurance_carriers').then(setCarriers).catch(() => {});
  }, []);

  // Add new carrier
  const handleAddCarrier = async (name) => {
    await db.rpc('upsert_insurance_carrier', { p_name: name, p_sort_order: 999 });
    const updated = await db.rpc('get_insurance_carriers').catch(() => carriers);
    setCarriers(updated);
    okToast(`"${name}" added to carriers`);
  };

  const doSearch = useCallback(async q => {
    if (q.trim().length < 2) { setResults([]); setShowDrop(false); return; }
    setSearching(true);
    try {
      const r = await db.rpc('search_contacts_for_job', { p_query: q.trim() });
      setResults(Array.isArray(r) ? r : []); setShowDrop(true);
    } catch { setResults([]); } finally { setSearching(false); }
  }, [db]);

  const onSearchChange = e => {
    const v = e.target.value; setSearch(v); clearTimeout(timer.current);
    if (v.trim().length >= 2) timer.current = setTimeout(() => doSearch(v), 300);
    else { setResults([]); setShowDrop(false); }
  };

  const selectContact = c => {
    setContact(c); setSearch(''); setShowDrop(false);
    if (c.billing_address || c.billing_city) {
      setAddress(c.billing_address || ''); setCity(c.billing_city || '');
      setState(c.billing_state || 'UT'); setZip(c.billing_zip || '');
    }
  };

  const handleNewContact = async data => {
    const applyContact = (c) => {
      setContact(c); setShowAddContact(false);
      if (c.billing_address) setAddress(c.billing_address);
      if (c.billing_city)    setCity(c.billing_city);
      if (c.billing_state)   setState(c.billing_state);
      if (c.billing_zip)     setZip(c.billing_zip);
    };
    try {
      const r = await db.insert('contacts', data);
      if (r?.length > 0) applyContact(r[0]);
    } catch (err) {
      const msg = err.message || '';
      // Duplicate phone — look up the existing contact and use it instead of failing
      if (msg.includes('contacts_phone_key') || msg.includes('23505')) {
        try {
          const existing = await db.select('contacts', `phone=eq.${encodeURIComponent(data.phone)}&select=*&limit=1`);
          if (existing?.length > 0) {
            applyContact(existing[0]);
            okToast(`Found existing customer: ${existing[0].name}`);
            return;
          }
        } catch { /* fall through to generic error */ }
        errToast('A customer with this phone number already exists. Try searching by name.');
        throw err;
      }
      errToast('Failed: ' + msg);
      throw err;
    }
  };

  const clearContact = () => { setContact(null); setAddress(''); setCity(''); setState('UT'); setZip(''); };

  useEffect(() => {
    const h = e => { if (searchRef.current && !searchRef.current.contains(e.target)) setShowDrop(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const fmtPh = phone => {
    if (!phone) return '';
    const d = phone.replace(/\D/g, ''); const n = d.startsWith('1') ? d.slice(1) : d;
    if (n.length === 10) return `(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}`;
    return phone;
  };

  const handleSubmit = async () => {
    if (!contact)          { setError('Select or create a client first.'); return; }
    if (!insuranceCompany) { setError('Select an insurance carrier or "Out of pocket / No insurance".'); return; }
    setSaving(true); setError(null);
    try {
      const insCompany = insuranceCompany === OOP ? null : insuranceCompany;
      const result = await db.rpc('create_job_with_contact', {
        p_contact_id:      contact.id,
        p_contact_name:    contact.name,
        p_contact_phone:   contact.phone,
        p_contact_email:   contact.email   || null,
        p_contact_role:    contact.role    || 'homeowner',
        p_billing_address: contact.billing_address || address || null,
        p_billing_city:    contact.billing_city    || city    || null,
        p_billing_state:   contact.billing_state   || state   || null,
        p_billing_zip:     contact.billing_zip     || zip     || null,
        p_division:        division,
        p_source:          'insurance',
        p_priority:        3,
        p_type_of_loss:    typeOfLoss    || null,
        p_date_of_loss:    dateOfLoss    || null,
        p_address:         address       || null,
        p_city:            city          || null,
        p_state:           state         || null,
        p_zip:             zip           || null,
        p_insurance_company: insCompany,
        p_claim_number:    claimNumber   || null,
        p_internal_notes:  internalNotes || null,
      });
      onCreated?.(result);
      // Fire-and-forget push to Encircle — don't block the UI on the response
      if (result?.claim_id) syncClaimToEncircle(result.claim_id);
    } catch (err) {
      console.error(err); setError('Failed: ' + err.message);
    } finally { setSaving(false); }
  };

  const isOop = insuranceCompany === OOP;

  return (
    <div className="conv-modal-backdrop" onClick={onClose}>
      <div className="conv-modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 600, height: 'min(90vh, 720px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        <div className="conv-modal-header" style={{ flexShrink: 0 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>New Job</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ width: 32, height: 32, padding: 0 }}>
            <IconX style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
          {error && (
            <div style={{ padding: 'var(--space-2) var(--space-3)', background: '#fef2f2', color: '#dc2626', borderRadius: 'var(--radius-md)', fontSize: 13, marginBottom: 'var(--space-3)', border: '1px solid #fecaca' }}>
              {error}
            </div>
          )}

          {/* CLIENT */}
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Client *</div>
            {!contact ? (
              <div ref={searchRef} style={{ position: 'relative' }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <IconSearch style={{ width: 14, height: 14, position: 'absolute', left: 10, top: 10, color: 'var(--text-tertiary)' }} />
                    <input className="input" placeholder="Search name, phone, or email..." value={search} onChange={onSearchChange} autoFocus style={{ paddingLeft: 32, height: 38 }} />
                    {searching && <div style={{ position: 'absolute', right: 10, top: 10 }}><div className="spinner" style={{ width: 14, height: 14 }} /></div>}
                  </div>
                  <button className="btn btn-secondary" onClick={() => setShowAddContact(true)} style={{ flexShrink: 0, gap: 4, height: 38 }}>
                    <IconPlus style={{ width: 14, height: 14 }} /> New
                  </button>
                </div>
                {showDrop && (
                  <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 20, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', maxHeight: 240, overflowY: 'auto', marginTop: 4 }}>
                    {results.length === 0 ? (
                      <div style={{ padding: 'var(--space-3)', fontSize: 13, color: 'var(--text-tertiary)' }}>
                        {search.trim().length >= 2
                          ? <>No clients found. <button style={{ color: 'var(--brand-primary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit', fontSize: 13 }} onClick={() => setShowAddContact(true)}>Create new</button></>
                          : 'Type 2+ characters'}
                      </div>
                    ) : results.map(c => (
                      <button key={c.id} onClick={() => selectContact(c)}
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', width: '100%', padding: 'var(--space-2) var(--space-3)', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-sans)', borderBottom: '1px solid var(--border-light)' }}>
                        <IconUser style={{ width: 15, height: 15, color: 'var(--text-tertiary)', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{fmtPh(c.phone)}{c.email && ` · ${c.email}`}</div>
                        </div>
                        {c.job_count > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 99, background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>{c.job_count}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)' }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--brand-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                  {contact.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{contact.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{fmtPh(contact.phone)}{contact.email && ` · ${contact.email}`}</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={clearContact} style={{ width: 26, height: 26, padding: 0 }}>
                  <IconX style={{ width: 13, height: 13 }} />
                </button>
              </div>
            )}
          </div>

          {/* DIVISION */}
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Division *</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {DIVISIONS.map(d => (
                <button key={d.value} onClick={() => setDivision(d.value)}
                  style={{ flex: '1 1 0', padding: '8px 4px', borderRadius: 'var(--radius-md)',
                    border: division === d.value ? `2px solid ${d.color}` : '2px solid var(--border-light)',
                    background: division === d.value ? `${d.color}10` : 'var(--bg-primary)',
                    cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s', fontFamily: 'var(--font-sans)' }}>
                  <div style={{ fontSize: 18 }}>{d.emoji}</div>
                  <div style={{ fontSize: 10, fontWeight: division === d.value ? 700 : 500, color: division === d.value ? d.color : 'var(--text-secondary)', marginTop: 1 }}>{d.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* ADDRESS */}
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Loss / Service Address</div>
            <input className="input" value={address} onChange={e => setAddress(e.target.value)} placeholder="Street address" style={{ height: 34, fontSize: 13, marginBottom: 6 }} />
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" value={city}  onChange={e => setCity(e.target.value)}  placeholder="City" style={{ flex: 1, height: 34, fontSize: 13 }} />
              <input className="input" value={state} onChange={e => setState(e.target.value)} placeholder="UT"   style={{ width: 56, height: 34, fontSize: 13 }} />
              <input className="input" value={zip}   onChange={e => setZip(e.target.value)}   placeholder="ZIP"  style={{ width: 76, height: 34, fontSize: 13 }} />
            </div>
            {contact?.billing_address && address === contact.billing_address && (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6, fontStyle: 'italic', lineHeight: 1.4 }}>
                Prefilled from {contact.name}'s billing address — edit these fields if this claim is for a different property.
              </div>
            )}
          </div>

          {/* CLAIM DETAILS */}
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Claim Details</div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <label className="label" style={{ fontSize: 11, marginBottom: 2 }}>Date of Loss</label>
                <DatePicker value={dateOfLoss} onChange={setDateOfLoss} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="label" style={{ fontSize: 11, marginBottom: 2 }}>Type of Loss</label>
                <select className="input" value={typeOfLoss} onChange={e => setTypeOfLoss(e.target.value)} style={{ height: 34, fontSize: 13, cursor: 'pointer' }}>
                  <option value="">Select...</option>
                  {LOSS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {/* Insurance carrier — required, searchable */}
            <div style={{ marginBottom: 8 }}>
              <label className="label" style={{ fontSize: 11, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                Insurance Carrier <span style={{ color: '#ef4444' }}>*</span>
                {!insuranceCompany && <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 400, marginLeft: 2 }}>(required)</span>}
              </label>
              <CarrierSelect
                value={insuranceCompany}
                onChange={setInsuranceCompany}
                carriers={carriers}
                onAdd={handleAddCarrier}
                required={!insuranceCompany}
                height={34}
              />
            </div>

            {/* Claim # — insurance only */}
            {!isOop && insuranceCompany && (
              <div>
                <label className="label" style={{ fontSize: 11, marginBottom: 2 }}>Claim #</label>
                <input className="input" value={claimNumber} onChange={e => setClaimNumber(e.target.value)} placeholder="Insurance claim #" style={{ height: 34, fontSize: 13 }} />
              </div>
            )}

            {/* OOP note */}
            {isOop && (
              <div style={{ padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 'var(--radius-md)', fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
                💡 Work authorization will include a <strong>private pay + conditional assignment</strong> clause — protects UPR if the client files a claim later.
              </div>
            )}
          </div>

          {/* NOTES */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Notes (optional)</div>
            <textarea className="input textarea" value={internalNotes} onChange={e => setInternalNotes(e.target.value)} rows={2} placeholder="Loss details, special instructions..." style={{ width: '100%', fontSize: 13, resize: 'vertical' }} />
          </div>
        </div>

        <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--border-color)', background: 'var(--bg-primary)' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || !contact}>
            {saving ? 'Creating...' : 'Create Job'}
          </button>
        </div>
      </div>

      {showAddContact && (
        <AddContactModal
          onClose={() => setShowAddContact(false)}
          onSave={handleNewContact}
          carriers={carriers}
          referralSources={[]}
          defaultRole="homeowner"
          prefillName={search.trim()}
        />
      )}
    </div>
  );
}
