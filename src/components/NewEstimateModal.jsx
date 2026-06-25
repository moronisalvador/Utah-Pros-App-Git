/**
 * ════════════════════════════════════════════════
 * FILE: NewEstimateModal.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "+ New estimate" picker. An estimate is pre-sale, so it needs only a CLIENT —
 *   no job yet. You search for an existing customer (or create a new one right here),
 *   pick what kind of job it would become (the division), optionally note the property
 *   address, choose the estimate type, and it creates the estimate and opens its builder.
 *   A job/claim is created later, only if the estimate is sold (converted to an invoice).
 *
 * WHERE IT LIVES:
 *   Rendered by:  src/pages/Estimates.jsx and the global "+ New" menu (Layout.jsx)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/components/DivisionIcons (DIVISION_COLORS), @/components/AddContactModal
 *              (inline new client), @/components/AddressAutocomplete (optional property address)
 *   Data:      reads  → search_contacts_for_job RPC, get_insurance_carriers RPC, estimates
 *                       (this client's existing estimates), contacts (dup-phone lookup)
 *              writes → contacts (inline new client), create_estimate_for_contact RPC
 *
 * NOTES / GOTCHAS:
 *   - Estimates are CLIENT-owned, not job-owned. No claim/job is selected or created here.
 *   - New-client creation reuses AddContactModal exactly like CreateJobModal (parent does the
 *     insert + duplicate-phone fallback).
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DIVISION_COLORS } from '@/components/DivisionIcons';
import AddContactModal from '@/components/AddContactModal';
import AddressAutocomplete from '@/components/AddressAutocomplete';

const toast = (m, t = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));
const fmtPh = (phone) => { if (!phone) return ''; const d = phone.replace(/\D/g, ''); const n = d.startsWith('1') ? d.slice(1) : d; return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : phone; };
const TYPES = [['initial', 'Initial'], ['supplement', 'Supplement'], ['change_order', 'Change order'], ['final', 'Final']];
const DIVISIONS = [['water', '\u{1F4A7}', 'Water'], ['mold', '\u{1F9A0}', 'Mold'], ['reconstruction', '\u{1F3D7}️', 'Reconstruction'], ['fire', '\u{1F525}', 'Fire'], ['contents', '\u{1F4E6}', 'Contents']];

function IconSearch(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>); }
function IconUser(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>); }
function IconX(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>); }

export default function NewEstimateModal({ db, onClose, contact = null }) {
  const navigate = useNavigate();
  const lockToCustomer = !!contact;

  const [selectedContact, setSelectedContact] = useState(contact);
  const [estType, setEstType] = useState('initial');
  const [division, setDivision] = useState('water');
  const [addr, setAddr] = useState({ address: '', city: '', state: 'UT', zip: '' });
  const [existing, setExisting] = useState([]);            // this client's existing estimates
  const [busy, setBusy] = useState(false);

  // Customer search (global mode)
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDrop, setShowDrop] = useState(false);
  const searchRef = useRef(null);
  const timer = useRef(null);

  // Inline new-client creation
  const [showAddContact, setShowAddContact] = useState(false);
  const [carriers, setCarriers] = useState([]);

  useEffect(() => { db.rpc('get_insurance_carriers').then(setCarriers).catch(() => {}); }, [db]);

  // ─── SECTION: Data fetching ──────────────
  const loadExisting = useCallback(async (contactId) => {
    try {
      const rows = await db.select('estimates', `contact_id=eq.${contactId}&select=id,estimate_number,estimate_type,status,intended_division,converted_invoice_id&order=created_at.desc`) || [];
      setExisting(rows);
    } catch { setExisting([]); }
  }, [db]);

  // When a customer is chosen, load their estimates + prefill the property address from billing.
  useEffect(() => {
    if (!selectedContact?.id) return;
    loadExisting(selectedContact.id);
    if (selectedContact.billing_address) {
      setAddr({ address: selectedContact.billing_address || '', city: selectedContact.billing_city || '', state: selectedContact.billing_state || 'UT', zip: selectedContact.billing_zip || '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContact?.id]);

  useEffect(() => {
    const h = e => { if (searchRef.current && !searchRef.current.contains(e.target)) setShowDrop(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const doSearch = useCallback(async (q) => {
    if (q.trim().length < 2) { setResults([]); setShowDrop(false); return; }
    setSearching(true);
    try {
      const r = await db.rpc('search_contacts_for_job', { p_query: q.trim() });
      setResults(Array.isArray(r) ? r : []); setShowDrop(true);
    } catch { setResults([]); } finally { setSearching(false); }
  }, [db]);

  const onSearchChange = (e) => {
    const v = e.target.value; setSearch(v); clearTimeout(timer.current);
    if (v.trim().length >= 2) timer.current = setTimeout(() => doSearch(v), 300);
    else { setResults([]); setShowDrop(false); }
  };

  // ─── SECTION: Event handlers ──────────────
  const selectContact = (c) => { setSelectedContact(c); setSearch(''); setShowDrop(false); setResults([]); };
  const changeCustomer = () => { setSelectedContact(null); setExisting([]); setAddr({ address: '', city: '', state: 'UT', zip: '' }); };

  // Inline new contact — mirrors CreateJobModal: parent inserts + handles duplicate phone.
  const handleNewContact = async (data) => {
    try {
      const r = await db.insert('contacts', data);
      const c = Array.isArray(r) ? r[0] : r;
      if (c) { setSelectedContact(c); setShowAddContact(false); }
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('contacts_phone_key') || msg.includes('23505')) {
        const ex = await db.select('contacts', `phone=eq.${encodeURIComponent(data.phone)}&select=*&limit=1`).catch(() => []);
        if (ex?.length) { setSelectedContact(ex[0]); setShowAddContact(false); toast(`Found existing customer: ${ex[0].name}`); return; }
        toast('A customer with this phone already exists — search by name.', 'error'); throw err;
      }
      toast('Failed to create customer: ' + msg, 'error'); throw err;
    }
  };

  const createEstimate = async () => {
    if (!selectedContact?.id) { toast('Pick a customer first', 'error'); return; }
    setBusy(true);
    try {
      const created = await db.rpc('create_estimate_for_contact', {
        p_contact_id: selectedContact.id,
        p_intended_division: division,
        p_estimate_type: estType,
        p_property_address: addr.address || null,
        p_property_city: addr.city || null,
        p_property_state: addr.state || null,
        p_property_zip: addr.zip || null,
      });
      const id = Array.isArray(created) ? created[0]?.id : created?.id;
      if (id) { onClose?.(); navigate(`/estimates/${id}`); }      // navigating unmounts — leave busy set
      else { toast('Could not open the estimate', 'error'); setBusy(false); }
    } catch (e) {
      toast('Failed to create estimate: ' + (e.message || e), 'error');
      setBusy(false);
    }
  };
  const openExisting = (eid) => { onClose?.(); navigate(`/estimates/${eid}`); };

  // ─── SECTION: Render ──────────────
  return (
    <>
    <div className="conv-modal-backdrop" onClick={onClose}>
      <div className="conv-modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 560, height: 'min(86vh, 680px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        <div className="conv-modal-header" style={{ flexShrink: 0 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>New Estimate</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ width: 32, height: 32, padding: 0 }}>
            <IconX style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
          {/* Customer (search, or chip once chosen) */}
          {!selectedContact ? (
            <div ref={searchRef} style={{ position: 'relative', marginBottom: 'var(--space-3)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Customer</div>
              <div style={{ position: 'relative' }}>
                <IconSearch style={{ width: 14, height: 14, position: 'absolute', left: 10, top: 12, color: 'var(--text-tertiary)' }} />
                <input className="input" placeholder="Search name, phone, or email…" value={search} onChange={onSearchChange} autoFocus style={{ paddingLeft: 32, height: 38 }} />
                {searching && <div style={{ position: 'absolute', right: 10, top: 12 }}><div className="spinner" style={{ width: 14, height: 14 }} /></div>}
              </div>
              {showDrop && (
                <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 20, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', maxHeight: 260, overflowY: 'auto', marginTop: 4 }}>
                  {results.length === 0 ? (
                    <div style={{ padding: 'var(--space-3)' }}>
                      <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: search.trim().length >= 2 ? 8 : 0 }}>{search.trim().length >= 2 ? 'No customers found.' : 'Type 2+ characters'}</div>
                      {search.trim().length >= 2 && <button onClick={() => { setShowDrop(false); setShowAddContact(true); }} className="btn btn-secondary btn-sm" style={{ width: '100%', justifyContent: 'center' }}>+ New customer</button>}
                    </div>
                  ) : results.map(c => (
                    <button key={c.id} onClick={() => selectContact(c)}
                      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', width: '100%', padding: 'var(--space-2) var(--space-3)', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-sans)', borderBottom: '1px solid var(--border-light)' }}>
                      <IconUser style={{ width: 15, height: 15, color: 'var(--text-tertiary)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{fmtPh(c.phone)}{c.email ? ` · ${c.email}` : ''}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-3)' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--brand-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {selectedContact.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedContact.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{fmtPh(selectedContact.phone)}</div>
              </div>
              {!lockToCustomer && <button className="btn btn-ghost btn-sm" onClick={changeCustomer} style={{ fontSize: 12 }}>Change</button>}
            </div>
          )}

          {!selectedContact ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
              <div style={{ marginBottom: 12 }}>Search for a customer to estimate, or add a new one.</div>
              <button onClick={() => setShowAddContact(true)} className="btn btn-secondary btn-sm">+ New customer</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {/* Intended division (what job type it would become) */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Job type (if it sells)</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {DIVISIONS.map(([v, em, label]) => {
                    const on = division === v;
                    const c = DIVISION_COLORS[v] || 'var(--accent)';
                    return (
                      <button key={v} onClick={() => setDivision(v)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600, background: on ? c + '18' : 'var(--bg-primary)', color: on ? c : 'var(--text-secondary)', border: `1px solid ${on ? c : 'var(--border-color)'}` }}>
                        <span style={{ fontSize: 15 }}>{em}</span>{label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Estimate type */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Estimate type</div>
                <div style={{ display: 'flex', gap: 1, background: 'var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden', width: 'fit-content' }}>
                  {TYPES.map(([v, l]) => (
                    <button key={v} onClick={() => setEstType(v)}
                      style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)', cursor: 'pointer', border: 'none', background: estType === v ? 'var(--accent)' : 'var(--bg-primary)', color: estType === v ? '#fff' : 'var(--text-secondary)' }}>{l}</button>
                  ))}
                </div>
              </div>

              {/* Optional property address */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Property address <span style={{ fontWeight: 500, textTransform: 'none' }}>(optional)</span></div>
                <AddressAutocomplete
                  value={addr.address}
                  onChange={(v) => setAddr(a => ({ ...a, address: v }))}
                  onSelect={(p) => setAddr({ address: p.address, city: p.city, state: p.state || 'UT', zip: p.zip })}
                  placeholder="Street address"
                  style={{ height: 36, fontSize: 13, marginBottom: 6 }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="input" value={addr.city}  onChange={e => setAddr(a => ({ ...a, city: e.target.value }))}  placeholder="City"  style={{ flex: 1, height: 36, fontSize: 13 }} />
                  <input className="input" value={addr.state} onChange={e => setAddr(a => ({ ...a, state: e.target.value }))} placeholder="State" style={{ width: 64, height: 36, fontSize: 13 }} />
                  <input className="input" value={addr.zip}   onChange={e => setAddr(a => ({ ...a, zip: e.target.value }))}   placeholder="ZIP"   style={{ width: 90, height: 36, fontSize: 13 }} />
                </div>
              </div>

              {/* This client's existing estimates */}
              {existing.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Existing estimates</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {existing.map(e => (
                      <button key={e.id} onClick={() => openExisting(e.id)}
                        style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 'var(--radius-full)', background: e.converted_invoice_id ? '#f0fdf4' : 'var(--accent-light)', color: e.converted_invoice_id ? '#16a34a' : 'var(--accent)', border: `1px solid ${e.converted_invoice_id ? '#bbf7d0' : '#bfdbfe'}`, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                        {e.estimate_number || 'Draft'}{e.intended_division ? ` · ${e.intended_division}` : ''}{e.converted_invoice_id ? ' · sold' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, padding: '10px var(--space-4) 12px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.4, flex: 1 }}>
            An estimate needs only a client. A job &amp; claim are created only if it sells (converts to an invoice).
          </span>
          {selectedContact && <button className="btn btn-primary btn-sm" disabled={busy} onClick={createEstimate}>{busy ? 'Creating…' : 'Create estimate'}</button>}
        </div>
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
    </>
  );
}
