/**
 * ════════════════════════════════════════════════
 * FILE: Melds.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows the restoration jobs ("Melds") that come to us from our property-
 *   manager client through their Property Meld software. We only handle the
 *   restoration ones here — carpet-cleaning Melds belong to a different
 *   business and are filtered out before they ever reach this page. Each Meld
 *   shows the property, the work, the due date, and a link to open it in
 *   Property Meld (where the photos and full report live).
 *
 * WHERE IT LIVES:
 *   Route:        /melds  (owner-only for now)
 *   Rendered by:  src/App.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext
 *   Data:      reads  → get_property_meld_melds() RPC (property_meld_melds table)
 *              writes → none (import-to-job is a later phase)
 *
 * NOTES / GOTCHAS:
 *   - Rows come from the property_meld_melds table, populated by the inbound-
 *     meld worker (and, for now, a small verified backfill). Classification
 *     (restoration vs. cleaning) happens upstream in functions/lib/property-meld.js
 *     by the Property Meld vendor account id — never the job title.
 *   - Photos & the full inspection report are NOT in the email (portal-only);
 *     "View in Property Meld" (portal_url) is how a tech reaches them.
 *   - "Import to UPR job" is not wired yet — it toasts a not-ready message.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// ─── SECTION: Helpers ──────────────

function toast(message, type = 'info') {
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));
}

// Amber for work still needing acceptance, blue once accepted/underway, gray otherwise.
function statusColor(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('acceptance') || s.includes('availability')) return 'var(--status-waiting)';
  if (s.includes('completion') || s.includes('progress') || s.includes('scheduled')) return 'var(--status-active)';
  return 'var(--text-secondary)';
}

// ─── SECTION: Render ──────────────

export default function Melds() {
  const { db } = useAuth();
  const [melds, setMelds] = useState([]);
  const [loading, setLoading] = useState(true);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_property_meld_melds', { p_include_closed: false });
      setMelds(rows || []);
    } catch (e) {
      console.error('Melds load error:', e);
      toast('Failed to load melds', 'error');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const openCount = useMemo(
    () => melds.filter((m) => /acceptance|availability/i.test(m.status || '')).length,
    [melds],
  );

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Property Meld</h1>
          <p className="page-subtitle">
            {melds.length} restoration meld{melds.length !== 1 ? 's' : ''}
            {openCount > 0 ? ` · ${openCount} awaiting acceptance` : ''}
          </p>
        </div>
      </div>

      {melds.length === 0 ? (
        <div className="card">
          <div className="card-body">
            <div className="empty-state">
              <p className="empty-state-title">No melds yet</p>
              <p className="empty-state-text">
                Restoration melds from Property Meld will appear here. Carpet-cleaning melds are filtered out.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {melds.map((m) => (
            <div key={m.meld_number} className="card">
              <div className="card-body" style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 16 }}>{m.meld_type}</span>
                    {m.is_emergency && (
                      <span
                        className="badge"
                        style={{ background: 'var(--status-needs-response)', color: 'var(--accent-text)', fontSize: 11, padding: '2px 8px', borderRadius: 999 }}
                      >
                        EMERGENCY
                      </span>
                    )}
                  </div>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-secondary)' }}>
                    #{m.meld_number}
                  </span>
                </div>

                <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                  {m.address_full
                    || [m.address_street, m.address_unit, m.address_city_state_zip].filter(Boolean).join(', ')}
                </div>

                {m.description && (
                  <div style={{ fontSize: 14, whiteSpace: 'pre-line' }}>
                    {m.description}
                    {m.description_clipped && (
                      <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}> … (full details in Property Meld)</span>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                  <span style={{ color: statusColor(m.status), fontWeight: 600 }}>{m.status}</span>
                  {m.due_date_text && m.due_date_text !== 'None provided' && (
                    <span style={{ color: 'var(--text-secondary)' }}>Due {m.due_date_text}</span>
                  )}
                  {m.appointment_window && m.appointment_window !== 'Not scheduled' && (
                    <span style={{ color: 'var(--text-secondary)' }}>Appt: {m.appointment_window}</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                  {m.portal_url && (
                    <a
                      className="btn btn-secondary"
                      href={m.portal_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 13 }}
                    >
                      View in Property Meld
                    </a>
                  )}
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 13 }}
                    onClick={() => toast('Import to UPR job is coming next — the melds table is live; the import action is the next slice.', 'info')}
                  >
                    Import to UPR job
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
