/**
 * ════════════════════════════════════════════════
 * FILE: Widgets.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The ten boxes that make up the new owner Overview dashboard — revenue,
 *   average ticket, open estimates, new claims, jobs completed, active drying,
 *   collections, action-required list, the live employee clock-in board, and
 *   the production pipeline. Each one draws its own little chart or list. Right
 *   now they all read made-up numbers from tokens.js; every widget already
 *   accepts a `data` prop, so when we connect the real database later we just
 *   feed real numbers in and nothing else changes.
 *
 * WHERE IT LIVES:
 *   Route:        / (Overview dashboard)
 *   Rendered by:  src/pages/Dashboard.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./Card (Card shell + DeltaPill + footer pieces), ./tokens
 *   Data:      reads → none yet (placeholder props). Live sources noted per
 *                      widget + in tokens.js. · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Charts are pure CSS/SVG (stacked div widths, conic-gradient donut, inline
 *     <svg> sparkline) — no chart library, matching the design handoff.
 *   - Colors come from the dashboard-scoped palette in tokens.js, NOT the
 *     app-wide DIVISION_COLORS. Keep it that way until the app-wide rollout.
 *   - Metrics use font-variant-numeric: tabular-nums so digits don't jitter.
 * ════════════════════════════════════════════════
 */

import { C, DIV, STATUS, PLACEHOLDER } from './tokens';
import { Card, DeltaPill, CardFooter, FootLink, FootSummary } from './Card';

const mono = { fontFamily: 'var(--font-mono)' };
const tnum = { fontVariantNumeric: 'tabular-nums' };

// ─── SECTION: Row A — KPI tiles ──────────────

