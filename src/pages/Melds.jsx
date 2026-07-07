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
 *   Internal:  @/lib/meldsSeed (temporary preview data),
 *              @/contexts/AuthContext
 *   Data:      reads  → none yet (preview data; will move to
 *                        db.rpc('get_melds') once the table lands)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - PREVIEW BUILD: the list is static seed data (real Melds from the inbox).
 *     "Import to UPR job" is not wired yet — it toasts a not-ready message. Both
 *     are replaced when the inbound-meld worker + melds table ship.
 *   - Classification (restoration vs. cleaning) is done upstream by
 *     functions/lib/property-meld.js using the Property Meld vendor account id,
 *     never the job title.
 */

import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { MELDS_SEED } from '@/lib/meldsSeed';

// ─── SECTION: Helpers ──────────────

function toast(message, type = 'info') {
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));
}

// Amber for work still needing acceptance, blue once accepted/underway, gray otherwise.
function statusColor(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('acceptance') || s.includes('availability')) return 'var(--warning, #d97706)';
  if (s.includes('completion') || s.includes('progress') || s.includes('scheduled')) return 'var(--info, #2563eb)';
  return 'var(--text-secondary)';
}

// ─── SECTION: Render ──────────────

export default function Melds() {
  useAuth(); // keeps the page inside the authenticated shell contract
  const [melds] = useState(MELDS_SEED);

  const openCount = useMemo(
    () => melds.filter((m) => /acceptance|availability/i.test(m.status || '')).length,
    [melds],
  );

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

      {/* Preview banner — remove once the live feed replaces the seed data. */}
      <div
        className="card"
        style={{
          marginBottom: 16,
          borderLeft: '3px solid var(--info, #2563eb)',
          background: 'var(--surface-2, rgba(37,99,235,0.06))',
        }}
      >
        <div className="card-body" style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          Preview — these are real restoration melds pulled from your Property Meld emails.
          Carpet-cleaning melds are filtered out. Live auto-updating and “Import to UPR job”
          arrive once the email feed is connected.
        </div>
      </div>

      {melds.length === 0 ? (
        <div className="card">
          <div className="card-body">
            <div className="empty-state">
              <p className="empty-state-title">No melds</p>
              <p className="empty-state-text">Restoration melds from Property Meld will appear here.</p>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {melds.map((m) => (
            <div key={m.meldNumber} className="card">
              <div className="card-body" style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 16 }}>{m.meldType}</span>
                    {m.isEmergency && (
                      <span
                        className="badge"
                        style={{ background: 'var(--danger, #dc2626)', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 999 }}
                      >
                        EMERGENCY
                      </span>
                    )}
                  </div>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-secondary)' }}>
                    #{m.meldNumber}
                  </span>
                </div>

                <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                  {[m.address.street, m.address.unit, m.address.cityStateZip].filter(Boolean).join(', ')}
                </div>

                {m.description && (
                  <div style={{ fontSize: 14 }}>
                    {m.description}
                    {m.descriptionTruncated && (
                      <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}> … (full details in Property Meld)</span>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                  <span style={{ color: statusColor(m.status), fontWeight: 600 }}>{m.status}</span>
                  {m.dueDate && <span style={{ color: 'var(--text-secondary)' }}>Due {m.dueDate}</span>}
                  {m.appointmentWindow && m.appointmentWindow !== 'Not scheduled' && (
                    <span style={{ color: 'var(--text-secondary)' }}>Appt: {m.appointmentWindow}</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                  <a
                    className="btn btn-secondary"
                    href={m.portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 13 }}
                  >
                    View in Property Meld
                  </a>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 13 }}
                    onClick={() => toast('Import to UPR job is coming next — once the melds table + email feed are connected.', 'info')}
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
