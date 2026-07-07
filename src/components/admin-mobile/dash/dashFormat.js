/**
 * ════════════════════════════════════════════════
 * FILE: dashFormat.js  (admin-mobile Dashboard — pure math + data shapers)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The number-crunching brain behind the mobile admin dashboard. It turns the
 *   raw rows the database returns (revenue by division, payments, average ticket,
 *   open estimates, accounts-receivable, jobs closed, and so on) into the tidy
 *   little pieces each dashboard card shows — a headline dollar figure, an up/down
 *   change note, the coloured bar segments, the donut slices, the trend line. It
 *   also turns a chosen time window ("this month", "last 30 days", "this quarter",
 *   "this year") into the start/end dates the money RPCs expect. It touches no
 *   database and draws nothing itself — it only shapes data, so it is easy to test.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a plain helper module)
 *   Rendered by:  n/a — imported by the admin-mobile Dashboard card components
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/lib/clockTime (liveClockMinutes — the same live-timer math the
 *              desktop clock board uses)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - The period date-math, the dollar formatters, the delta rule, the division
 *     palette, the donut/sparkline builders and the A/R bucketing are MIRRORED
 *     from the desktop single source of truth (src/components/overview/hooks/
 *     dashUtils.js + the widget hooks + Widgets.jsx) rather than imported: that
 *     tree is frozen for this wave ("read to mirror logic, never import
 *     page-scoped internals"). The tests pin these to the same numbers so the
 *     mobile dashboard can never silently drift from the desktop Overview.
 *   - The division colours are data-viz encoding (the desktop tokens.js DIV
 *     palette), not app chrome — there is no CSS token for them, so they live
 *     here as constants and are applied as inline chart-fill styles, exactly as
 *     the desktop Widgets.jsx does.
 *   - 'Last 30' mirrors the desktop dashUtils window (29 days back → today
 *     inclusive), so the mobile revenue/payments/avg-ticket numbers match the
 *     office Overview to the dollar.
 * ════════════════════════════════════════════════
 */
import { liveClockMinutes } from '@/lib/clockTime';

// ─── SECTION: Division palette (mirror of desktop tokens.js DIV) ──────────────
// Data-viz encoding for the revenue / payments / avg-ticket splits. Same order
// and hues as the office Overview so a colour means the same division everywhere.
export const DIVISIONS = [
  { key: 'mitigation',     label: 'Mitigation',     color: '#0e9384' },
  { key: 'reconstruction', label: 'Reconstruction', color: '#8a5cf6' },
  { key: 'remodeling',     label: 'Remodeling',     color: '#f2664a' },
  { key: 'mold',           label: 'Mold',           color: '#ec4899' },
  { key: 'contents',       label: 'Contents',       color: '#f59e0b' },
];

