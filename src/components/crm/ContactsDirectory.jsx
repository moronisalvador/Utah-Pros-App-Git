/**
 * ════════════════════════════════════════════════
 * FILE: ContactsDirectory.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The searchable, paged list of every customer/contact — the left side of the
 *   Contacts screen. You type a name, phone, email or company to filter, page
 *   through the results, and click a row to open that person's detail on the
 *   right. It also holds "Segments": saved filters (like "Sandy homeowners")
 *   that show a live count of who they'd reach and can be reused as the audience
 *   for an email campaign.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a slot component of /crm/contacts
 *   Rendered by:  src/pages/crm/CrmContacts.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db, employee)
 *   Data:      reads  → contacts (get_crm_contacts RPC), crm_segments
 *                       (get_segments RPC), contacts (preview_email_audience RPC
 *                       — segment preview counts)
 *              writes → crm_segments (upsert_segment / delete_segment RPCs)
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 6a (.claude/rules/crm-wave-ownership.md). onSelect(contactId)
 *     is passed by the skeleton to drive the ContactDetail slot.
 *   - A segment's `filter` uses the exact shape preview_email_audience consumes
 *     ({ referral_source, role, tag, city, company, search }), so a saved segment
 *     is a drop-in campaign audience — the count shown here is that same RPC.
 *   - get_crm_contacts returns total_count on every row (window count over the
 *     full match set) so paging needs no second count query.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ok, err } from '@/lib/toast';

const PAGE_SIZE = 25;
const EMPTY_FILTER = { referral_source: '', role: '', tag: '', city: '', company: '', search: '' };
// Strip blank keys so a saved filter carries only the criteria actually set.
const cleanFilter = (f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v && String(v).trim()));

export default function ContactsDirectory({ onSelect }) {
  const { db, employee } = useAuth();

  // ─── SECTION: State & hooks ──────────────
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState(null);

  const [segmentsOpen, setSegmentsOpen] = useState(false);
  const [segments, setSegments] = useState([]);
  const [segCounts, setSegCounts] = useState({}); // { [segmentId]: number | '…' }
  const [editing, setEditing] = useState(null);    // null | { id?, name, description, filter }
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  const debounceRef = useRef(null);

  // Debounce the search box → resets to page 0 on a new term.
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setSearch(searchInput.trim()); setPage(0); }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  // ─── SECTION: Data fetching ──────────────
  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.rpc('get_crm_contacts', {
        p_search: search || null, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE,
      });
      const list = data || [];
      setRows(list);
      setTotal(list.length ? Number(list[0].total_count) || 0 : 0);
    } catch {
      err('Failed to load contacts');
      setRows([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [db, search, page]);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  const loadSegments = useCallback(async () => {
    try {
      const data = await db.rpc('get_segments', {});
      const list = data || [];
      setSegments(list);
      // Live preview count per segment via the shared campaign-audience RPC.
      setSegCounts(Object.fromEntries(list.map(s => [s.id, '…'])));
      list.forEach(async (s) => {
        try {
          const aud = await db.rpc('preview_email_audience', { p_filter: s.filter || {} });
          setSegCounts(prev => ({ ...prev, [s.id]: (aud || []).length }));
        } catch {
          setSegCounts(prev => ({ ...prev, [s.id]: '—' }));
        }
      });
    } catch {
      err('Failed to load segments');
    }
  }, [db]);

  useEffect(() => { if (segmentsOpen) loadSegments(); }, [segmentsOpen, loadSegments]);

  // ─── SECTION: Event handlers ──────────────
  const selectContact = (id) => { setSelectedId(id); onSelect(id); };

  const saveSegment = async () => {
    const name = (editing?.name || '').trim();
    if (!name) { err('Give the segment a name'); return; }
    setSaving(true);
    try {
      await db.rpc('upsert_segment', {
        p_id: editing.id || null,
        p_name: name,
        p_description: (editing.description || '').trim() || null,
        p_filter: cleanFilter(editing.filter),
        p_created_by: employee?.id || null,
      });
      ok(editing.id ? 'Segment updated' : 'Segment saved');
      setEditing(null);
      loadSegments();
    } catch {
      err('Failed to save segment');
    } finally {
      setSaving(false);
    }
  };

  const deleteSegment = async (seg) => {
    if (confirmDel !== seg.id) { setConfirmDel(seg.id); return; }
    setConfirmDel(null);
    try {
      await db.rpc('delete_segment', { p_segment_id: seg.id });
      ok('Segment deleted');
      if (editing?.id === seg.id) setEditing(null);
      loadSegments();
    } catch {
      err('Failed to delete segment');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ─── SECTION: Render ──────────────
  return (
    <div className="crm-card crm-dir">
      {/* Segments */}
      <div className="crm-dir-segments">
        <button className="crm-dir-seg-toggle" onClick={() => setSegmentsOpen(o => !o)}>
          <span>Segments{segments.length ? ` (${segments.length})` : ''}</span>
          <span className="crm-dir-seg-caret">{segmentsOpen ? '▾' : '▸'}</span>
        </button>

        {segmentsOpen && (
          <div className="crm-dir-seg-body">
            {segments.length === 0 && !editing && (
              <p className="crm-panel-empty">No segments yet — save a filter to reuse it as a campaign audience.</p>
            )}

            {segments.map(seg => (
              <div key={seg.id} className="crm-dir-seg-row">
                <div className="crm-dir-seg-info">
                  <div className="crm-dir-seg-name">{seg.name}</div>
                  {seg.description && <div className="crm-dir-seg-desc">{seg.description}</div>}
                </div>
                <span className="crm-dir-seg-count">{segCounts[seg.id] ?? '…'}</span>
                <div className="crm-dir-seg-actions">
                  <button
                    className="crm-btn crm-btn-ghost crm-btn-xs"
                    onClick={() => { setConfirmDel(null); setEditing({ id: seg.id, name: seg.name, description: seg.description || '', filter: { ...EMPTY_FILTER, ...(seg.filter || {}) } }); }}
                  >
                    Edit
                  </button>
                  <button
                    className="crm-btn crm-btn-xs crm-dir-seg-del"
                    onClick={() => deleteSegment(seg)}
                    onBlur={() => setConfirmDel(null)}
                    data-confirm={confirmDel === seg.id ? 'true' : 'false'}
                  >
                    {confirmDel === seg.id ? 'Confirm' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}

            {editing ? (
              <div className="crm-dir-seg-form">
                <input
                  className="crm-input" placeholder="Segment name" value={editing.name}
                  onChange={e => setEditing({ ...editing, name: e.target.value })}
                />
                <input
                  className="crm-input" placeholder="Description (optional)" value={editing.description}
                  onChange={e => setEditing({ ...editing, description: e.target.value })}
                />
                <div className="crm-dir-seg-filters">
                  {[
                    ['tag', 'Tag'], ['referral_source', 'Referral source'], ['role', 'Role'],
                    ['city', 'City'], ['company', 'Company'], ['search', 'Name/email/phone'],
                  ].map(([key, label]) => (
                    <input
                      key={key} className="crm-input" placeholder={label}
                      value={editing.filter[key] || ''}
                      onChange={e => setEditing({ ...editing, filter: { ...editing.filter, [key]: e.target.value } })}
                    />
                  ))}
                </div>
                <div className="crm-dir-seg-form-actions">
                  <button className="crm-btn crm-btn-primary crm-btn-xs" onClick={saveSegment} disabled={saving}>
                    {saving ? 'Saving…' : (editing.id ? 'Update segment' : 'Save segment')}
                  </button>
                  <button className="crm-btn crm-btn-ghost crm-btn-xs" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button
                className="crm-btn crm-btn-ghost crm-btn-xs crm-dir-seg-new"
                onClick={() => setEditing({ name: '', description: '', filter: { ...EMPTY_FILTER } })}
              >
                + New segment
              </button>
            )}
          </div>
        )}
      </div>

      {/* Search */}
      <input
        className="crm-input crm-dir-search"
        placeholder="Search name, phone, email or company…"
        value={searchInput}
        onChange={e => setSearchInput(e.target.value)}
      />

      {/* List */}
      {loading ? (
        <p className="crm-panel-empty crm-dir-status">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="crm-panel-empty crm-dir-status">{search ? 'No contacts match your search.' : 'No contacts yet.'}</p>
      ) : (
        <div className="crm-dir-list">
          {rows.map(c => (
            <button
              key={c.id}
              className={`crm-dir-row${selectedId === c.id ? ' active' : ''}`}
              onClick={() => selectContact(c.id)}
            >
              <div className="crm-dir-row-main">
                <span className="crm-dir-row-name">{c.name || c.phone || 'Unnamed'}</span>
                {c.lifecycle_status && <span className="crm-dir-row-lifecycle">{c.lifecycle_status}</span>}
              </div>
              <div className="crm-dir-row-sub">
                {[c.company, c.phone, c.email].filter(Boolean).join(' · ') || '—'}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Pager */}
      {total > PAGE_SIZE && (
        <div className="crm-dir-pager">
          <button className="crm-btn crm-btn-ghost crm-btn-xs" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
            ← Prev
          </button>
          <span className="crm-dir-pager-info">Page {page + 1} of {totalPages} · {total} contacts</span>
          <button className="crm-btn crm-btn-ghost crm-btn-xs" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
