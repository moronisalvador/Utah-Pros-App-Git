/**
 * ════════════════════════════════════════════════
 * FILE: MergeTool.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The Contacts "data quality" tool, with two jobs:
 *     • Duplicates — finds people entered twice (same phone or email) and folds
 *       the copies into one record you pick as the keeper, safely (all history
 *       moves over; the more-restrictive do-not-contact wins).
 *     • Owner & lifecycle — search for a contact and set who owns them and what
 *       lifecycle stage they're in (lead, prospect, customer, …).
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a slot component of /crm/contacts
 *   Rendered by:  src/pages/crm/CrmContacts.jsx (behind the "Find duplicates" toggle)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db)
 *   Data:      reads  → get_duplicate_contacts RPC, contacts (search), employees
 *                       (owner picker) · writes → contacts (via merge_contacts,
 *                       set_contact_owner, set_contact_lifecycle RPCs)
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 6b (.claude/rules/crm-wave-ownership.md).
 *   - The owner/lifecycle editor lives HERE, not in ContactDetail.jsx: that file
 *     is Phase 6a's and frozen read-only for the wave, and the CrmContacts
 *     skeleton (also frozen) exposes no detail-slot for 6b to inject setters
 *     into. This panel is the wave-compliant home for the per-contact setters.
 *   - Merge uses inline two-click confirm (CLAUDE.md rule 2 — never confirm()).
 *     merge_contacts was made CRM-history-safe by Foundation (P0 fix).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const toast = (message, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));

const LIFECYCLE_OPTIONS = ['lead', 'prospect', 'customer', 'past_customer', 'archived'];

export default function MergeTool() {
  const { db } = useAuth();
  const [tab, setTab] = useState('duplicates'); // 'duplicates' | 'ownership'

  return (
    <div className="crm-card crm-mergetool">
      <div className="crm-mergetool-tabs">
        <button
          className={`crm-mergetool-tab${tab === 'duplicates' ? ' active' : ''}`}
          onClick={() => setTab('duplicates')}
        >
          Duplicates
        </button>
        <button
          className={`crm-mergetool-tab${tab === 'ownership' ? ' active' : ''}`}
          onClick={() => setTab('ownership')}
        >
          Owner &amp; lifecycle
        </button>
      </div>
      {tab === 'duplicates' ? <DuplicatesTab db={db} /> : <OwnershipTab db={db} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Duplicates — get_duplicate_contacts + merge_contacts
// ══════════════════════════════════════════════════════════════
function DuplicatesTab({ db }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [keepers, setKeepers] = useState({}); // groupKey → contactId to keep
  const [confirmKey, setConfirmKey] = useState(null);
  const [merging, setMerging] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_duplicate_contacts');
      setGroups(rows || []);
      const seed = {};
      (rows || []).forEach(g => { seed[g.phone_normalized] = g.contact_ids?.[0]; });
      setKeepers(seed);
    } catch { toast('Failed to load duplicates', 'error'); }
    finally { setLoading(false); }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const mergeGroup = async (group) => {
    const key = group.phone_normalized;
    const keepId = keepers[key];
    if (!keepId) return;
    const losers = (group.contact_ids || []).filter(id => id !== keepId);
    setMerging(key);
    try {
      for (const loserId of losers) {
        await db.rpc('merge_contacts', { p_keep_id: keepId, p_merge_id: loserId });
      }
      toast(`Merged ${losers.length} duplicate${losers.length === 1 ? '' : 's'}`);
      setConfirmKey(null);
      load();
    } catch {
      toast('Merge failed', 'error');
    } finally {
      setMerging(null);
    }
  };

  if (loading) return <p className="crm-panel-empty">Scanning for duplicates…</p>;
  if (groups.length === 0) return <p className="crm-panel-empty">No duplicate contacts found. 🎉</p>;

  return (
    <div className="crm-dup-list">
      <p className="crm-impexp-sub">
        {groups.length} duplicate group{groups.length === 1 ? '' : 's'}. Pick the record to keep — the rest fold into it (all history preserved).
      </p>
      {groups.map((g) => {
        const key = g.phone_normalized;
        const ids = g.contact_ids || [];
        const names = g.names || [];
        return (
          <div key={key} className="crm-dup-group">
            <div className="crm-dup-group-head">
              <span className="crm-dup-group-key">{key}</span>
              <span className="crm-dup-group-count">{g.count} records</span>
            </div>
            <div className="crm-dup-options">
              {ids.map((id, i) => (
                <label key={id} className="crm-dup-option">
                  <input
                    type="radio"
                    name={`keep-${key}`}
                    checked={keepers[key] === id}
                    onChange={() => setKeepers(k => ({ ...k, [key]: id }))}
                  />
                  <span>{names[i] || id}</span>
                </label>
              ))}
            </div>
            {confirmKey === key ? (
              <div className="crm-dup-confirm">
                <span>Merge {ids.length - 1} into the keeper?</span>
                <button className="crm-btn crm-btn-danger crm-btn-sm" onClick={() => mergeGroup(g)} disabled={merging === key}>
                  {merging === key ? 'Merging…' : 'Confirm merge'}
                </button>
                <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => setConfirmKey(null)} disabled={merging === key}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => setConfirmKey(key)}>
                Merge duplicates
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Owner & lifecycle — set_contact_owner + set_contact_lifecycle
// ══════════════════════════════════════════════════════════════
function OwnershipTab({ db }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [saving, setSaving] = useState(null); // `${id}:owner` | `${id}:lifecycle`

  useEffect(() => {
    (async () => {
      try {
        const rows = await db.rpc('get_all_employees');
        setEmployees((rows || []).filter(e => e.is_active !== false));
      } catch { /* dropdown stays empty */ }
    })();
  }, [db]);

  const search = async (e) => {
    e?.preventDefault?.();
    const q = query.trim();
    if (!q) { setResults([]); return; }
    setSearching(true);
    try {
      const enc = encodeURIComponent(`%${q}%`);
      const rows = await db.select(
        'contacts',
        `or=(name.ilike.${enc},email.ilike.${enc},phone.ilike.${enc})&select=id,name,phone,email,owner_id,lifecycle_status&order=name.asc&limit=25`
      );
      setResults(rows || []);
      if (!(rows || []).length) toast('No contacts matched', 'error');
    } catch { toast('Search failed', 'error'); }
    finally { setSearching(false); }
  };

  const setOwner = async (contact, ownerId) => {
    setSaving(`${contact.id}:owner`);
    try {
      await db.rpc('set_contact_owner', { p_contact_id: contact.id, p_owner_id: ownerId || null });
      setResults(rs => rs.map(r => r.id === contact.id ? { ...r, owner_id: ownerId || null } : r));
      toast('Owner updated');
    } catch { toast('Failed to set owner', 'error'); }
    finally { setSaving(null); }
  };

  const setLifecycle = async (contact, status) => {
    setSaving(`${contact.id}:lifecycle`);
    try {
      await db.rpc('set_contact_lifecycle', { p_contact_id: contact.id, p_lifecycle_status: status || null });
      setResults(rs => rs.map(r => r.id === contact.id ? { ...r, lifecycle_status: status || null } : r));
      toast('Lifecycle updated');
    } catch { toast('Failed to set lifecycle', 'error'); }
    finally { setSaving(null); }
  };

  return (
    <div className="crm-own">
      <form className="crm-own-search" onSubmit={search}>
        <input
          className="crm-input"
          placeholder="Search contacts by name, phone or email…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button className="crm-btn crm-btn-primary crm-btn-sm" type="submit" disabled={searching}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {results.map((c) => (
        <div key={c.id} className="crm-own-row">
          <div className="crm-own-name">
            <strong>{c.name || c.phone || 'Unnamed'}</strong>
            <span className="crm-own-sub">{c.email || c.phone || ''}</span>
          </div>
          <label className="crm-own-field">
            <span className="crm-panel-label">Owner</span>
            <select
              className="crm-input"
              value={c.owner_id || ''}
              disabled={saving === `${c.id}:owner`}
              onChange={e => setOwner(c, e.target.value)}
            >
              <option value="">— Unassigned —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name || e.display_name || e.email}</option>)}
            </select>
          </label>
          <label className="crm-own-field">
            <span className="crm-panel-label">Lifecycle</span>
            <select
              className="crm-input"
              value={c.lifecycle_status || ''}
              disabled={saving === `${c.id}:lifecycle`}
              onChange={e => setLifecycle(c, e.target.value)}
            >
              <option value="">— None —</option>
              {LIFECYCLE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        </div>
      ))}
    </div>
  );
}
