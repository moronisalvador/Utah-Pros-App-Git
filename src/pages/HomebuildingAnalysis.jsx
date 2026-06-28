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
import { useState, useMemo, useRef, useEffect } from 'react';
import { getAuthHeader } from '@/lib/realtime';

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
    profile: {
      land: 'Buildable lots commonly $180k–$450k+. Infill and east-bench / view lots run higher; entry-level lots in growth corridors (Saratoga Springs, Eagle Mountain, southern Utah County) sit at the low end. Teardown/scrape lots in established SLC neighborhoods carry a premium and demo cost.',
      costs: [
        ['Lot / land', '$180k–$450k+'],
        ['Hard build cost', '$150–$200 / sf'],
        ['Soft costs', '$40k–$70k'],
        ['Impact + connection fees', '$10k–$30k+ (varies by city)'],
        ['Typical new-build ARV', '$550k–$1.2M+'],
      ],
      submarkets: 'SLC east bench (premium) · Draper / Lehi / Saratoga Springs (growth) · Utah County — Provo, Orem, Spanish Fork, Eagle Mountain',
      expect: [
        'High lot competition — good lots move fast and often off-market.',
        'Longer entitlement/permitting in established cities; faster in growth-corridor subdivisions.',
        'Winter weather affects the schedule (foundation/site work).',
        'HOAs and design review common in newer master-planned communities.',
        'Strong, supply-constrained resale demand keeps days-on-market low for well-built homes.',
      ],
    },
  },
  southern: {
    label: 'Southern Utah',
    sub: 'St. George · Washington Co.',
    cities: 'St. George, Ivins, Santa Clara, Hurricane & Washington County',
    lot: 190000, build: 300000, soft: 45000, sale: 650000,
    blurb: 'A buildable Washington County lot still runs $150k+ — far more on a red-rock view lot in Ivins or Santa Clara — before you pour a footing, and hard costs add $200k+ on top.',
    profile: {
      land: 'Washington and Hurricane lots are the value end (~$120k–$250k). St. George, Ivins, and Santa Clara red-rock VIEW lots run $250k–$600k+ — the view is most of the price. Master-planned areas (near Sand Hollow, Desert Color) carry HOA + design standards.',
      costs: [
        ['Lot / land', '$120k–$600k+ (view premium)'],
        ['Hard build cost', '$150–$190 / sf'],
        ['Soft costs', '$35k–$55k'],
        ['Water + impact fees', 'Notable — a real cost & constraint'],
        ['Typical new-build ARV', '$500k–$950k+'],
      ],
      submarkets: 'St. George (core) · Ivins / Santa Clara (premium red-rock views) · Hurricane / Washington (value) · Toquerville / LaVerkin (emerging)',
      expect: [
        'Water availability, connection, and impact fees are a gating cost — confirm a will-serve early.',
        'Summer heat compresses the work window; schedule slabs/roofing around it.',
        'Strong second-home and retiree demand; more seasonal buyer activity.',
        'Big value spread driven by the lot/view — the same house sells for far more on a red-rock view.',
        'HOA + architectural review common in master-planned communities.',
      ],
    },
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

// ─── SECTION: Build Copilot (AI chat) ───
// Tiny markdown-ish formatter: renders **bold** spans and preserves line breaks.
// Avoids pulling in a markdown dependency — the assistant is prompted to use bullets, not tables.
function formatText(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((seg, i) => {
    if (seg.startsWith('**') && seg.endsWith('**')) {
      return <b key={i}>{seg.slice(2, -2)}</b>;
    }
    return <span key={i}>{seg}</span>;
  });
}

const SUGGESTIONS = [
  'Cost to build a 2,500 sf home in Hurricane?',
  'Draft a rough build schedule for a custom home',
  'How should I price a spec in St. George?',
  'What soft costs do new builders forget?',
];

function BuildCopilot({ deal }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  const send = async (text) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setError('');
    setInput('');
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setBusy(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 95000);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/homebuilding-chat', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, deal }),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      setMessages((m) => [...m, { role: 'assistant', content: data.reply }]);
    } catch (e) {
      setError(e.name === 'AbortError'
        ? 'That took too long — try a shorter question, or one that doesn’t need a web lookup.'
        : (e.message || 'Something went wrong — try again.'));
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <section style={{ marginTop: 32 }}>
      <Eyebrow sheet="AI">Build copilot — ask anything</Eyebrow>
      <div className="hba-pad-md" style={{ borderRadius: 16, background: C.card, border: `1px solid ${C.line}` }}>
        <p style={{ fontSize: 13, color: C.muted, marginTop: 0, marginBottom: 14 }}>
          A construction-planning specialist — buying land, planning, full-project costs, scheduling, the Utah market,
          financing, sales, value-add, and Utah building/plumbing/electrical code norms. It can see the deal-modeler
          numbers below and can search the web for current figures (rates, prices, code editions). Answers can take a
          few seconds when it looks something up.
        </p>

        {/* message log */}
        <div ref={scrollRef} style={{
          maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12,
          padding: messages.length ? 12 : 0, borderRadius: 12,
          background: messages.length ? C.paper : 'transparent',
          border: messages.length ? `1px solid ${C.lineSoft}` : 'none',
        }}>
          {messages.length === 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} disabled={busy}
                  style={{
                    fontFamily: MONO, fontSize: 12, color: C.steel, cursor: busy ? 'default' : 'pointer',
                    background: C.paper, border: `1px solid ${C.line}`, borderRadius: 9999, padding: '8px 12px',
                    textAlign: 'left',
                  }}>
                  {s}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '85%', borderRadius: 14, padding: '10px 14px', fontSize: 14, lineHeight: 1.5,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                background: m.role === 'user' ? C.steel : C.card,
                color: m.role === 'user' ? '#fff' : C.ink,
                border: m.role === 'user' ? 'none' : `1px solid ${C.line}`,
                borderBottomRightRadius: m.role === 'user' ? 4 : 14,
                borderBottomLeftRadius: m.role === 'user' ? 14 : 4,
              }}>
                {m.role === 'user' ? m.content : formatText(m.content)}
              </div>
            </div>
          ))}
          {busy && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{ borderRadius: 14, padding: '10px 14px', fontSize: 13, color: C.faint, fontFamily: MONO, background: C.card, border: `1px solid ${C.line}` }}>
                thinking…
              </div>
            </div>
          )}
        </div>

        {error && (
          <div style={{ marginTop: 10, fontSize: 13, color: C.down, fontFamily: MONO }}>{error}</div>
        )}

        {/* composer */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about costs, schedule, financing, the Hurricane market…"
            rows={1}
            style={{
              flex: 1, resize: 'none', minHeight: 44, maxHeight: 160, padding: '11px 14px',
              fontFamily: SANS, fontSize: 14, color: C.ink, background: C.paper,
              border: `1px solid ${C.line}`, borderRadius: 12, outline: 'none',
            }}
          />
          <button onClick={() => send()} disabled={busy || !input.trim()}
            style={{
              flexShrink: 0, height: 44, padding: '0 18px', borderRadius: 12, border: 'none',
              fontFamily: DISP, fontWeight: 700, fontSize: 14,
              cursor: busy || !input.trim() ? 'default' : 'pointer',
              background: busy || !input.trim() ? C.lineSoft : C.amber,
              color: busy || !input.trim() ? C.faint : '#fff',
            }}>
            Send
          </button>
        </div>
        <p style={{ marginTop: 8, fontFamily: MONO, fontSize: 10.5, color: C.faint }}>
          Estimates for planning — validate against local subs &amp; comps. Press Enter to send, Shift+Enter for a new line.
        </p>
      </div>
    </section>
  );
}

