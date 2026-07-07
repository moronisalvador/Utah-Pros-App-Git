/**
 * ════════════════════════════════════════════════
 * FILE: EstimateCreateForm.jsx  (Admin Mobile — new-estimate shell, P4b)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "new estimate" form on the phone. An estimate needs only a customer —
 *   no job or claim yet. You search for the customer (or add a brand-new one
 *   right here), pick what kind of job it would become, optionally note the
 *   property address, choose the estimate type, and tap Create. If the customer
 *   already has estimates they're listed so you don't make a duplicate by
 *   accident. A job & claim are created later, only if the estimate sells.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (form component)
 *   Rendered by:  src/pages/tech/admin/AdminEstimateEditor.jsx (create mode)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./estimateBuilder (buildCreateEstimatePayload),
 *              @/components/AddContactModal, @/components/AddressAutocomplete,
 *              @/components/DivisionIcons (DIVISION_COLORS), @/lib/toast
 *   Data:      reads  → search_contacts_for_job RPC, get_insurance_carriers RPC,
 *                       estimates (this customer's existing ones), contacts
 *                       (duplicate-phone lookup)
 *              writes → contacts (inline new customer),
 *                       create_estimate_for_contact RPC (call-only)
 *
 * NOTES / GOTCHAS:
 *   - Mirrors the desktop NewEstimateModal flow (contact-only create; parent-side
 *     insert + duplicate-phone fallback for the inline new customer).
 *   - The create payload is built by buildCreateEstimatePayload — pinned by the
 *     named P4b "create-shell payload" test.
 *   - Guards double-submit: the Create button latches while the RPC is in flight.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from '@/lib/toast';
import { DIVISION_COLORS } from '@/components/DivisionIcons';
import AddContactModal from '@/components/AddContactModal';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { buildCreateEstimatePayload } from './estimateBuilder';

const fmtPh = (phone) => {
  if (!phone) return '';
  const d = phone.replace(/\D/g, '');
  const n = d.startsWith('1') ? d.slice(1) : d;
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : phone;
};
const TYPES = [['initial', 'Initial'], ['supplement', 'Supplement'], ['change_order', 'Change order'], ['final', 'Final']];
const DIVISIONS = [
  ['water', 'Water'], ['mold', 'Mold'], ['reconstruction', 'Reconstruction'],
  ['remodeling', 'Remodeling'], ['fire', 'Fire'], ['contents', 'Contents'],
];

export default function EstimateCreateForm({ db, employee, onCreated, onOpenExisting }) {
  // ─── SECTION: State & hooks ──────────────
  const [selectedContact, setSelectedContact] = useState(null);
  const [estType, setEstType] = useState('initial');
  const [division, setDivision] = useState('water');
  const [addr, setAddr] = useState({ address: '', city: '', state: 'UT', zip: '' });
  const [existing, setExisting] = useState([]);
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef(null);

  const [showAddContact, setShowAddContact] = useState(false);
  const [carriers, setCarriers] = useState([]);

  useEffect(() => { db.rpc('get_insurance_carriers').then(setCarriers).catch(() => {}); }, [db]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // ─── SECTION: Data fetching ──────────────
  // When a customer is chosen: load their estimates (dup guard) + prefill the
  // property address from their billing address.
  useEffect(() => {
    if (!selectedContact?.id) return;
    db.select('estimates', `contact_id=eq.${selectedContact.id}&select=id,estimate_number,estimate_type,status,intended_division,converted_invoice_id&order=created_at.desc`)
      .then((rows) => setExisting(rows || []))
      .catch(() => setExisting([]));
    if (selectedContact.billing_address) {
      setAddr({
        address: selectedContact.billing_address || '',
        city: selectedContact.billing_city || '',
        state: selectedContact.billing_state || 'UT',
        zip: selectedContact.billing_zip || '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContact?.id]);

  const doSearch = useCallback(async (q) => {
    setSearching(true);
    try {
      const r = await db.rpc('search_contacts_for_job', { p_query: q.trim() });
      setResults(Array.isArray(r) ? r : []);
    } catch { setResults([]); }
    finally { setSearching(false); }
  }, [db]);

  const onSearchChange = (e) => {
    const v = e.target.value;
    setSearch(v);
    clearTimeout(timer.current);
    if (v.trim().length >= 2) timer.current = setTimeout(() => doSearch(v), 300);
    else setResults([]);
  };

  // ─── SECTION: Event handlers ──────────────
  const selectContact = (c) => { setSelectedContact(c); setSearch(''); setResults([]); };
  const changeCustomer = () => {
    setSelectedContact(null); setExisting([]);
    setAddr({ address: '', city: '', state: 'UT', zip: '' });
  };

  // Inline new customer — mirrors NewEstimateModal: parent inserts + handles duplicate phone.
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
        toast('A customer with this phone already exists — search by name.', 'error');
        throw err;
      }
      toast('Failed to create customer: ' + msg, 'error');
      throw err;
    }
  };

  const createEstimate = async () => {
    if (!selectedContact?.id) { toast('Pick a customer first', 'error'); return; }
    if (busy) return;
    setBusy(true);
    try {
      const created = await db.rpc('create_estimate_for_contact', buildCreateEstimatePayload({
        contactId: selectedContact.id,
        division,
        estimateType: estType,
        addr,
        createdBy: employee?.id || null,
      }));
      const row = Array.isArray(created) ? created[0] : created;
      if (row?.id) { onCreated(row); return; } // navigating unmounts — leave busy set
      toast('Could not open the estimate', 'error');
      setBusy(false);
    } catch (e) {
      toast('Failed to create estimate: ' + (e.message || e), 'error');
      setBusy(false);
    }
  };

  // ─── SECTION: Render ──────────────
  return (
    <div className="am-estb-create">
      {/* Customer (search, or chip once chosen) */}
      {!selectedContact ? (
        <div className="am-estb-search-wrap">
          <div className="am-estb-field-label">Customer</div>
          <input
            className="am-estb-input"
            value={search}
            onChange={onSearchChange}
            placeholder="Search name, phone, or email…"
            autoFocus
          />
          {search.trim().length >= 2 && (
            <div className="am-estb-results">
              {searching && <div className="am-estb-results-note">Searching…</div>}
              {!searching && results.length === 0 && <div className="am-estb-results-note">No customers found.</div>}
              {results.map((c) => (
                <button key={c.id} type="button" className="am-estb-result" onClick={() => selectContact(c)}>
                  <span className="am-estb-result-name">{c.name}</span>
                  <span className="am-estb-result-meta">{fmtPh(c.phone)}{c.email ? ` · ${c.email}` : ''}</span>
                </button>
              ))}
            </div>
          )}
          <button type="button" className="am-estb-newcust" onClick={() => setShowAddContact(true)}>
            + New customer
          </button>
        </div>
      ) : (
        <div className="am-estb-contact-chip">
          <div className="am-estb-contact-info">
            <div className="am-estb-result-name">{selectedContact.name}</div>
            <div className="am-estb-result-meta">{fmtPh(selectedContact.phone)}</div>
          </div>
          <button type="button" className="am-estb-chg" onClick={changeCustomer}>Change</button>
        </div>
      )}

      {selectedContact && (
        <>
          {/* Intended division (what job type it would become) */}
          <div className="am-estb-field">
            <div className="am-estb-field-label">Job type (if it sells)</div>
            <div className="am-estb-chips">
              {DIVISIONS.map(([v, label]) => {
                const on = division === v;
                const c = DIVISION_COLORS[v] || 'var(--accent)';
                return (
                  <button
                    key={v}
                    type="button"
                    className={`am-estb-chip${on ? ' am-estb-chip--on' : ''}`}
                    style={on ? { color: c, borderColor: c, background: `color-mix(in srgb, ${c} 10%, transparent)` } : undefined}
                    onClick={() => setDivision(v)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Estimate type */}
          <div className="am-estb-field">
            <div className="am-estb-field-label">Estimate type</div>
            <div className="am-estb-chips">
              {TYPES.map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  className={`am-estb-chip${estType === v ? ' am-estb-chip--accent' : ''}`}
                  onClick={() => setEstType(v)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Optional property address */}
          <div className="am-estb-field">
            <div className="am-estb-field-label">Property address <span className="am-estb-optional">(optional)</span></div>
            <AddressAutocomplete
              className="am-estb-input"
              value={addr.address}
              onChange={(v) => setAddr((a) => ({ ...a, address: v }))}
              onSelect={(p) => setAddr({ address: p.address, city: p.city, state: p.state || 'UT', zip: p.zip })}
              placeholder="Street address"
              touchTarget
            />
            <div className="am-estb-addr-row">
              <input className="am-estb-input" value={addr.city} onChange={(e) => setAddr((a) => ({ ...a, city: e.target.value }))} placeholder="City" />
              <input className="am-estb-input am-estb-input--state" value={addr.state} onChange={(e) => setAddr((a) => ({ ...a, state: e.target.value }))} placeholder="State" />
              <input className="am-estb-input am-estb-input--zip" value={addr.zip} onChange={(e) => setAddr((a) => ({ ...a, zip: e.target.value }))} placeholder="ZIP" />
            </div>
          </div>

          {/* This customer's existing estimates — duplicate guard */}
          {existing.length > 0 && (
            <div className="am-estb-field">
              <div className="am-estb-field-label">Existing estimates</div>
              <div className="am-estb-chips">
                {existing.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={`am-estb-chip${e.converted_invoice_id ? ' am-estb-chip--sold' : ''}`}
                    onClick={() => onOpenExisting(e.id)}
                  >
                    {e.estimate_number || 'Draft'}
                    {e.intended_division ? ` · ${e.intended_division}` : ''}
                    {e.converted_invoice_id ? ' · sold' : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button type="button" className="am-est-btn am-est-btn--send" disabled={busy} onClick={createEstimate}>
            {busy ? 'Creating…' : 'Create estimate'}
          </button>
        </>
      )}

      <div className="am-est-note">
        An estimate needs only a customer. A job &amp; claim are created only if it sells (converts to an invoice).
      </div>

      {showAddContact && (
        <AddContactModal
          onClose={() => setShowAddContact(false)}
          onSave={handleNewContact}
          carriers={carriers}
          referralSources={[]}
        />
      )}
    </div>
  );
}