export function RevenueRecognized({ periodLabel, showHandle, data = PLACEHOLDER.revenue }) {
  return (
    <Card
      spanClass="ovw-span-4"
      title="Revenue recognized"
      suffix={periodLabel}
      showHandle={showHandle}
      right={data.delta ? <DeltaPill dir={data.delta.dir} pct={data.delta.pct} /> : null}
    >
      <div style={{ fontSize: 33, fontWeight: 800, color: C.ink, lineHeight: 1, letterSpacing: '-.02em', ...tnum }}>
        {data.total}
      </div>
      <div style={{ display: 'flex', width: '100%', height: 14, borderRadius: 6, overflow: 'hidden', background: C.track }}>
        {data.segments.map(s => (
          <div key={s.key} style={{ width: `${s.pct}%`, background: s.color }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px 14px', marginTop: 1 }}>
        {data.segments.map(s => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flex: 'none' }} />
            <span style={{ fontSize: 12.5, color: C.body, fontWeight: 500 }}>{s.label}</span>
            <span style={{ fontSize: 12.5, color: C.ink, fontWeight: 700, marginLeft: 'auto', ...tnum }}>{s.value}</span>
          </div>
        ))}
      </div>
      <CardFooter>
        <span style={{ fontSize: 11.5, color: C.faint, fontWeight: 500 }}>Insurance pays divisions separately</span>
        <FootLink to="/collections">View report →</FootLink>
      </CardFooter>
    </Card>
  );
}

export function AvgTicket({ periodLabel, showHandle, data = PLACEHOLDER.avgTicket }) {
  return (
    <Card spanClass="ovw-span-4" title="Avg ticket" suffix={periodLabel} showHandle={showHandle}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 1 }}>
        {data.bars.map(b => (
          <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 84, fontSize: 12, color: C.body, fontWeight: 500, flex: 'none' }}>{b.label}</span>
            <div style={{ flex: 1, height: 9, background: C.track, borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${b.pct}%`, height: '100%', background: b.color, borderRadius: 999 }} />
            </div>
            <span style={{ width: 48, textAlign: 'right', fontSize: 12.5, fontWeight: 700, color: C.ink, flex: 'none', ...tnum }}>{b.value}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f5f7fb', border: '1px solid #e9eef6', borderRadius: 10, padding: '10px 12px', marginTop: 'auto' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.title }}>
            Avg claim <span style={{ fontWeight: 500, color: C.faint }}>· all jobs / loss</span>
          </div>
          <div style={{ fontSize: 10.5, color: C.faint, marginTop: 1 }}>Miti + recon + mold combined — separate aggregate</div>
        </div>
        <span style={{ fontSize: 19, fontWeight: 800, color: C.ink, flex: 'none', ...tnum }}>{data.avgClaim}</span>
      </div>
    </Card>
  );
}

export function OpenEstimates({ showHandle, data = PLACEHOLDER.estimates }) {
  const hasData = data.slices.length > 0;
  const conic = hasData
    ? `conic-gradient(${data.slices.map(s => `${s.color} ${s.from}% ${s.to}%`).join(', ')})`
    : C.track;
  return (
    <Card spanClass="ovw-span-4" title="Open estimates" showHandle={showHandle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ position: 'relative', width: 128, height: 128, flex: 'none' }}>
          <div style={{ width: 128, height: 128, borderRadius: '50%', background: conic }} />
          <div style={{ position: 'absolute', inset: 22, background: '#fff', borderRadius: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 1px #f0f1f4' }}>
            <span style={{ fontSize: 27, fontWeight: 800, color: C.ink, lineHeight: 1, ...tnum }}>{data.total}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.faint, letterSpacing: '.08em', marginTop: 2 }}>OPEN</span>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0 }}>
          {hasData ? data.slices.map(s => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flex: 'none' }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: C.body, fontWeight: 600, lineHeight: 1.2 }}>{s.label} · {s.count}</div>
                <div style={{ fontSize: 11, color: C.faint }}>{s.sub}</div>
              </div>
              <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, color: C.ink, ...tnum }}>{s.value}</span>
            </div>
          )) : (
            <div style={{ fontSize: 12.5, color: C.faint, fontWeight: 500 }}>No open estimates right now</div>
          )}
        </div>
      </div>
      <CardFooter>
        <span style={{ fontSize: 12, color: C.body, fontWeight: 600 }}>
          {data.total} open · <span style={{ color: C.ink, fontWeight: 700, ...tnum }}>{data.totalValue}</span>
        </span>
        <FootLink to="/claims">View estimates →</FootLink>
      </CardFooter>
    </Card>
  );
}

// ─── SECTION: Row B — claims booked + jobs completed ──────────────

export function NewClaimsBooked({ periodLabel, showHandle, data = PLACEHOLDER.newClaims }) {
  return (
    <Card spanClass="ovw-span-6" title="New claims booked" suffix={periodLabel} showHandle={showHandle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <div style={{ flex: 'none' }}>
          <div style={{ fontSize: 36, fontWeight: 800, color: C.ink, lineHeight: 1, letterSpacing: '-.02em', ...tnum }}>{data.count}</div>
          {data.projected && <div style={{ fontSize: 12.5, color: C.body, fontWeight: 600, marginTop: 7 }}>{data.projected}</div>}
          <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>new claims this period</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
            <span style={{ fontSize: 11, color: C.faint, fontWeight: 500 }}>Trailing 30 days</span>
            {data.delta && <DeltaPill dir={data.delta.dir} pct={data.delta.pct} />}
          </div>
          <svg viewBox="0 0 240 58" preserveAspectRatio="none" style={{ width: '100%', height: 58, display: 'block' }}>
            <polygon points={data.area} fill="rgba(47,107,242,.09)" />
            <polyline points={data.line} fill="none" stroke="#2f6bf2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      </div>
    </Card>
  );
}

export function JobsCompleted({ periodLabel, showHandle, data = PLACEHOLDER.jobsCompleted }) {
  return (
    <Card spanClass="ovw-span-6" title="Jobs completed" suffix={periodLabel} showHandle={showHandle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <div style={{ flex: 'none' }}>
          <div style={{ fontSize: 36, fontWeight: 800, color: C.ink, lineHeight: 1, letterSpacing: '-.02em', ...tnum }}>{data.count}</div>
          <div style={{ fontSize: 12.5, color: C.body, fontWeight: 600, marginTop: 7 }}>jobs completed</div>
        </div>
        <div style={{ flex: 1, fontSize: 12.5, color: C.faint, lineHeight: 1.55, minWidth: 0 }}>
          Restoration jobs run days to weeks — a low monthly count is expected, not a problem.{' '}
          <span style={{ color: C.body, fontWeight: 600 }}>{data.lastMonth} completed last month.</span>
        </div>
      </div>
    </Card>
  );
}

// ─── SECTION: Row C — active drying (signature) + collections ──────────────

export function ActiveDrying({ showHandle, data = PLACEHOLDER.drying }) {
  return (
    <Card
      spanClass="ovw-span-7"
      title="Active drying"
      suffix="· % to dry standard"
      dotColor={DIV.mitigation}
      showHandle={showHandle}
      gap={6}
      headGap={6}
      right={<FootLink to="/production">View all</FootLink>}
    >
      {data.rows.length === 0 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 120, color: C.faint, fontSize: 13, fontWeight: 500 }}>
          No active drying jobs right now
        </div>
      )}
      {data.rows.map(r => {
        const s = STATUS[r.status] || STATUS.info;
        return (
          <div key={r.job} className="ovw-row">
            <div style={{ width: 120, flex: 'none', minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, letterSpacing: '-.02em', ...mono }}>{r.job}</div>
              <div style={{ fontSize: 11, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.loc}</div>
            </div>
            <div style={{ flex: 1, height: 9, background: C.track, borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${r.pct}%`, height: '100%', background: s.solid, borderRadius: 999 }} />
            </div>
            <div style={{ width: 98, flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: r.badge ? 3 : 0, justifyContent: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, ...tnum }}>{r.pct}%</span>
              {r.badge && (
                <span style={{ fontSize: 9, fontWeight: 700, color: s.text, background: s.tint, padding: '2px 6px', borderRadius: 999, letterSpacing: '.03em', whiteSpace: 'nowrap' }}>{r.badge}</span>
              )}
            </div>
          </div>
        );
      })}
      <CardFooter>
        <FootSummary>{data.summary}</FootSummary>
        <span style={{ fontSize: 12, color: STATUS.warning.text, fontWeight: 700 }}>{data.warn}</span>
      </CardFooter>
    </Card>
  );
}