// ─── SECTION: Market profile (curated, reacts to the Market toggle) ───
function MarketProfile({ region }) {
  const r = REGIONS[region];
  const p = r.profile;
  const label = (t) => (
    <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: C.faint, textTransform: 'uppercase', marginBottom: 8 }}>{t}</div>
  );
  return (
    <section style={{ marginTop: 32 }}>
      <Eyebrow sheet="MKT">{r.label} — land, costs &amp; what to expect</Eyebrow>
      <div className="hba-pad-md" style={{ borderRadius: 16, background: C.card, border: `1px solid ${C.line}` }}>
        <div style={{ borderRadius: 12, padding: 16, background: C.paper, marginBottom: 20 }}>
          {label('Buying land here')}
          <p style={{ fontSize: 14, color: C.ink, margin: 0, lineHeight: 1.5 }}>{p.land}</p>
        </div>
        <div className="hba-2col">
          <div>
            {label('Average costs to expect')}
            {p.costs.map(([k, v]) => <Row key={k} k={k} v={v} strong />)}
            <p style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint, marginTop: 10 }}>
              Ballpark ranges — use the Build &amp; Value estimator below for a specific home, and the copilot for live figures.
            </p>
          </div>
          <div>
            {label('What to expect')}
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyle: 'none' }}>
              {p.expect.map((x, i) => (
                <li key={i} style={{ display: 'flex', gap: 8, fontSize: 14, color: C.ink }}>
                  <span style={{ color: C.amber, marginTop: 1 }}>▪</span>{x}
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 16 }}>
              {label('Submarkets')}
              <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.5 }}>{p.submarkets}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── SECTION: AI Build & Value Estimator ───