// ─── SECTION: Formatters (mirror of dashUtils fmtK / fmtFull) ──────────────
export function fmtK(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}
export function fmtFull(n) {
  return `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
}

// ─── SECTION: Period windows (mirror of dashUtils.periodBounds) ──────────────
// The four admin-mobile periods (Foundation's ADMIN_PERIODS) → 'YYYY-MM-DD' bounds
// for the period-scoped money RPCs. No 'Prev mo' / 'All' — a mobile simplification.
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function periodBoundsISO(period) {
  const now = new Date();
  let start;
  if (period === 'qtd') start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  else if (period === 'ytd') start = new Date(now.getFullYear(), 0, 1);
  else if (period === 'last30') { start = new Date(now); start.setDate(start.getDate() - 29); }
  else start = new Date(now.getFullYear(), now.getMonth(), 1); // mtd (default)
  return { p_start: toISO(start), p_end: toISO(now) };
}
export const PERIOD_LABEL = { mtd: 'this month', last30: 'last 30 days', qtd: 'this quarter', ytd: 'this year' };
export const periodLabel = (p) => PERIOD_LABEL[p] || '';

// ─── SECTION: Delta rule (mirror of the widget hooks) ──────────────
// vs prior period. Null when there is no prior-period basis (the pill hides).
export function computeDelta(total, prev) {
  if (!(Number(prev) > 0)) return null;
  const pct = Math.round(((Number(total) - Number(prev)) / Number(prev)) * 100);
  return { dir: pct >= 0 ? 'up' : 'down', pct: Math.abs(pct) };
}

// ─── SECTION: Revenue / Payments shaper (mirror of useRevenue / usePaymentsReceived) ──────────────
// Both cards share this shape: headline total, vs-prior delta, and a per-division
// stacked bar + legend. Zero-value divisions drop out of the legend (mobile clutter).
export function shapeMoneySplit(r) {
  const total = Number(r?.total) || 0;
  const prev = Number(r?.prev_total) || 0;
  const byKey = Object.fromEntries((r?.segments || []).map((s) => [s.key, Number(s.value) || 0]));
  const segments = DIVISIONS.map((d) => {
    const value = byKey[d.key] || 0;
    return { key: d.key, label: d.label, color: d.color, value, valueLabel: fmtK(value), pct: total > 0 ? (value / total) * 100 : 0 };
  });
  return { total, totalLabel: fmtFull(total), delta: computeDelta(total, prev), segments, legend: segments.filter((s) => s.value > 0) };
}

// ─── SECTION: Avg ticket shaper (mirror of useAvgTicket) ──────────────
export function shapeAvgTicket(r) {
  const byKey = Object.fromEntries((r?.divisions || []).map((s) => [s.key, Number(s.avg) || 0]));
  const max = Math.max(...DIVISIONS.map((d) => byKey[d.key] || 0), 1);
  const bars = DIVISIONS.map((d) => {
    const avg = byKey[d.key] || 0;
    return { key: d.key, label: d.label, color: d.color, value: avg, valueLabel: fmtK(avg), pct: max > 0 ? (avg / max) * 100 : 0 };
  });
  return { bars, avgClaim: fmtK(Number(r?.avg_per_claim) || 0), hasData: bars.some((b) => b.value > 0) };
}

// ─── SECTION: Open estimates donut (mirror of useOpenEstimates) ──────────────
const EST_META = {
  mitigation:     { label: 'Mitigation',     sub: 'water / fire / contents', color: '#0e9384' },
  reconstruction: { label: 'Reconstruction', sub: 'reconstruction',          color: '#8a5cf6' },
  mold:           { label: 'Mold',           sub: 'remediation',             color: '#ec4899' },
  remodeling:     { label: 'Remodel',        sub: 'homeowner-pay',           color: '#f2664a' },
};
const EST_ORDER = ['mitigation', 'mold', 'reconstruction', 'remodeling'];
export function shapeOpenEstimates(r) {
  const total = Number(r?.total_count) || 0;
  const byKey = Object.fromEntries((r?.segments || []).map((s) => [s.key, s]));
  let acc = 0;
  const slices = [];
  for (const key of EST_ORDER) {
    const seg = byKey[key];
    const count = Number(seg?.count) || 0;
    if (count <= 0) continue;
    const frac = total > 0 ? (count / total) * 100 : 0;
    const m = EST_META[key];
    slices.push({ key, label: m.label, sub: m.sub, count, valueLabel: fmtK(Number(seg.value) || 0), color: m.color, from: acc, to: acc + frac });
    acc += frac;
  }
  return { total, totalValue: fmtFull(Number(r?.total_value) || 0), slices };
}
// CSS conic-gradient string for the donut (or null when there's nothing open).
export function donutGradient(slices) {
  if (!slices || slices.length === 0) return null;
  return `conic-gradient(${slices.map((s) => `${s.color} ${s.from}% ${s.to}%`).join(', ')})`;
}

// ─── SECTION: Collections / A/R buckets (mirror of useCollections) ──────────────
const DAY = 86400000;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
export function shapeCollections(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const today = startOfDay(Date.now());
  let pastDue = 0, due = 0, unsent = 0, ageSum = 0, ageCount = 0;
  for (const r of list) {
    const bal = Number(r.balance) || 0;
    if (bal <= 0) continue;
    const sent = !!r.sent_at || !!r.qbo_invoice_id;
    const isDraft = r.status === 'draft' || !sent;
    if (isDraft) {
      unsent += bal;
    } else {
      const dueTs = r.due_date ? startOfDay(`${r.due_date}T00:00:00`) : null;
      if (dueTs != null && dueTs < today) pastDue += bal; else due += bal;
    }
    if (r.invoice_date) { ageSum += Math.max(0, (today - startOfDay(`${r.invoice_date}T00:00:00`)) / DAY); ageCount += 1; }
  }
  const bars = [
    { key: 'pastDue', label: 'Past due', value: pastDue, valueLabel: fmtK(pastDue), kind: 'danger' },
    { key: 'due',     label: 'Due',      value: due,     valueLabel: fmtK(due),     kind: 'warning' },
    { key: 'unsent',  label: 'Unsent',   value: unsent,  valueLabel: fmtK(unsent),  kind: 'gray' },
  ];
  return { bars, dso: ageCount > 0 ? Math.round(ageSum / ageCount) : 0 };
}

// ─── SECTION: Jobs closed — period count, delta, sparkline (mirror of useJobsClosed) ──────────────
const SPARK_DAYS = 30;
const VB_W = 234; // sparkline drawable width (viewBox 0 0 240 58)
function jobsClosedRange(period, now) {
  const d = new Date(now);
  if (period === 'qtd') return { startTs: new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime(), endTs: now };
  if (period === 'ytd') return { startTs: new Date(d.getFullYear(), 0, 1).getTime(), endTs: now };
  if (period === 'last30') return { startTs: now - 30 * DAY, endTs: now };
  return { startTs: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), endTs: now }; // mtd
}
function buildSparkline(times, now) {
  const counts = new Array(SPARK_DAYS).fill(0);
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const startTs = start.getTime() - (SPARK_DAYS - 1) * DAY;
  for (const t of times) {
    const idx = Math.floor((t - startTs) / DAY);
    if (idx >= 0 && idx < SPARK_DAYS) counts[idx] += 1;
  }
  const max = Math.max(...counts, 1);
  const pts = counts.map((c, i) => {
    const x = +((i / (SPARK_DAYS - 1)) * VB_W).toFixed(1);
    const y = +(50 - (c / max) * 43).toFixed(1);
    return `${x},${y}`;
  });
  const line = pts.join(' ');
  return { line, area: `${line} ${VB_W},58 0,58` };
}
export function jobsClosedFloorISO(now = Date.now()) {
  return new Date(now - 400 * DAY).toISOString().slice(0, 10);
}
export function shapeJobsClosed(rows, period, now = Date.now()) {
  const times = (Array.isArray(rows) ? rows : [])
    .map((r) => r.sale_date && new Date(r.sale_date).getTime())
    .filter(Boolean);
  const { startTs, endTs } = jobsClosedRange(period, now);
  const count = times.filter((t) => t >= startTs && t < endTs).length;
  const last30 = times.filter((t) => t >= now - 30 * DAY).length;
  const prior30 = times.filter((t) => t >= now - 60 * DAY && t < now - 30 * DAY).length;
  let delta = null;
  if (prior30 > 0) {
    const pct = Math.round(((last30 - prior30) / prior30) * 100);
    delta = { dir: pct >= 0 ? 'up' : 'down', pct: Math.abs(pct) };
  } else if (last30 > 0) {
    delta = { dir: 'up', pct: 100 };
  }
  return { count, delta, ...buildSparkline(times, now) };
}

// ─── SECTION: Active drying (mirror of useActiveDrying) ──────────────
export function shapeActiveDrying(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const rows = list.map((r) => {
    const pct = Number(r.pct) || 0;
    const stale = r.hours_since_reading != null && r.hours_since_reading > 24;
    let status = 'info', badge;
    if (pct >= 100) { status = 'success'; badge = '✓ PULL EQUIP'; }
    else if (stale) { status = 'warning'; badge = '⚠ LOG MISSING'; }
    const loc = [r.city, r.day != null ? `Day ${r.day}` : null].filter(Boolean).join(' · ');
    return { jobId: r.job_id || null, job: r.job || '—', loc, pct, status, badge };
  });
  const ready = rows.filter((r) => r.pct >= 100).length;
  const overdue = rows.filter((r) => r.status === 'warning').length;
  return {
    rows,
    summary: `${rows.length} active · ${ready} ready to pull`,
    warn: overdue > 0 ? `⚠ ${overdue} log${overdue > 1 ? 's' : ''} overdue` : '',
  };
}

// ─── SECTION: Action required (mirror of useActionItems) ──────────────
const GLYPH = { esign: '✎', warning: '!', success: '✓', danger: '↑' };
const KIND_TINT = { esign: 'info', warning: 'warning', success: 'success', danger: 'danger' };
export function shapeActionItems(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const items = list.map((a) => ({
    jobId: a.job_id || null,
    job: a.job || '—',
    client: a.client || '',
    address: a.address || '',
    glyph: GLYPH[a.kind] || '!',
    kind: KIND_TINT[a.kind] || 'warning',
    text: a.text,
    sub: a.sub,
  }));
  return { items, summary: `${items.length} open task${items.length === 1 ? '' : 's'}` };
}

// ─── SECTION: Employee status board (mirror of useEmployeeStatus) ──────────────
const ACTIVE = new Set(['on_site', 'omw', 'paused']);
const FORGOT_CLOCKOUT_MIN = 10 * 60; // ≥10h on the clock ⇒ probably forgot to clock out
function fmtElapsed(min) {
  if (min == null || min < 0) return '—';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${m}m`;
  return `${m}m`;
}
function mapEmployeeRow(r, now) {
  const name = (r.full_name || '').trim() || '—';
  if (!ACTIVE.has(r.status)) {
    return { name, dot: 'gray', client: '', job: '', address: '', detail: 'Not on a job', elapsed: '—', status: 'Not clocked in', statusKind: 'muted', _sort: 1 };
  }
  const elapsedMin = liveClockMinutes(r, now).total;
  const base = {
    name,
    client: r.client_name || '', job: r.job_number || '', address: r.address || '',
    elapsed: fmtElapsed(elapsedMin),
  };
  if (elapsedMin != null && elapsedMin >= FORGOT_CLOCKOUT_MIN) {
    return { ...base, dot: 'danger', status: 'Check clock-out', statusKind: 'danger', escal: true, _sort: 0 };
  }
  return { ...base, dot: 'success', status: 'Clocked in', statusKind: 'success', _sort: 0 };
}
export function shapeEmployeeStatus(rows, now = Date.now()) {
  const list = Array.isArray(rows) ? rows : [];
  const mapped = list
    .map((r) => mapEmployeeRow(r, now))
    .sort((a, b) => a._sort - b._sort || a.name.localeCompare(b.name));
  const clockedIn = list.filter((r) => ACTIVE.has(r.status)).length;
  const missed = mapped.filter((x) => x.escal).length;
  return {
    rows: mapped,
    summary: {
      left: `${clockedIn} clocked in · ${list.length - clockedIn} off`,
      warn: missed > 0 ? `⚠ ${missed} missed clock-out` : '',
    },
  };
}

// ─── SECTION: Production pipeline (mirror of usePipeline — active stages only) ──────────────
export function shapePipeline(r) {
  const stages = Array.isArray(r?.stages) ? r.stages : [];
  const max = Math.max(...stages.map((s) => Number(s.count) || 0), 1);
  const active = stages.map((s) => {
    const count = Number(s.count) || 0;
    return { label: s.label, count, pct: max > 0 ? (count / max) * 100 : 0, kind: s.label === 'Paid' ? 'success' : 'info' };
  });
  return { active };
}
