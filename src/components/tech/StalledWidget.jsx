/**
 * ════════════════════════════════════════════════
 * FILE: StalledWidget.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A red warning banner on the tech dashboard that lists building materials
 *   which are not drying out fast enough across any job the tech has worked
 *   recently (a 30-day window). Each row shows the material, room, job number,
 *   current moisture reading versus the drying goal, and how many days it has
 *   been stuck. Tapping a row jumps to that job's latest appointment. When
 *   nothing is stalled, the banner shows nothing and takes up no space.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (banner widget)
 *   Rendered by:  src/pages/tech/TechDash.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom (useNavigate)
 *   Internal:  @/contexts/AuthContext (useAuth), ./MaterialIcon (icon + labels)
 *   Data:      reads  → get_stalled_materials_for_employee → appointment_crew,
 *                        appointments, jobs
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Hidden entirely unless the page:tech_moisture feature flag is on AND at
 *     least one material is stalled.
 *   - Re-polls every 2 minutes so it reflects freshly-synced readings; load
 *     failures are swallowed so the widget simply stays hidden.
 *   - Collapses to the first 3 rows with a "Show all (N)" toggle.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import MaterialIcon, { MATERIAL_LABELS } from './MaterialIcon';

export default function StalledWidget() {
  // ─── SECTION: State & hooks ──────────────
  const { db, employee, isFeatureEnabled } = useAuth();
  const navigate = useNavigate();
  const enabled = isFeatureEnabled('page:tech_moisture');

  const [rows, setRows] = useState([]);
  const [expanded, setExpanded] = useState(false);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    if (!enabled || !employee?.id) { setRows([]); return; }
    try {
      const result = await db.rpc('get_stalled_materials_for_employee', {
        p_employee_id: employee.id,
      });
      setRows(Array.isArray(result) ? result : []);
    } catch {
      // Silent — widget simply stays hidden.
      setRows([]);
    }
  }, [db, employee?.id, enabled]);

  useEffect(() => {
    load();
    // Poll every 2 minutes so the widget reflects freshly-synced readings.
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);

  if (!enabled || rows.length === 0) return null;

  const jobCount = new Set(rows.map(r => r.job_id)).size;
  const visible = expanded ? rows : rows.slice(0, 3);

  // ─── SECTION: Render ──────────────
  return (
    <div
      style={{
        margin: '12px var(--space-4) 0',
        borderRadius: 14,
        background: '#fef2f2',
        border: '1px solid #fecaca',
        padding: '10px 12px',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#dc2626' }}>
          {rows.length} material{rows.length === 1 ? '' : 's'} stalled
          {jobCount > 1 ? ` across ${jobCount} jobs` : ''}
        </div>
        {rows.length > 3 && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            style={{
              background: 'none',
              border: 'none',
              color: '#dc2626',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              padding: '2px 6px',
              minHeight: 32,
            }}
          >
            {expanded ? 'Show less' : `Show all (${rows.length})`}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {visible.map(r => (
          <button
            key={`${r.job_id}:${r.room_id || 'none'}:${r.material}`}
            type="button"
            onClick={() => navigate(`/tech/appointment/${r.appointment_id}`)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              textAlign: 'left',
              minHeight: 44,
              padding: '6px 8px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.6)',
              border: '1px solid rgba(220,38,38,0.15)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <MaterialIcon type={r.material} size={18} style={{ color: '#991b1b', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 700, color: '#991b1b',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {MATERIAL_LABELS[r.material] || r.material}
                {r.room_name ? ` · ${r.room_name}` : ''}
              </div>
              <div style={{ fontSize: 11, color: '#b91c1c' }}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{r.job_number}</span>
                {r.latest_mc != null && (
                  <>
                    {' · '}
                    <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{r.latest_mc}%</span>
                    {r.drying_goal_pct != null && (
                      <span style={{ opacity: 0.7 }}> / goal {r.drying_goal_pct}%</span>
                    )}
                  </>
                )}
                {r.days_stalled != null && (
                  <span style={{ opacity: 0.75 }}>{` · ${r.days_stalled}d stalled`}</span>
                )}
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
