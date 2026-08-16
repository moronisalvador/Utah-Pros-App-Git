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
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import MaterialIcon, { MATERIAL_LABELS } from './MaterialIcon';
import { apptHref } from '@/components/tech/v2/nav';

export default function StalledWidget() {
  // ─── SECTION: State & hooks ──────────────
  const { db, employee, isFeatureEnabled } = useAuth();
  const navigate = useNavigate();
  const enabled = isFeatureEnabled('page:tech_moisture');

  const [rows, setRows] = useState([]);
  const [expanded, setExpanded] = useState(false);

  // ─── SECTION: Data fetching ──────────────
  // employeeId is read out of `employee` rather than used as `employee?.id`
  // inside the dep array: an optional chain in the deps is what stops the React
  // Compiler preserving this memo (react-hooks/preserve-manual-memoization).
  const employeeId = employee?.id;

  // The fetch lives INSIDE the effect rather than in a useCallback above it.
  // Two reasons, both mechanical: a bare `load()` in an effect body reads as a
  // synchronous setState (react-hooks/set-state-in-effect) because the old
  // early-return called setRows before the first await; and the useCallback it
  // replaced could not be compiler-preserved. Every setRows below now happens
  // after an await and behind a cancelled-flag closure, which is also what
  // page-lifecycle.md §2 asks of a refetch. Cadence is unchanged: the deps are
  // the ones the useCallback already had.
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // Bails without touching state — the render guard below covers the
      // no-flag / no-employee case, so the rendered output is identical.
      if (!enabled || !employeeId) return;
      try {
        const result = await db.rpc('get_stalled_materials_for_employee', {
          p_employee_id: employeeId,
        });
        if (!cancelled) setRows(Array.isArray(result) ? result : []);
      } catch {
        // Silent — widget simply stays hidden.
        if (!cancelled) setRows([]);
      }
    };

    run();
    // Poll every 2 minutes so the widget reflects freshly-synced readings.
    const t = setInterval(run, 120_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [db, employeeId, enabled]);

  if (!enabled || !employeeId || rows.length === 0) return null;

  const jobCount = new Set(rows.map(r => r.job_id)).size;
  const visible = expanded ? rows : rows.slice(0, 3);

  // ─── SECTION: Render ──────────────
  return (
    <div
      style={{
        margin: '12px var(--space-4) 0',
        borderRadius: 14,
        background: 'var(--danger-bg)',
        border: '1px solid var(--danger-border)',
        padding: '10px 12px',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Text is --text-primary/--text-secondary, NOT --danger: --danger on
          --danger-bg measures 4.41:1 in light and 3.52:1 in dark, failing the
          4.5:1 floor in BOTH themes. The tint, the border and the red icons
          carry the alarm; the words stay readable. Same call as TimeTracker's
          save-error banner — see the comment there. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
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
              color: 'var(--text-secondary)',
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
            // apptHref, not a hardcoded path — the row already carries job_id,
            // so a Job Hub viewer lands on the Hub instead of the legacy page.
            onClick={() => navigate(apptHref(r.appointment_id, r.job_id))}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              textAlign: 'left',
              minHeight: 44,
              padding: '6px 8px',
              borderRadius: 10,
              // Was rgba(255,255,255,0.6)/rgba(220,38,38,0.15) — a hardcoded
              // WHITE veil is the worst frozen-light case: over the dark
              // --danger-bg it blends to #aba2a3 and drops --text-primary to
              // 2.24:1. color-mix keeps the same 60% veil over whatever
              // --bg-primary is, and resolves to #fffafa in light — the exact
              // byte value the old rgba produced, so light is untouched.
              background: 'color-mix(in srgb, var(--bg-primary) 60%, transparent)',
              border: '1px solid color-mix(in srgb, var(--danger) 15%, transparent)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <MaterialIcon type={r.material} size={18} style={{ color: 'var(--danger)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 700, color: 'var(--text-primary)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {MATERIAL_LABELS[r.material] || r.material}
                {r.room_name ? ` · ${r.room_name}` : ''}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