const COLLECTION_BAR = {
  danger:  { fill: 'linear-gradient(180deg,#ef5a52,#df3b34)', value: '#df3b34', radius: '7px 7px 0 0' },
  warning: { fill: 'linear-gradient(180deg,#f0a92c,#e8920c)', value: '#b76e00', radius: '7px 7px 0 0' },
  gray:    { fill: '#c2c7d0',                                 value: '#667085', radius: '5px 5px 0 0' },
};

export function Collections({ showHandle, data = PLACEHOLDER.collections }) {
  const max = Math.max(...data.bars.map(b => b.amount ?? 0), 1);
  return (
    <Card spanClass="ovw-span-5" title="Collections" suffix="· My money" dotColor={STATUS.info.solid} showHandle={showHandle}>
      {/* plot grows (flex:1) to fill the card so a taller row-mate doesn't leave dead space */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 18, minHeight: 140, paddingTop: 4 }}>
        {data.bars.map(b => {
          const c = COLLECTION_BAR[b.kind] || COLLECTION_BAR.gray;
          const h = b.amount > 0 ? Math.max(4, (b.amount / max) * 80) : 0; // % of plot height; cap 80% leaves room for the value label
          return (
            <div key={b.label} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 7 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: c.value, ...tnum }}>{b.value}</span>
              <div style={{ width: '100%', maxWidth: 58, height: `${h}%`, background: c.fill, borderRadius: c.radius }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 18 }}>
        {data.bars.map(b => (
          <span key={b.label} style={{ flex: 1, textAlign: 'center', fontSize: 11.5, color: C.muted, fontWeight: 600 }}>{b.label}</span>
        ))}
      </div>
      <CardFooter>
        <span style={{ fontSize: 12.5, color: C.body }}>DSO <b style={{ color: C.ink, fontWeight: 800, ...tnum }}>{data.dso}</b> days</span>
        <FootLink to="/collections">View collections →</FootLink>
      </CardFooter>
    </Card>
  );
}

// ─── SECTION: Row D — action required + employee status (live) ──────────────

export function ActionRequired({ showHandle, data = PLACEHOLDER.actions, summary = PLACEHOLDER.actionSummary }) {
  return (
    <Card spanClass="ovw-span-6" title="Action required" suffix="· sorted by urgency" dotColor={STATUS.warning.solid} showHandle={showHandle} gap={5} headGap={6}>
      {data.map(a => {
        const s = STATUS[a.kind] || STATUS.info;
        return (
          <div key={a.job} className={`ovw-row ovw-row-action${a.escal ? ' ovw-escal' : ''}`} style={{ cursor: 'pointer' }}>
            <span style={{ width: 22, height: 22, borderRadius: 7, background: s.tint, color: s.text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: a.glyph === '✎' ? 12 : 13, fontWeight: 800, flex: 'none' }}>{a.glyph}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: C.title, fontWeight: 600 }}>
                <span style={{ color: C.ink, ...mono }}>{a.job}</span> — {a.text}
              </div>
              <div style={{ fontSize: 10.5, color: C.faint }}>{a.sub}</div>
            </div>
            {a.meta
              ? <span style={{ fontSize: 12.5, fontWeight: 800, color: STATUS.danger.text, flex: 'none', ...tnum }}>{a.meta}</span>
              : <span style={{ color: C.faint2, fontSize: 16, flex: 'none' }}>›</span>}
          </div>
        );
      })}
      <CardFooter>
        <FootSummary>{summary}</FootSummary>
        <FootLink to="/jobs">View all →</FootLink>
      </CardFooter>
    </Card>
  );
}

