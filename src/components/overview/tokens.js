/**
 * ════════════════════════════════════════════════
 * FILE: tokens.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Holds the colors and the fake "placeholder" numbers for the new owner
 *   Overview dashboard (the home screen). The dashboard shows things like
 *   revenue, jobs drying out, who's clocked in, etc. Right now every number
 *   here is made up — realistic but not real — so we can see the design before
 *   hooking it to the real database. When we wire live data, each chunk below
 *   gets replaced by a function that reads from Supabase.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (data/colors module)
 *   Rendered by:  src/components/overview/Widgets.jsx + src/pages/Dashboard.jsx
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → none yet (placeholders). At integration these map to:
 *                       jobs + QBO (revenue/avg ticket), estimates,
 *                       mitigation/equipment (drying), Collections query (DSO),
 *                       get_tech_status_board (employee status), production stages.
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This palette is INTENTIONALLY dashboard-scoped and differs from the
 *     app-wide DIVISION_COLORS / design tokens. Do not import these into other
 *     pages — the app-wide rollout (incl. the new "Remodeling" division) is a
 *     separate, future decision.
 *   - Keep mock data internally consistent: drying rows, action items, employee
 *     jobs and pipeline counts all reference the same job numbers (#2241 …).
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Palette (dashboard-scoped) ──────────────
// Neutral / chrome colors from the design handoff token table.
export const C = {
  pageBg:     '#f4f5f7',
  cardBg:     '#ffffff',
  cardBorder: '#e7e9ee',
  hairline:   '#f0f1f4',
  track:      '#eef0f3',
  rowHover:   '#f8f9fb',
  ink:        '#101828', // primary text / metrics
  title:      '#344054', // card titles
  body:       '#475467', // body labels
  muted:      '#667085', // secondary text
  faint:      '#98a2b3', // captions / sublabels
  faint2:     '#c2c7d0', // chevrons / off dot
  handle:     '#cbd0d9', // drag handle glyph
};

// Division encoding — used everywhere a division/job-type appears.
export const DIV = {
  mitigation:     '#0e9384', // teal (water)
  reconstruction: '#8a5cf6', // purple
  remodeling:     '#f2664a', // coral
  mold:           '#ec4899', // pink
};

// Status encoding — solid (bars/dots), text (text-on-tint), tint (badge bg).
export const STATUS = {
  info:    { solid: '#2f6bf2', text: '#2f6bf2', tint: '#eef2fb' },
  success: { solid: '#1f9d55', text: '#1f8a4c', tint: '#e9f7ef' },
  warning: { solid: '#e8920c', text: '#b76e00', tint: '#fdf3e3' },
  danger:  { solid: '#df3b34', text: '#c0322c', tint: '#fdecea' },
  escalRow: '#fef3f2',
};

// Header legend + the order divisions are shown.
export const DIVISIONS = [
  { key: 'mitigation',     label: 'Mitigation',     color: DIV.mitigation },
  { key: 'reconstruction', label: 'Reconstruction', color: DIV.reconstruction },
  { key: 'remodeling',     label: 'Remodeling',     color: DIV.remodeling },
  { key: 'mold',           label: 'Mold',           color: DIV.mold },
];

export const PERIODS = ['MTD', 'Last 30', 'QTD', 'YTD'];

// ─── SECTION: Placeholder data (swap each block for a live hook at integration) ──────────────
export const PLACEHOLDER = {
  revenue: {
    total: '$87,400',
    delta: { dir: 'down', pct: 12 },
    segments: [
      { key: 'mitigation',     label: 'Mitigation',     value: '$41.2K', pct: 47.1, color: DIV.mitigation },
      { key: 'reconstruction', label: 'Reconstruction', value: '$28.6K', pct: 32.7, color: DIV.reconstruction },
      { key: 'remodeling',     label: 'Remodeling',     value: '$9.4K',  pct: 10.7, color: DIV.remodeling },
      { key: 'mold',           label: 'Mold',           value: '$8.2K',  pct: 9.5,  color: DIV.mold },
    ],
  },

  avgTicket: {
    bars: [
      { label: 'Mitigation',     value: '$6.2K',  pct: 41.6, color: DIV.mitigation },
      { label: 'Reconstruction', value: '$11.4K', pct: 76.5, color: DIV.reconstruction },
      { label: 'Mold',           value: '$4.8K',  pct: 32.2, color: DIV.mold },
      { label: 'Remodeling',     value: '$14.9K', pct: 100,  color: DIV.remodeling },
    ],
    avgClaim: '$18.3K',
  },

  estimates: {
    total: 18,
    totalValue: '$164,000',
    slices: [
      { key: 'water',   label: 'Water',   sub: 'mitigation',     count: 7, value: '$42K', color: DIV.mitigation,     from: 0,     to: 38.89 },
      { key: 'mold',    label: 'Mold',    sub: 'remediation',    count: 3, value: '$12K', color: DIV.mold,           from: 38.89, to: 55.56 },
      { key: 'recon',   label: 'Recon',   sub: 'reconstruction', count: 4, value: '$58K', color: DIV.reconstruction, from: 55.56, to: 77.78 },
      { key: 'remodel', label: 'Remodel', sub: 'homeowner-pay',  count: 4, value: '$52K', color: DIV.remodeling,     from: 77.78, to: 100 },
    ],
  },

  newClaims: {
    count: 14,
    projected: '$108K projected',
    delta: { dir: 'up', pct: 18 },
    // sparkline SVG point strings (viewBox 0 0 240 58)
    line: '0,48 30,42 60,45 90,31 120,35 150,22 180,26 210,12 234,7',
    area: '0,48 30,42 60,45 90,31 120,35 150,22 180,26 210,12 234,7 234,58 0,58',
  },

  jobsCompleted: { count: 9, lastMonth: 7 },

  drying: {
    rows: [
      { job: '#2237', loc: 'Orem · Day 4',         pct: 100, status: 'success', badge: '✓ PULL EQUIP' },
      { job: '#2219', loc: 'Provo · Day 6',        pct: 88,  status: 'info' },
      { job: '#2228', loc: 'Spanish Fork · Day 5', pct: 92,  status: 'info' },
      { job: '#2241', loc: 'Provo · Day 3',        pct: 78,  status: 'warning', badge: '⚠ LOG MISSING' },
      { job: '#2233', loc: 'Lehi · Day 2',         pct: 61,  status: 'info' },
      { job: '#2224', loc: 'Orem · Day 1',         pct: 34,  status: 'info' },
    ],
    summary: '6 active · 2 ready to pull',
    warn: '⚠ 1 log overdue',
  },

  collections: {
    // px = bar pixel height in the 120px-tall plot (proportional, from handoff)
    bars: [
      { label: 'Past due', value: '$31.2K', px: 92, kind: 'danger' },
      { label: 'Due',      value: '$24.1K', px: 71, kind: 'warning' },
      { label: 'Unsent',   value: '$3.0K',  px: 13, kind: 'gray' },
    ],
    dso: 52,
  },

  actions: [
    { job: '#2241', glyph: '!', kind: 'warning', text: 'moisture log missing 2 days',          sub: 'IICRC S500 compliance' },
    { job: '#2237', glyph: '✓', kind: 'success', text: 'drying goal met → pull equipment',      sub: '100% to dry standard' },
    { job: '#2230', glyph: '!', kind: 'warning', text: 'estimate 4 days overdue to adjuster',   sub: 'Pending submission' },
    { job: '#2225', glyph: '↑', kind: 'danger',  text: 'supplement pending adjuster 9 days',    sub: 'Escalation · aging', escal: true, meta: '$6,800' },
    { job: '#2219', glyph: '✎', kind: 'info',    text: 'Certificate of Completion unsigned',    sub: 'Awaiting homeowner signature' },
  ],
  actionSummary: '5 open tasks',

  employees: [
    { name: 'Matheus', dot: 'success', job: '#2241', detail: 'Provo · since 8:02a', elapsed: '2h 14m', status: 'Clocked in',     statusKind: 'success' },
    { name: 'Nano',    dot: 'success', job: '#2237', detail: 'Orem · since 9:05a',  elapsed: '1h 11m', status: 'Clocked in',     statusKind: 'success' },
    { name: 'Juani',   dot: 'gray',                  detail: 'Not on a job',        elapsed: '—',      status: 'Not clocked in', statusKind: 'muted' },
    { name: 'Ben',     dot: 'danger',  job: '#2228', detailWarn: '⚠ likely forgot to clock out', elapsed: '11h 40m', status: 'Check clock-out', statusKind: 'danger', escal: true },
  ],
  employeeSummary: { left: '3 clocked in · 1 off', warn: '⚠ 1 missed clock-out' },

  pipeline: {
    active: [
      { label: 'New / FNOL',      count: 4, pct: 44.4, kind: 'info' },
      { label: 'Mitigation',      count: 6, pct: 66.7, kind: 'info' },
      { label: 'Drying complete', count: 3, pct: 33.3, kind: 'info' },
      { label: 'Invoiced',        count: 7, pct: 77.8, kind: 'info' },
      { label: 'Paid',            count: 9, pct: 100,  kind: 'success' },
    ],
    future: [
      { label: 'Contents',       note: 'Activates later' },
      { label: 'Reconstruction', note: 'Runs in HousecallPro today' },
      { label: 'Remodeling',     note: 'New division' },
    ],
  },
};
