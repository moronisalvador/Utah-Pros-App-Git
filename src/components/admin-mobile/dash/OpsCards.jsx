/**
 * ════════════════════════════════════════════════
 * FILE: OpsCards.jsx  (admin-mobile Dashboard — operations cards)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Four operational cards on the mobile admin dashboard: Active drying (which jobs
 *   have equipment running and how close they are to dry), Action required (paperwork
 *   awaiting signature, most urgent first), Employee status (who is clocked in right
 *   now and for how long), and Production pipeline (how many jobs sit in each stage).
 *   Each loads its own data and shows a short scrollable list or a set of bars.
 *
 * WHERE IT LIVES:
 *   Route:        rendered inside /tech/admin/dash
 *   Rendered by:  src/pages/tech/admin/AdminDash.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./useDashWidget, ./DashCard, ./dashFormat
 *   Data:      reads → get_active_drying_jobs, get_dashboard_action_items,
 *              get_tech_status_board, get_pipeline_summary · writes → none
 *
 * NOTES / GOTCHAS:
 *   - These cards are visible to any admin (not financial) — see dashPlan.js.
 *   - Rows here point at JOBS, which have no admin-mobile screen in this wave, so
 *     they are shown as read-only rows (no fake links, no hardcoded /jobs paths).
 *     The frozen href helper only deep-links the money/estimate screens.
 *   - Status colour carries meaning at a glance (tech-mobile-ux "colour from 3
 *     feet"): green = clocked in, red = check clock-out / overdue, amber = warning.
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useDashWidget } from './useDashWidget';
import { DashCard, DashEmpty } from './DashCard';
import {
  shapeActiveDrying, shapeActionItems, shapeEmployeeStatus, shapePipeline,
} from './dashFormat';

// ─── SECTION: Active drying ──────────────
export function ActiveDryingCard() {
  const loader = useCallback((db) => db.rpc('get_active_drying_jobs').then(shapeActiveDrying), []);
  const { data, loading, error, reload } = useDashWidget(loader);
  return (
    <DashCard
      title="Active drying"
      suffix="· % to dry standard"
      loading={loading}
      error={error}
      onRetry={reload}
      footer={data && data.rows.length > 0 ? (
        <div className="am-dash-foot-split">
          <span>{data.summary}</span>
          {data.warn && <span className="am-dash-foot-warn">{data.warn}</span>}
        </div>
      ) : null}
    >
      {data && (
        data.rows.length === 0 ? (
          <DashEmpty>No active drying jobs right now.</DashEmpty>
        ) : (
          <div className="am-dash-list am-dash-list--scroll">
            {data.rows.map((r) => (
              <div key={r.job} className="am-dash-dry-row">
                <div className="am-dash-dry-lead">
                  <div className="am-dash-dry-job">{r.job}</div>
                  <div className="am-dash-dry-loc">{r.loc}</div>
                </div>
                <span className="am-dash-bar-track">
                  <span className={`am-dash-bar-fill am-dash-bar-fill--${r.status}`} style={{ width: `${Math.min(r.pct, 100)}%` }} />
                </span>
                <div className="am-dash-dry-trail">
                  <span className="am-dash-dry-pct">{r.pct}%</span>
                  {r.badge && <span className={`am-dash-chip am-dash-chip--${r.status}`}>{r.badge}</span>}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </DashCard>
  );
}

// ─── SECTION: Action required ──────────────
export function ActionRequiredCard() {
  const loader = useCallback((db) => db.rpc('get_dashboard_action_items', { p_limit: 8 }).then(shapeActionItems), []);
  const { data, loading, error, reload } = useDashWidget(loader);
  return (
    <DashCard
      title="Action required"
      suffix="· by urgency"
      loading={loading}
      error={error}
      onRetry={reload}
      footer={data && data.items.length > 0 ? <span className="am-dash-foot-sum">{data.summary}</span> : null}
    >
      {data && (
        data.items.length === 0 ? (
          <DashEmpty>Nothing needs attention right now.</DashEmpty>
        ) : (
          <div className="am-dash-list am-dash-list--scroll">
            {data.items.map((a, i) => (
              <div key={`${a.job}-${i}`} className="am-dash-action-row">
                <span className={`am-dash-glyph am-dash-glyph--${a.kind}`} aria-hidden="true">{a.glyph}</span>
                <div className="am-dash-action-txt">
                  <div className="am-dash-action-who">
                    {a.client || a.job}
                    {a.client && a.job && <span className="am-dash-action-job"> · {a.job}</span>}
                  </div>
                  <div className="am-dash-action-need">{a.text}</div>
                  {(a.address || a.sub) && (
                    <div className="am-dash-action-sub" title={a.address || undefined}>
                      {a.address}{a.address && a.sub ? ' · ' : ''}{a.sub}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </DashCard>
  );
}

// ─── SECTION: Employee status (live clock-in board) ──────────────
const DOT_KIND = { success: 'success', gray: 'gray', danger: 'danger' };

export function EmployeeStatusCard() {
  const loader = useCallback((db) => db.rpc('get_tech_status_board').then((rows) => shapeEmployeeStatus(rows)), []);
  const { data, loading, error, reload } = useDashWidget(loader);
  return (
    <DashCard
      title="Employee status"
      live
      suffix="· clock-in board"
      loading={loading}
      error={error}
      onRetry={reload}
      footer={data ? (
        <div className="am-dash-foot-split">
          <span>{data.summary.left}</span>
          {data.summary.warn && <span className="am-dash-foot-warn">{data.summary.warn}</span>}
        </div>
      ) : null}
    >
      {data && (
        data.rows.length === 0 ? (
          <DashEmpty>No employees on the board.</DashEmpty>
        ) : (
          <div className="am-dash-list am-dash-list--scroll">
            {data.rows.map((e) => (
              <div key={e.name} className={`am-dash-emp-row${e.escal ? ' am-dash-emp-row--escal' : ''}`}>
                <span className={`am-dash-empdot am-dash-empdot--${DOT_KIND[e.dot] || 'gray'}`} aria-hidden="true" />
                <div className="am-dash-emp-txt">
                  <div className="am-dash-emp-name">{e.name}</div>
                  {e.client ? (
                    <div className="am-dash-emp-client">{e.client}</div>
                  ) : (
                    <div className="am-dash-emp-detail">{e.detail}</div>
                  )}
                  {(e.job || e.address) && (
                    <div className="am-dash-emp-loc" title={e.address || undefined}>
                      {e.job}{e.job && e.address ? ' · ' : ''}{e.address}
                    </div>
                  )}
                </div>
                <div className="am-dash-emp-trail">
                  <span className={`am-dash-emp-elapsed am-dash-emp-elapsed--${e.statusKind}`}>{e.elapsed}</span>
                  <span className={`am-dash-emp-status am-dash-emp-status--${e.statusKind}`}>{e.status}</span>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </DashCard>
  );
}

// ─── SECTION: Production pipeline ──────────────
export function PipelineCard() {
  const loader = useCallback((db) => db.rpc('get_pipeline_summary').then(shapePipeline), []);
  const { data, loading, error, reload } = useDashWidget(loader);
  return (
    <DashCard title="Production pipeline" suffix="· jobs by stage" loading={loading} error={error} onRetry={reload}>
      {data && (
        data.active.length === 0 ? (
          <DashEmpty>No jobs in production right now.</DashEmpty>
        ) : (
          <div className="am-dash-pipeline">
            {data.active.map((st) => (
              <div key={st.label} className="am-dash-pipe-row">
                <span className="am-dash-pipe-label">{st.label}</span>
                <span className="am-dash-pipe-track">
                  <span className={`am-dash-pipe-fill am-dash-pipe-fill--${st.kind}`} style={{ width: `${st.pct}%` }} />
                </span>
                <span className="am-dash-pipe-count">{st.count}</span>
              </div>
            ))}
          </div>
        )
      )}
    </DashCard>
  );
}