const DOT = { success: '#1f9d55', gray: '#c2c7d0', danger: '#df3b34' };

function LiveBadge() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#e9f7ef', color: '#1f8a4c', fontSize: 9, fontWeight: 800, letterSpacing: '.07em', padding: '3px 7px', borderRadius: 999 }}>
      <span className="ovw-live-dot" />LIVE
    </span>
  );
}

export function EmployeeStatus({ showHandle, data = PLACEHOLDER.employees, summary = PLACEHOLDER.employeeSummary }) {
  return (
    <Card
      spanClass="ovw-span-6"
      title={<>Employee status<LiveBadge /><span className="ovw-suffix">· clock-in board</span></>}
      showHandle={showHandle}
      gap={5}
      headGap={6}
    >
      {data.map(e => {
        const danger = e.statusKind === 'danger';
        const nameColor = e.dot === 'gray' ? C.muted : C.ink;
        const statusColor = e.statusKind === 'success' ? '#1f8a4c' : e.statusKind === 'danger' ? '#c0322c' : C.faint;
        const elapsedColor = danger ? '#c0322c' : e.dot === 'gray' ? C.faint2 : C.ink;
        return (
          <div key={e.name} className={`ovw-row${e.escal ? ' ovw-escal' : ''}`}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: DOT[e.dot], flex: 'none' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: nameColor }}>{e.name}</div>
              {e.detailWarn
                ? <div style={{ fontSize: 10.5, color: '#c0322c', fontWeight: 600 }}>{e.job && <span style={mono}>{e.job}</span>}{e.job ? ' · ' : ''}{e.detailWarn}</div>
                : <div style={{ fontSize: 10.5, color: C.faint }}>{e.job && <span style={mono}>{e.job}</span>}{e.job ? ' · ' : ''}{e.detail}</div>}
            </div>
            <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span style={{ fontSize: 13, fontWeight: danger ? 800 : 700, color: elapsedColor, ...tnum }}>{e.elapsed}</span>
              <span style={{ fontSize: 10, color: statusColor, fontWeight: danger ? 700 : 600 }}>{e.status}</span>
            </div>
          </div>
        );
      })}
      <CardFooter>
        <FootSummary>{summary.left}</FootSummary>
        <span style={{ fontSize: 12, color: '#c0322c', fontWeight: 700 }}>{summary.warn}</span>
      </CardFooter>
    </Card>
  );
}

// ─── SECTION: Row E — production pipeline (future-ready) ──────────────

export function ProductionPipeline({ showHandle, data = PLACEHOLDER.pipeline }) {
  return (
    <Card
      spanClass="ovw-span-12"
      title="Production pipeline"
      suffix="· jobs by stage"
      dotColor={DIV.reconstruction}
      showHandle={showHandle}
      wide
      gap={12}
      right={<span style={{ fontSize: 11, fontWeight: 600, color: C.muted, background: '#f3f4f6', borderRadius: 999, padding: '4px 11px' }}>Mitigation live · reconstruction &amp; remodel activate later</span>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {data.active.map(st => {
          const fill = st.kind === 'success' ? STATUS.success.solid : STATUS.info.solid;
          return (
            <div key={st.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 140, flex: 'none', fontSize: 12.5, color: C.body, fontWeight: 600 }}>{st.label}</span>
              <div style={{ flex: 1, height: 22, background: C.track, borderRadius: 7, overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${st.pct}%`, height: '100%', background: fill, borderRadius: 7, minWidth: 20 }} />
              </div>
              <span style={{ width: 26, textAlign: 'right', fontSize: 14, fontWeight: 800, color: C.ink, flex: 'none', ...tnum }}>{st.count}</span>
            </div>
          );
        })}
      </div>

      <div style={{ height: 1, background: C.hairline, margin: '2px 0' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, opacity: 0.62 }}>
        {data.future.map(f => (
          <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 140, flex: 'none', fontSize: 12.5, color: C.faint, fontWeight: 600 }}>{f.label}</span>
            <div style={{ flex: 1, height: 22, borderRadius: 7, border: '1.5px dashed #d6dae1', background: 'repeating-linear-gradient(45deg,#fafbfc,#fafbfc 6px,#f1f2f4 6px,#f1f2f4 12px)', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#aeb4be', fontWeight: 600, marginLeft: 11, letterSpacing: '.02em' }}>{f.note}</span>
            </div>
            <span style={{ width: 26, textAlign: 'right', fontSize: 14, fontWeight: 700, color: C.faint2, flex: 'none' }}>—</span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>Reconstruction &amp; remodeling pipeline activates when those divisions move into UPR.</div>
    </Card>
  );
}
