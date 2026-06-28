/**
 * ════════════════════════════════════════════════
 * FILE: HomebuildingAnalysis.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A single read-only report screen that lays out three ways Utah Pros could
 *   get into homebuilding (build for a client, build on spec, or develop land),
 *   what each one costs and risks, and an interactive "deal modeler" with sliders
 *   that estimates the profit and cash needed on a real lot. Nothing is saved —
 *   it's a planning/analysis page. It is private to the owner's account and only
 *   shows up in the side navigation for that one user.
 *
 * WHERE IT LIVES:
 *   Route:        /homebuilding  (Moroni-only — see App.jsx MoroniRoute guard)
 *   Rendered by:  src/App.jsx (inside the office Layout shell)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none
 *   Data:      reads  → none (all numbers are local component state / constants)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Ported from a standalone Vite app that used recharts + lucide-react +
 *     Tailwind. This project has none of those, so the chart is a hand-built
 *     SVG, the icons are inline SVG, and all layout is inline styles plus a
 *     scoped `<style>` block (classes prefixed `hba-`) for the responsive grids.
 *     Keep new layout in that scoped block — do NOT add Tailwind.
 *   - The page imports its own Google fonts (Archivo / IBM Plex) via the scoped
 *     <style>. Self-contained on purpose so it can't drift the global design.
 *   - All dollar figures are illustrative estimates, not live data.
 * ════════════════════════════════════════════════
 */
import { useState, useMemo } from 'react';

// ─── SECTION: palette (job-cost ledger identity) ───
const C = {
  paper: '#E8EAED',
  card: '#FFFFFF',
  ink: '#15202C',
  muted: '#5B6775',
  faint: '#8A95A1',
  steel: '#1E3A5C',
  amber: '#C2741C',
  up: '#2C7A5B',
  down: '#B14A30',
  line: '#D6DADF',
  lineSoft: '#E6E9ED',
};

const MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const DISP = "'Archivo', 'IBM Plex Sans', system-ui, sans-serif";

// ─── SECTION: format helpers ───
const fmt$ = (n) => (isFinite(n) ? '$' + Math.round(n).toLocaleString('en-US') : '—');
const fmt$k = (n) => (isFinite(n) ? '$' + Math.round(n / 1000).toLocaleString('en-US') + 'k' : '—');
const pct = (n) => (isFinite(n) ? (n * 100).toFixed(1) + '%' : '—');
const clampPct = (v, max) => Math.max(0, Math.min(100, (v / max) * 100));

// ─── SECTION: inline icons (lucide paths, no dependency) ───
function Svg({ size = 16, color = 'currentColor', children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
  );
}
const HardHat = (p) => <Svg {...p}><path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1z" /><path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5" /><path d="M4 15v-3a6 6 0 0 1 6-6" /><path d="M14 6a6 6 0 0 1 6 6v3" /></Svg>;
const Landmark = (p) => <Svg {...p}><line x1="3" x2="21" y1="22" y2="22" /><line x1="6" x2="6" y1="18" y2="11" /><line x1="10" x2="10" y1="18" y2="11" /><line x1="14" x2="14" y1="18" y2="11" /><line x1="18" x2="18" y1="18" y2="11" /><polygon points="12 2 20 7 4 7" /></Svg>;
const MapIcon = (p) => <Svg {...p}><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" /><line x1="9" x2="9" y1="3" y2="18" /><line x1="15" x2="15" y1="6" y2="21" /></Svg>;
const Banknote = (p) => <Svg {...p}><rect width="20" height="12" x="2" y="6" rx="2" /><circle cx="12" cy="12" r="2" /><path d="M6 12h.01M18 12h.01" /></Svg>;
const Users = (p) => <Svg {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Svg>;
const FileSignature = (p) => <Svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M9 17c1.5-1.5 3-1.5 3-3a1.5 1.5 0 0 0-3 0" /></Svg>;
const Building2 = (p) => <Svg {...p}><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" /><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" /><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" /><path d="M10 6h4M10 10h4M10 14h4M10 18h4" /></Svg>;
const ShieldCheck = (p) => <Svg {...p}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></Svg>;
const ScrollText = (p) => <Svg {...p}><path d="M15 12h-5M15 8h-5" /><path d="M19 17V5a2 2 0 0 0-2-2H4" /><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" /></Svg>;
const AlertTriangle = (p) => <Svg {...p}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z" /><line x1="12" x2="12" y1="9" y2="13" /><line x1="12" x2="12.01" y1="17" y2="17" /></Svg>;
const Check = (p) => <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>;

// ─── SECTION: small primitives ───
function Eyebrow({ sheet, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, fontFamily: MONO }}>
      <span style={{ padding: '4px 8px', borderRadius: 4, background: C.steel, color: '#fff', fontSize: 11, letterSpacing: 1 }}>
        {sheet}
      </span>
      <span style={{ color: C.muted, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase' }}>
        {children}
      </span>
      <span style={{ flex: 1, height: 1, background: C.line }} />
    </div>
  );
}

function Gauge({ label, value, color }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted, letterSpacing: 0.5 }}>{label}</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.ink }}>{value}/5</span>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} style={{ flex: 1, height: 6, borderRadius: 2, background: i <= value ? color : C.lineSoft }} />
        ))}
      </div>
    </div>
  );
}