const FINISH_LEVELS = [
  ['builder', 'Builder-grade'],
  ['mid', 'Mid'],
  ['semi-custom', 'Semi-custom'],
  ['custom', 'Custom'],
];
const FEATURES = [
  'Finished basement', '3-car garage', 'RV garage / pad', 'Casita / ADU', 'Pool', 'Hot tub / spa',
  'Solar', 'Smart home', 'View lot', 'Covered outdoor living', 'Gourmet kitchen', 'Office / flex room',
];

function Range3({ label, lo, mid, hi }) {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: C.faint, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 24, color: C.ink, fontWeight: 600 }}>{fmt$(mid)}</div>
      <div style={{ fontFamily: MONO, fontSize: 12, color: C.muted, marginTop: 2 }}>{fmt$(lo)} – {fmt$(hi)}</div>
    </div>
  );
}

function AIEstimator({ region }) {
  const [bedrooms, setBedrooms] = useState(4);
  const [bathrooms, setBathrooms] = useState(3);
  const [sqft, setSqft] = useState(2500);
  const [stories, setStories] = useState(1);
  const [finish, setFinish] = useState('mid');
  const [landAcres, setLandAcres] = useState(0.25);
  const [features, setFeatures] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  // Clear a prior estimate when the market changes — it was priced for the old region.
  useEffect(() => { setResult(null); setError(''); }, [region]);

  const toggleFeature = (f) =>
    setFeatures((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));

  const run = async () => {
    setBusy(true); setError('');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 95000);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/homebuilding-estimate', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: { region, bedrooms, bathrooms, sqft, stories, finish, landAcres, features } }),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      setResult(data.estimate);
    } catch (e) {
      setError(e.name === 'AbortError' ? 'That took too long — try again.' : (e.message || 'Estimate failed — try again.'));
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  };

  const sliders = [
    ['Bedrooms', bedrooms, setBedrooms, 1, 8, 1, ''],
    ['Bathrooms', bathrooms, setBathrooms, 1, 7, 0.5, ''],
    ['Square footage', sqft, setSqft, 1000, 6000, 100, ' sf'],
    ['Stories', stories, setStories, 1, 3, 1, ''],
    ['Land size (acres)', landAcres, setLandAcres, 0.1, 3, 0.05, ' ac'],
  ];

  return (
    <section style={{ marginTop: 32 }}>
      <Eyebrow sheet="AI">Build &amp; value estimator</Eyebrow>
      <div className="hba-pad-md" style={{ borderRadius: 16, background: C.card, border: `1px solid ${C.line}` }}>
        <p style={{ fontSize: 13, color: C.muted, marginTop: 0, marginBottom: 16 }}>
          Describe a home and the AI reasons out a hard build cost and an approximate sale value for{' '}
          <b>{REGIONS[region].label}</b> (set by the Market toggle up top). Estimates to validate against local subs &amp; comps.
        </p>

        {/* inputs */}
        <div className="hba-assump">
          {sliders.map(([lab, val, setter, min, max, step, suffix]) => (
            <div key={lab}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <label style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>{lab}</label>
                <span style={{ fontFamily: MONO, fontSize: 12, color: C.ink }}>
                  {step < 1 ? val : Math.round(val).toLocaleString('en-US')}{suffix}
                </span>
              </div>
              <input type="range" min={min} max={max} step={step} value={val}
                onChange={(e) => setter(Number(e.target.value))} />
            </div>
          ))}
          <div>
            <label style={{ fontFamily: MONO, fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>Finish level</label>
            <select value={finish} onChange={(e) => setFinish(e.target.value)}
              style={{ width: '100%', height: 34, padding: '0 8px', fontFamily: SANS, fontSize: 13, color: C.ink, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 8 }}>
              {FINISH_LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>

        {/* features */}
        <div style={{ marginTop: 20 }}>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: C.faint, textTransform: 'uppercase', marginBottom: 8 }}>Features</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {FEATURES.map((f) => {
              const on = features.includes(f);
              return (
                <button key={f} onClick={() => toggleFeature(f)}
                  style={{
                    fontFamily: MONO, fontSize: 12, padding: '7px 12px', borderRadius: 9999, cursor: 'pointer',
                    background: on ? C.steel : C.paper, color: on ? '#fff' : C.muted,
                    border: `1px solid ${on ? C.steel : C.line}`, transition: 'all .15s ease',
                  }}>
                  {f}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
          <button onClick={run} disabled={busy}
            style={{
              height: 44, padding: '0 22px', borderRadius: 12, border: 'none',
              fontFamily: DISP, fontWeight: 700, fontSize: 14, cursor: busy ? 'default' : 'pointer',
              background: busy ? C.lineSoft : C.amber, color: busy ? C.faint : '#fff',
            }}>
            {busy ? 'Estimating…' : result ? 'Re-estimate' : 'Estimate build cost & value'}
          </button>
          {error && <span style={{ fontSize: 13, color: C.down, fontFamily: MONO }}>{error}</span>}
        </div>

        {/* result */}
        {result && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: `1px solid ${C.line}` }}>
            <div className="hba-2col">
              <div style={{ borderRadius: 12, padding: 20, border: `1px solid ${C.line}`, borderTop: `3px solid ${C.amber}` }}>
                <Range3 label="Hard build cost" lo={result.build_cost.low} mid={result.build_cost.expected} hi={result.build_cost.high} />
                <div style={{ fontFamily: MONO, fontSize: 12, color: C.muted, marginTop: 6 }}>
                  ≈ ${Math.round(result.cost_per_sf.low)}–${Math.round(result.cost_per_sf.high)} / sf · structure only
                </div>
                <div style={{ marginTop: 14 }}>
                  {(result.breakdown || []).map((b, i) => <Row key={i} k={b.label} v={fmt$(b.amount)} sub />)}
                </div>
              </div>
              <div style={{ borderRadius: 12, padding: 20, border: `1px solid ${C.line}`, borderTop: `3px solid ${C.up}` }}>
                <Range3 label="Approx. sale value (ARV)" lo={result.arv.low} mid={result.arv.expected} hi={result.arv.high} />
                <div style={{ display: 'inline-block', marginTop: 10, fontFamily: MONO, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: C.paper, color: C.muted, border: `1px solid ${C.line}` }}>
                  confidence: {result.confidence}
                </div>
                {(result.feature_notes || []).length > 0 && (
                  <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '14px 0 0', padding: 0, listStyle: 'none' }}>
                    {result.feature_notes.map((n, i) => (
                      <li key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: C.muted }}>
                        <span style={{ color: C.up, marginTop: 1 }}>▪</span>{n}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            {((result.assumptions || []).length > 0 || (result.notes || []).length > 0) && (
              <div className="hba-2col" style={{ marginTop: 16 }}>
                {(result.assumptions || []).length > 0 && (
                  <div>
                    <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: C.faint, textTransform: 'uppercase', marginBottom: 6 }}>Assumptions</div>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: C.muted, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {result.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}
                {(result.notes || []).length > 0 && (
                  <div>
                    <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: C.faint, textTransform: 'uppercase', marginBottom: 6 }}>Notes</div>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: C.muted, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {result.notes.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <p style={{ marginTop: 14, fontFamily: MONO, fontSize: 10.5, color: C.faint }}>
              AI estimate from market cost anchors + your spec — validate against local subs and recent comps before committing.
            </p>
          </div>
        )}
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

        {/* ---------- MARKET PROFILE (reacts to the Market toggle) ---------- */}
        <MarketProfile region={region} />

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

        {/* ---------- BUILD COPILOT (AI chat) — sits right above the calculators ---------- */}
        <BuildCopilot deal={{ region, lot, build, soft, sale, ltc, rate, months, sellPct, feePct }} />

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

        {/* ---------- AI BUILD & VALUE ESTIMATOR (second calculator) ---------- */}
        <AIEstimator region={region} />

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