// capital-exposure beam with the $100k stake marker
function ExposureBeam({ value, max, color, note }) {
  const stake = 100000;
  return (
    <div>
      <div style={{ position: 'relative', width: '100%', height: 12 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 9999, background: '#E2E5E9' }} />
        <div style={{ position: 'absolute', left: 0, top: 0, height: 12, width: clampPct(value, max) + '%', borderRadius: 9999, background: color, transition: 'width .3s ease' }} />
        <div style={{ position: 'absolute', top: -5, height: 22, width: 2, left: clampPct(stake, max) + '%', background: C.ink }} title="Your $100k stake" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontFamily: MONO, fontSize: 10, color: C.faint }}>
        <span>{note || 'capital at risk'}</span>
        <span style={{ color: C.ink }}>$100k stake ▲</span>
      </div>
    </div>
  );
}

// ─── SECTION: radar chart (hand-built SVG, replaces recharts) ───
function RadarChart({ data, series }) {
  const size = 340;
  const cx = size / 2;
  const cy = size / 2;
  const R = 118;
  const max = 5;
  const n = data.length;
  const angle = (i) => (-90 + (360 / n) * i) * (Math.PI / 180);
  const point = (i, v) => {
    const a = angle(i);
    const r = (v / max) * R;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const ringPath = (level) =>
    data.map((_, i) => point(i, level).join(',')).join(' ');
  const seriesPath = (key) =>
    data.map((d, i) => point(i, d[key]).join(',')).join(' ');

  return (
    <div>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', height: 'auto', maxHeight: 340, display: 'block', margin: '0 auto' }}>
        {/* grid rings */}
        {[1, 2, 3, 4, 5].map((lvl) => (
          <polygon key={lvl} points={ringPath(lvl)} fill="none" stroke={C.line} strokeWidth="1" />
        ))}
        {/* spokes + axis labels */}
        {data.map((d, i) => {
          const [ox, oy] = point(i, max);
          const [lx, ly] = point(i, max * 1.16);
          const anchor = Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end';
          return (
            <g key={i}>
              <line x1={cx} y1={cy} x2={ox} y2={oy} stroke={C.line} strokeWidth="1" />
              <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle"
                style={{ fontFamily: MONO, fontSize: 10.5, fill: C.muted }}>
                {d.axis}
              </text>
            </g>
          );
        })}
        {/* series */}
        {series.map((s) => (
          <polygon key={s.key} points={seriesPath(s.key)} fill={s.color} fillOpacity={s.opacity}
            stroke={s.color} strokeWidth="2" />
        ))}
      </svg>
      {/* legend */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 8, flexWrap: 'wrap' }}>
        {series.map((s) => (
          <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 12, color: C.muted }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── SECTION: path data ───
const PATHS = {
  custom: {
    key: 'custom',
    name: 'Custom / Contract',
    icon: HardHat,
    color: C.up,
    tag: 'Client owns the lot and carries the loan. You build for a fee.',
    how: "The client secures construction-to-perm financing. You're the licensed builder of record and get paid in draws as you hit milestones — almost none of your own capital is exposed.",
    gauges: [['Capital needed', 1], ['Risk to you', 1], ['Speed to revenue', 5], ['Fit for UPR now', 5]],
    up: [
      "Near-zero capital at risk — client's loan funds the build",
      'Paid as you build; draw schedule keeps cash flowing',
      "Plugs directly into UPR's subs, estimating, and PM systems",
      'Fastest path to revenue and a verifiable track record',
      'Insulated from market and interest-rate cycles',
    ],
    down: [
      'Lower ceiling per job — a fee, not the full margin',
      'Depends on client pipeline and their loan approval',
      "You don't capture land appreciation",
      'Margin compresses fast if you under-scope the bid',
    ],
    money: 'None of yours. The client\'s construction loan funds it — you just need the license, credentials, and references.',
    exposure: 8000,
  },
  spec: {
    key: 'spec',
    name: 'Spec Build',
    icon: Building2,
    color: C.amber,
    tag: 'You buy the land, build on spec, sell. Full upside, full risk.',
    how: 'You finance land + build, carry it monthly, and sell on completion. Every dollar of outcome — good or bad — is yours.',
    gauges: [['Capital needed', 4], ['Risk to you', 4], ['Speed to revenue', 2], ['Fit for UPR now', 3]],
    up: [
      'Full profit margin plus any land appreciation',
      'No client dependency — you control the project',
      'Builds real equity and a lender-facing balance sheet',
      'Terms improve as your completed-build count grows',
    ],
    down: [
      '20–30% down as a new builder + reserves — more than $100k on a typical lot',
      'Monthly carry until it sells; every idle month costs',
      'Cycle and rate risk sit entirely on you',
      'Capital locked 12–18 months; overruns hit you directly',
    ],
    money: 'Spec construction loan (≤80% LTC for a new builder) or hard money (≤90% LTC, higher cost). Land equity counts toward the down payment.',
    exposure: 149000,
  },
  dev: {
    key: 'dev',
    name: 'Development',
    icon: MapIcon,
    color: C.down,
    tag: 'Raw land → entitle → infrastructure → lots or builds. The big game.',
    how: 'Acquire raw or underused land, run entitlements, install roads and utilities, then sell finished lots or build vertically on them.',
    gauges: [['Capital needed', 5], ['Risk to you', 5], ['Speed to revenue', 1], ['Fit for UPR now', 1]],
    up: [
      'Largest absolute upside of the three',
      'You create value through entitlement, not just construction',
      'Sets up a repeatable pipeline of your own lots',
    ],
    down: [
      'Heavy capital and multi-year timelines',
      'Entitlement and approval risk before a dollar comes back',
      'Infrastructure spend up front with no revenue',
      'Not viable on $100k or without a track record',
    ],
    money: 'Land + development loans, equity syndication, or a JV with a capital partner. Not a starting move — park it as a 3–5 year goal.',
    exposure: 200000,
  },
};

const radarData = [
  { axis: 'Capital needed', Custom: 1, Spec: 4, Development: 5 },
  { axis: 'Risk to you', Custom: 1, Spec: 4, Development: 5 },
  { axis: 'Profit upside', Custom: 2, Spec: 4, Development: 5 },
  { axis: 'Speed to revenue', Custom: 5, Spec: 2, Development: 1 },
  { axis: 'Fit for UPR now', Custom: 5, Spec: 3, Development: 1 },
];
const radarSeries = [
  { key: 'Custom', label: 'Custom', color: C.up, opacity: 0.18 },
  { key: 'Spec', label: 'Spec', color: C.amber, opacity: 0.16 },
  { key: 'Development', label: 'Development', color: C.down, opacity: 0.14 },
];

// ─── SECTION: financing ladder ───
const LADDER = [
  { icon: Landmark, title: 'Client construction loan', use: 'Custom builds — lowest-risk entry.', cost: '$0 to you', body: "Not your capital. You're the builder of record; the client's loan funds the build." },
  { icon: Building2, title: 'Spec construction loan', use: 'Spec, once you can cover the down + reserves.', cost: '20–30% down', body: 'Bank or credit-union loan against the project. New builders cap around 80% LTC; land equity counts toward the down payment.' },
  { icon: Banknote, title: 'Hard / private money', use: "Spec when a bank won't clear you, or you need speed.", cost: 'Higher rate + points', body: 'Asset-based and fast — up to ~90% LTC including land. 12–24 month terms, interest-only on drawn funds.' },
  { icon: Users, title: 'Capital / equity partner', use: 'Smartest first spec structure with no track record.', cost: 'Shared upside', body: 'Your $100k + sweat + their cash, split the profit. Lets you do a real deal without overexposing your stake.' },
  { icon: FileSignature, title: 'Seller-financed land', use: 'Stretch your stake on the hardest line item.', cost: 'Negotiated', body: 'Defer the lot cost so cash stays free for the build. The money in homebuilding is made on the land buy.' },
];

// ─── SECTION: decisions ───
const DECISIONS = [
  { t: 'Partnership terms + operating agreement', d: 'Equity split, who has final say, capital each puts in, and the buy-sell. This kills more builders than the market does — settle it before the first dollar.' },
  { t: 'Entity structure', d: 'LLC for liability. For spec, a separate LLC per project to ring-fence each build is standard.' },
  { t: 'License path + qualifier', d: 'B100 or R100 — and the gating question: do you or Mike have the 2 years / 4,000 supervisory hours, or do you take the construction-management-degree route?' },
  { t: 'Insurance + bonding', d: "General liability, builder's risk per project, workers comp, and the $50k state surety bond." },
  { t: 'Product, geography + land sourcing', d: 'Price band, where you build, and how you find lots. Put your learning energy here — sourcing is the hardest skill.' },
];

// ─── SECTION: market presets ───
const REGIONS = {
  wasatch: {
    label: 'Wasatch Front',
    sub: 'Salt Lake · Utah County',
    cities: 'Salt Lake & Utah County metros',
    lot: 250000, build: 300000, soft: 45000, sale: 720000,
    blurb: 'A buildable Wasatch Front lot clears $150k+ before you pour a footing, and hard costs add $200k+ on top.',
  },
  southern: {
    label: 'Southern Utah',
    sub: 'St. George · Washington Co.',
    cities: 'St. George, Ivins, Santa Clara, Hurricane & Washington County',
    lot: 190000, build: 300000, soft: 45000, sale: 650000,
    blurb: 'A buildable Washington County lot still runs $150k+ — far more on a red-rock view lot in Ivins or Santa Clara — before you pour a footing, and hard costs add $200k+ on top.',
  },
};

// ─── SECTION: output row ───
function Row({ k, v, strong, big, sub, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ fontSize: sub ? 12 : 13, color: sub ? C.faint : C.muted }}>{k}</span>
      <span style={{
        fontFamily: MONO,
        fontSize: big ? 20 : strong ? 15 : 13,
        fontWeight: strong || big ? 600 : 500,
        color: color || C.ink,
      }}>{v}</span>
    </div>
  );
}

// ─── SECTION: decisions section (own state) ───
function Decisions() {
  const [done, setDone] = useState([]);
  const toggle = (i) => setDone((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]));
  const progress = Math.round((done.length / DECISIONS.length) * 100);

  return (
    <section style={{ marginTop: 32 }}>
      <Eyebrow sheet="SHT 06">What you and Mike must decide</Eyebrow>
      <div className="hba-pad-lg" style={{ borderRadius: 16, background: C.card, border: `1px solid ${C.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted }}>{done.length} of {DECISIONS.length} settled</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: 180 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 9999, background: C.lineSoft }}>
              <div style={{ height: 6, width: progress + '%', borderRadius: 9999, background: C.up, transition: 'width .3s ease' }} />
            </div>
            <span style={{ fontFamily: MONO, fontSize: 12, color: C.ink }}>{progress}%</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {DECISIONS.map((x, i) => {
            const on = done.includes(i);
            return (
              <button key={i} onClick={() => toggle(i)}
                style={{
                  width: '100%', textAlign: 'left', borderRadius: 12, padding: 16,
                  display: 'flex', gap: 12, cursor: 'pointer',
                  background: on ? '#EAF3EF' : C.paper,
                  border: `1px solid ${on ? C.up : C.line}`, transition: 'all .2s ease',
                }}>
                <span style={{
                  width: 22, height: 22, flexShrink: 0, marginTop: 1, borderRadius: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: on ? C.up : '#fff', border: `1px solid ${on ? C.up : C.line}`,
                }}>
                  {on && <Check size={14} color="#fff" />}
                </span>
                <div>
                  <div style={{ fontFamily: DISP, fontWeight: 700, fontSize: 15, color: C.ink, textDecoration: on ? 'line-through' : 'none', opacity: on ? 0.65 : 1 }}>{x.t}</div>
                  <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{x.d}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── SECTION: scoped responsive styles ───
const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
.hba * { box-sizing: border-box; }
.hba input[type=range]{ width:100%; accent-color:${C.amber}; cursor:pointer; }
.hba button:focus-visible, .hba input:focus-visible { outline: 2px solid ${C.amber}; outline-offset: 2px; }
.hba-wrap{ max-width:1080px; margin:0 auto; padding:24px 16px; }
.hba-meta{ display:grid; grid-template-columns:repeat(2,1fr); }
.hba-paths{ display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
.hba-detail-head{ display:flex; flex-direction:column; gap:12px; }
.hba-gauges{ width:100%; }
.hba-2col{ display:grid; grid-template-columns:1fr; gap:20px; }
.hba-assump{ display:grid; grid-template-columns:repeat(2,1fr); column-gap:24px; row-gap:16px; }
.hba-ladder{ display:grid; grid-template-columns:1fr; gap:12px; }
.hba-hide-sm{ display:none; }
.hba-pad-lg{ padding:24px; }
.hba-pad-md{ padding:20px; }
.hba-title-pad{ padding:20px; }
@media (min-width:768px){
  .hba-meta{ grid-template-columns:repeat(4,1fr); }
  .hba-paths{ gap:12px; }
  .hba-detail-head{ flex-direction:row; align-items:flex-start; justify-content:space-between; }
  .hba-gauges{ width:256px; flex-shrink:0; }
  .hba-2col{ grid-template-columns:1fr 1fr; }
  .hba-assump{ grid-template-columns:repeat(5,1fr); }
  .hba-ladder{ grid-template-columns:repeat(2,1fr); }
  .hba-hide-sm{ display:block; }
  .hba-pad-lg{ padding:32px; }
  .hba-pad-md{ padding:28px; }
  .hba-title-pad{ padding:24px 28px; }
}
@media (min-width:1024px){
  .hba-ladder{ grid-template-columns:repeat(3,1fr); }
}
@media (prefers-reduced-motion: reduce){ .hba * { transition:none !important; } }
`;

// ═══════════════════════════════════════════════════════════════════════════
export default function HomebuildingAnalysis() {
  const [active, setActive] = useState('custom');
  const path = PATHS[active];

  // deal modeler state — Utah defaults
  const [lot, setLot] = useState(250000);
  const [build, setBuild] = useState(300000);
  const [soft, setSoft] = useState(45000);
  const [sale, setSale] = useState(720000);
  const [ltc, setLtc] = useState(75);
  const [rate, setRate] = useState(11);
  const [months, setMonths] = useState(12);
  const [sellPct, setSellPct] = useState(6);
  const [feePct, setFeePct] = useState(18);
  const [region, setRegion] = useState('wasatch');

  const pickRegion = (key) => {
    const r = REGIONS[key];
    setRegion(key);
    setLot(r.lot); setBuild(r.build); setSoft(r.soft); setSale(r.sale);
  };

  const m = useMemo(() => {
    const total = lot + build + soft;
    const loan = total * (ltc / 100);
    const down = total - loan;
    const monthlyInt = (loan * (rate / 100)) / 12 * 0.6; // avg ~60% drawn
    const carry = monthlyInt * months;
    const reserves = monthlyInt * 6;
    const sellCost = sale * (sellPct / 100);
    const profit = sale - total - carry - sellCost;
    const margin = profit / sale;
    const cashNeeded = down + reserves;
    const coc = profit / cashNeeded;
    const builderFee = build * (feePct / 100);
    return { total, loan, down, carry, reserves, sellCost, profit, margin, cashNeeded, coc, builderFee };
  }, [lot, build, soft, sale, ltc, rate, months, sellPct, feePct]);

  const overStake = m.down - 100000;
  const beamMax = Math.max(m.down * 1.25, 220000);

  // ─── SECTION: Render ───
  return (
    <div className="hba" style={{ background: C.paper, minHeight: '100vh', fontFamily: SANS, color: C.ink }}>
      <style>{STYLES}</style>

      <div className="hba-wrap">

        {/* ---------- TITLE BLOCK ---------- */}
        <div style={{ borderRadius: 16, overflow: 'hidden', border: `1px solid ${C.line}` }}>
          <div className="hba-title-pad" style={{ background: C.steel, color: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontFamily: MONO, fontSize: 11, letterSpacing: 2, opacity: 0.8 }}>
              <Building2 size={14} color="#fff" /> UTAH PROS RESTORATION · NEW VENTURE
            </div>
            <h1 style={{ fontFamily: DISP, fontWeight: 900, fontSize: 34, lineHeight: 1.05, letterSpacing: -0.5, margin: 0 }}>
              Homebuilding Entry Analysis
            </h1>
            <p style={{ marginTop: 8, opacity: 0.85, fontSize: 14, maxWidth: 560 }}>
              Three ways in, what each costs you, and a live model of where your capital actually goes.
            </p>
            <div style={{ marginTop: 20 }}>
              <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.5, opacity: 0.7, textTransform: 'uppercase', marginBottom: 7 }}>Market</div>
              <div style={{ display: 'inline-flex', borderRadius: 8, padding: 4, background: 'rgba(255,255,255,0.12)' }}>
                {Object.entries(REGIONS).map(([key, r]) => {
                  const on = region === key;
                  return (
                    <button key={key} onClick={() => pickRegion(key)}
                      style={{ borderRadius: 6, padding: '8px 12px', textAlign: 'left', cursor: 'pointer', border: 'none', background: on ? C.amber : 'transparent', transition: 'all .2s ease' }}>
                      <div style={{ fontFamily: DISP, fontWeight: 700, fontSize: 13, color: '#fff' }}>{r.label}</div>
                      <div style={{ fontFamily: MONO, fontSize: 10, color: '#fff', opacity: on ? 0.9 : 0.6, marginTop: 1 }}>{r.sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="hba-meta" style={{ background: C.card }}>
            {[
              ['Prepared for', 'Moroni & Mike'],
              ['Starting stake', '$100,000'],
              ['Scope', 'Residential build'],
              ['Rev', 'A · ' + new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })],
            ].map(([k, v], i) => (
              <div key={k} style={{ padding: '12px 20px', borderRight: i < 3 ? `1px solid ${C.line}` : 'none', borderTop: `1px solid ${C.line}` }}>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, color: C.faint, textTransform: 'uppercase' }}>{k}</div>
                <div style={{ fontFamily: MONO, fontSize: 14, color: C.ink, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ---------- THE STAKE ---------- */}
        <section style={{ marginTop: 32 }}>
          <Eyebrow sheet="SHT 01">The reframe</Eyebrow>
          <div className="hba-pad-lg" style={{ borderRadius: 16, background: C.card, border: `1px solid ${C.line}` }}>
            <h2 style={{ fontFamily: DISP, fontWeight: 800, fontSize: 26, lineHeight: 1.15, letterSpacing: -0.3, margin: 0 }}>
              $100,000 is your <span style={{ color: C.amber }}>stake</span>, not your build budget.
            </h2>
            <p style={{ marginTop: 12, fontSize: 15, color: C.muted, maxWidth: 680 }}>
              {REGIONS[region].blurb} So $100k won't spec-build a house outright. What it does is make you fundable —
              it's your down payment, reserves, and operating cushion. The real question isn't <em>how much house</em>;
              it's <em>which path lets two operators with $100k and real construction adjacency deploy it well.</em>
            </p>
          </div>
        </section>

        {/* ---------- THREE PATHS ---------- */}
        <section style={{ marginTop: 32 }}>
          <Eyebrow sheet="SHT 02">The three paths</Eyebrow>

          <div className="hba-paths">
            {Object.values(PATHS).map((p) => {
              const Icon = p.icon;
              const on = active === p.key;
              return (
                <button key={p.key} onClick={() => setActive(p.key)}
                  style={{
                    borderRadius: 12, padding: '16px 12px', textAlign: 'left', cursor: 'pointer',
                    background: on ? C.card : 'transparent',
                    border: `1px solid ${on ? p.color : C.line}`,
                    boxShadow: on ? '0 6px 18px rgba(21,32,44,0.10)' : 'none',
                    transition: 'all .2s ease',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ borderRadius: 8, padding: 6, display: 'inline-flex', background: on ? p.color : C.lineSoft }}>
                      <Icon size={16} color={on ? '#fff' : C.muted} />
                    </span>
                  </div>
                  <div style={{ fontFamily: DISP, fontWeight: 700, fontSize: 15, color: on ? C.ink : C.muted }}>{p.name}</div>
                  <div className="hba-hide-sm" style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>
                    {p.key === 'custom' ? 'Lowest risk' : p.key === 'spec' ? 'Full upside' : 'Long game'}
                  </div>
                </button>
              );
            })}
          </div>

          {/* detail panel */}
          <div className="hba-pad-lg" style={{ borderRadius: 16, marginTop: 12, background: C.card, border: `1px solid ${C.line}`, borderTop: `3px solid ${path.color}` }}>
            <div className="hba-detail-head">
              <div style={{ maxWidth: 560 }}>
                <h3 style={{ fontFamily: DISP, fontWeight: 800, fontSize: 24, letterSpacing: -0.3, margin: 0 }}>{path.name}</h3>
                <p style={{ color: path.color, fontWeight: 600, fontSize: 14, marginTop: 2 }}>{path.tag}</p>
                <p style={{ color: C.muted, fontSize: 14, marginTop: 10 }}>{path.how}</p>
              </div>
              <div className="hba-gauges" style={{ borderRadius: 12, padding: 16, background: C.paper }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {path.gauges.map(([l, v]) => (
                    <Gauge key={l} label={l} value={v} color={path.color} />
                  ))}
                </div>
              </div>
            </div>

            <div className="hba-2col" style={{ marginTop: 28 }}>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: C.up, textTransform: 'uppercase', marginBottom: 8 }}>↑ Upside</div>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyle: 'none' }}>
                  {path.up.map((x, i) => (
                    <li key={i} style={{ display: 'flex', gap: 8, fontSize: 14, color: C.ink }}>
                      <span style={{ color: C.up, marginTop: 1 }}>▪</span>{x}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: C.down, textTransform: 'uppercase', marginBottom: 8 }}>↓ Downside</div>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyle: 'none' }}>
                  {path.down.map((x, i) => (
                    <li key={i} style={{ display: 'flex', gap: 8, fontSize: 14, color: C.ink }}>
                      <span style={{ color: C.down, marginTop: 1 }}>▪</span>{x}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div style={{ marginTop: 28, paddingTop: 20, borderTop: `1px solid ${C.line}` }}>
              <div className="hba-2col">
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: C.muted, textTransform: 'uppercase', marginBottom: 6 }}>Financing</div>
                  <p style={{ fontSize: 14, color: C.muted, margin: 0 }}>{path.money}</p>
                </div>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: C.muted, textTransform: 'uppercase', marginBottom: 6 }}>Typical capital at risk</div>
                  <div style={{ fontFamily: MONO, fontSize: 22, color: C.ink, marginBottom: 8 }}>
                    {path.key === 'custom' ? '≈ $0' : '~' + fmt$k(path.exposure)}
                  </div>
                  <ExposureBeam value={path.exposure} max={220000} color={path.color} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- RADAR ---------- */}
        <section style={{ marginTop: 32 }}>
          <Eyebrow sheet="SHT 03">Side by side</Eyebrow>
          <div className="hba-pad-md" style={{ borderRadius: 16, background: C.card, border: `1px solid ${C.line}` }}>
            <p style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>
              Higher = more of that trait. Note the trade: Custom wins on speed and fit today; Spec and Development buy upside with capital and risk.
            </p>
            <RadarChart data={radarData} series={radarSeries} />
          </div>
        </section>

        {/* ---------- DEAL MODELER ---------- */}
        <section style={{ marginTop: 32 }}>
          <Eyebrow sheet="SHT 04">Deal modeler — run a real lot</Eyebrow>
          <div className="hba-pad-md" style={{ borderRadius: 16, background: C.card, border: `1px solid ${C.line}` }}>

            {/* region note */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 20, borderRadius: 8, padding: '8px 12px', background: C.paper }}>
              <span style={{ fontFamily: MONO, fontSize: 12, color: C.ink }}>
                Loaded: <b>{REGIONS[region].label}</b> — {REGIONS[region].cities}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>
                land &amp; sale set by market · build + soft ~statewide · drag to override
              </span>
            </div>

            {/* inputs */}
            <div className="hba-2col" style={{ columnGap: 32 }}>
              {[
                ['Lot price', lot, setLot, 50000, 600000, 5000, fmt$],
                ['Build / hard cost', build, setBuild, 100000, 700000, 5000, fmt$],
                ['Soft costs + contingency', soft, setSoft, 0, 150000, 2500, fmt$],
                ['Expected sale price (ARV)', sale, setSale, 200000, 1500000, 10000, fmt$],
              ].map(([label, val, setter, min, max, step, fmt]) => (
                <div key={label}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontFamily: MONO, fontSize: 12, color: C.muted }}>{label}</label>
                    <span style={{ fontFamily: MONO, fontSize: 14, color: C.ink }}>{fmt(val)}</span>
                  </div>
                  <input type="range" min={min} max={max} step={step} value={val}
                    onChange={(e) => setter(Number(e.target.value))} />
                </div>
              ))}
            </div>

            {/* assumptions */}
            <div style={{ marginTop: 24, borderRadius: 12, padding: 16, background: C.paper }}>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: C.faint, textTransform: 'uppercase', marginBottom: 12 }}>Assumptions</div>
              <div className="hba-assump">
                {[
                  ['Loan-to-cost', ltc, setLtc, 60, 90, 1, '%'],
                  ['Interest rate', rate, setRate, 6, 15, 0.5, '%'],
                  ['Months to sell', months, setMonths, 6, 24, 1, ''],
                  ['Selling cost', sellPct, setSellPct, 4, 9, 0.5, '%'],
                  ['Builder fee', feePct, setFeePct, 10, 25, 1, '%'],
                ].map(([label, val, setter, min, max, step, suffix]) => (
                  <div key={label}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <label style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>{label}</label>
                      <span style={{ fontFamily: MONO, fontSize: 12, color: C.ink }}>{val}{suffix}</span>
                    </div>
                    <input type="range" min={min} max={max} step={step} value={val}
                      onChange={(e) => setter(Number(e.target.value))} />
                  </div>
                ))}
              </div>
            </div>

            {/* outputs */}
            <div className="hba-2col" style={{ marginTop: 24 }}>
              {/* SPEC */}
              <div style={{ borderRadius: 12, padding: 20, border: `1px solid ${C.line}`, borderTop: `3px solid ${C.amber}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <span style={{ borderRadius: 8, padding: 6, display: 'inline-flex', background: C.amber }}><Building2 size={15} color="#fff" /></span>
                  <span style={{ fontFamily: DISP, fontWeight: 700, fontSize: 17 }}>If you spec it</span>
                </div>
                <Row k="Total project cost" v={fmt$(m.total)} />
                <Row k={`Loan @ ${ltc}% LTC`} v={fmt$(m.loan)} />
                <Row k="Down payment (equity in)" v={fmt$(m.down)} strong />
                <Row k="Est. interest carry" v={fmt$(m.carry)} sub />
                <Row k="Selling costs" v={fmt$(m.sellCost)} sub />
                <div style={{ margin: '12px 0', height: 1, background: C.line }} />
                <Row k="Projected profit" v={fmt$(m.profit)} big color={m.profit >= 0 ? C.up : C.down} />
                <Row k="Margin on sale" v={pct(m.margin)} color={m.margin >= 0 ? C.up : C.down} />
                <Row k="Cash needed (down + reserves)" v={fmt$(m.cashNeeded)} />
                <Row k="Cash-on-cash return" v={pct(m.coc)} strong color={m.coc >= 0 ? C.up : C.down} />
                <div style={{ marginTop: 16 }}>
                  <ExposureBeam value={m.down} max={beamMax} color={C.amber} note="down payment vs stake" />
                </div>
              </div>

              {/* CUSTOM */}
              <div style={{ borderRadius: 12, padding: 20, border: `1px solid ${C.line}`, borderTop: `3px solid ${C.up}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <span style={{ borderRadius: 8, padding: 6, display: 'inline-flex', background: C.up }}><HardHat size={15} color="#fff" /></span>
                  <span style={{ fontFamily: DISP, fontWeight: 700, fontSize: 17 }}>If you build it for a client</span>
                </div>
                <Row k="Who finances it" v="The client" />
                <Row k={`Builder fee @ ${feePct}% of build`} v={fmt$(m.builderFee)} strong color={C.up} />
                <Row k="Your capital at risk" v="≈ $0" big color={C.up} />
                <Row k="Paid via" v="Draws at milestones" sub />
                <div style={{ margin: '12px 0', height: 1, background: C.line }} />
                <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
                  Same house, a fraction of the exposure. You trade the full margin for a fee — but you keep your
                  stake, dodge the carry, and bank a completed build that makes the next spec loan cheaper.
                </p>
                <div style={{ marginTop: 16 }}>
                  <ExposureBeam value={6000} max={beamMax} color={C.up} note="working capital only" />
                </div>
              </div>
            </div>

            {/* verdict */}
            <div style={{ borderRadius: 12, marginTop: 16, padding: 16, display: 'flex', gap: 12, background: overStake > 0 ? '#FBEFE7' : '#EAF3EF', border: `1px solid ${overStake > 0 ? C.amber : C.up}` }}>
              <AlertTriangle size={18} color={overStake > 0 ? C.amber : C.up} />
              <p style={{ fontSize: 14, color: C.ink, margin: 0 }}>
                {overStake > 0 ? (
                  <>This spec needs <b style={{ fontFamily: MONO }}>{fmt$(m.down)}</b> down — about <b style={{ fontFamily: MONO }}>{fmt$(overStake)}</b> beyond your $100k stake.
                  You'd need a capital partner, a cheaper lot, or a couple of custom builds first to do this solo.</>
                ) : (
                  <>This spec's down payment fits inside your $100k stake — but keep <b style={{ fontFamily: MONO }}>{fmt$(m.reserves)}</b> in reserves for carry, and don't forget the {pct(m.margin)} margin is yours to lose if it overruns.</>
                )}
              </p>
            </div>
            <p style={{ marginTop: 12, fontFamily: MONO, fontSize: 11, color: C.faint }}>
              Estimates for comparison — carry assumes ~60% average draw balance. Validate every line before you commit.
            </p>
          </div>
        </section>

        {/* ---------- FINANCING LADDER ---------- */}
        <section style={{ marginTop: 32 }}>
          <Eyebrow sheet="SHT 05">The money ladder</Eyebrow>
          <div className="hba-ladder">
            {LADDER.map((x, i) => {
              const Icon = x.icon;
              return (
                <div key={i} style={{ borderRadius: 12, padding: 20, background: C.card, border: `1px solid ${C.line}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ borderRadius: 8, padding: 6, display: 'inline-flex', background: C.paper }}><Icon size={16} color={C.steel} /></span>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: '#fff', background: C.steel, padding: '3px 7px', borderRadius: 5, letterSpacing: 0.5 }}>{x.cost}</span>
                  </div>
                  <div style={{ fontFamily: DISP, fontWeight: 700, fontSize: 15 }}>{x.title}</div>
                  <div style={{ fontSize: 12, color: C.amber, fontWeight: 600, marginTop: 3 }}>{x.use}</div>
                  <p style={{ fontSize: 13, color: C.muted, marginTop: 8, margin: '8px 0 0' }}>{x.body}</p>
                </div>
              );
            })}
            <div style={{ borderRadius: 12, padding: 20, display: 'flex', alignItems: 'center', background: C.steel }}>
              <p style={{ color: '#fff', fontSize: 14, margin: 0 }}>
                <b>Best use of your $100k:</b> reserves + down on one spec <em>after</em> a couple custom builds — or
                the GP stake that brings in a money partner. Don't burn it as the first solo lot.
              </p>
            </div>
          </div>
        </section>

        {/* ---------- DECISIONS ---------- */}
        <Decisions />

        {/* ---------- LICENSING ---------- */}
        <section style={{ marginTop: 32 }}>
          <Eyebrow sheet="SHT 07">Utah licensing path</Eyebrow>
          <div className="hba-pad-lg" style={{ borderRadius: 16, background: C.card, border: `1px solid ${C.line}` }}>
            <div className="hba-2col" style={{ gap: 24 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {[
                  [ScrollText, 'License class', 'B100 (no project cap) or R100 (residential ≤4 units + small commercial). Required for any project over $3,000.'],
                  [ShieldCheck, 'Qualifier — the gate', '2 years / 4,000 hrs construction experience within 10 yrs, ≥1 yr supervisory. A 2- or 4-yr construction-management degree also qualifies.'],
                  [Check, 'Pre-license course', '25-hour DOPL-approved course, taken in person.'],
                  [Check, 'Exam', 'Utah Business & Law exam, 70% to pass. No trade exam required since 2019.'],
                ].map((row, i) => {
                  const Icon = row[0];
                  return (
                    <div key={i} style={{ display: 'flex', gap: 12 }}>
                      <span style={{ flexShrink: 0, marginTop: 2 }}><Icon size={18} color={C.steel} /></span>
                      <div>
                        <div style={{ fontFamily: MONO, fontSize: 12, color: C.ink, fontWeight: 600 }}>{row[1]}</div>
                        <div style={{ fontSize: 13, color: C.muted }}>{row[2]}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {[
                  ['Surety bond', '$50,000 contractor license bond, filed before issuance.'],
                  ['Insurance', 'General liability (min $100k / $300k); workers comp if you have employees.'],
                  ['Fees / renewal', '~$230–$315 application. Renews every 2 years with CE.'],
                ].map(([k, v], i) => (
                  <div key={i} style={{ borderRadius: 8, padding: 12, background: C.paper }}>
                    <div style={{ fontFamily: MONO, fontSize: 12, color: C.ink, fontWeight: 600 }}>{k}</div>
                    <div style={{ fontSize: 13, color: C.muted }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ borderRadius: 12, marginTop: 24, padding: 16, display: 'flex', gap: 12, background: '#FBEFE7', border: `1px solid ${C.amber}` }}>
              <AlertTriangle size={18} color={C.amber} />
              <p style={{ fontSize: 14, color: C.ink, margin: 0 }}>
                <b>Open question that sets your timeline:</b> UPR's reconstruction side started late 2024 — roughly 1.5 years.
                Verify whether your documented supervisory hours clear the 2-year bar, or whether Mike's do. If neither, the
                CM-degree route or a few more documented months are your options.
              </p>
            </div>
          </div>
        </section>

        {/* ---------- RISK ---------- */}
        <section style={{ marginTop: 32, marginBottom: 24 }}>
          <Eyebrow sheet="SHT 08">The honest risk</Eyebrow>
          <div className="hba-pad-lg" style={{ borderRadius: 16, background: C.ink, color: '#fff' }}>
            <p style={{ fontSize: 16, lineHeight: 1.55, maxWidth: 760, margin: 0 }}>
              Spec margins often run 10–20% before overruns, and carrying cost on unsold inventory is the killer — spec
              at the wrong point in the rate cycle wipes builders out. Custom insulates you from that because the client
              carries the loan. Your real edge: the documentation discipline and estimating systems you already run at UPR
              are exactly what lenders reward in a new builder. <span style={{ color: C.amber, fontWeight: 600 }}>Start custom, bank the track record, then graduate to spec.</span>
            </p>
          </div>
        </section>

        <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderTop: `1px solid ${C.line}`, fontFamily: MONO, fontSize: 11, color: C.faint }}>
          <span>UPR · HOMEBUILDING ENTRY ANALYSIS</span>
          <span>FOR INTERNAL REVIEW — MORONI &amp; MIKE</span>
        </footer>
      </div>
    </div>
  );
}
