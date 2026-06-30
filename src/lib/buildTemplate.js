/**
 * ════════════════════════════════════════════════
 * FILE: buildTemplate.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "brain" behind the New Build simulator. It holds a standard Utah home-build
 *   template — every construction phase (site work, foundation, framing, …), how much
 *   each typically costs, how many weeks it takes, and which loan draw pays for it.
 *   Given a home's size, region, finish level, stories and bathrooms, it works out a
 *   full itemized budget, a week-by-week schedule, a construction-loan draw schedule,
 *   and the money math (loan, carry, profit, margin). No screen of its own — the
 *   NewBuildSimulator page calls these functions and the user edits the numbers.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a plain data + math module)
 *   Rendered by:  n/a — imported by src/pages/NewBuildSimulator.jsx
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → none · writes → none (pure functions)
 *
 * NOTES / GOTCHAS:
 *   - Hard-cost $/sf ALREADY includes the builder's overhead & profit (it's the all-in
 *     build cost, like the estimator's build_cost). Soft costs (permits, plans, financing,
 *     contingency) are separate percentages — do NOT double-count GC margin.
 *   - Item "share" values don't need to sum to exactly 1; computeLineItems normalizes
 *     them so the trade line items always total the region/finish $/sf × sqft.
 *   - All figures are planning estimates to validate against local subs + comps.
 * ════════════════════════════════════════════════
 */

// ─── SECTION: cost drivers ───
export const REGIONS = { wasatch: 'Wasatch Front', southern: 'Southern Utah' };
export const FINISH_LEVELS = [
  ['builder', 'Builder-grade'],
  ['mid', 'Mid'],
  ['semi-custom', 'Semi-custom'],
  ['custom', 'Custom'],
];

// City/submarket detail. psfMult nudges construction cost; lot = typical buildable lot $;
// arvPsf = typical finished resale $/sf (the biggest city differentiator). AI Tune refines further.
export const SUBMARKETS = {
  wasatch: [
    { name: 'Salt Lake City (east bench)', psfMult: 1.08, lot: 420000, arvPsf: 330 },
    { name: 'Salt Lake County', psfMult: 1.00, lot: 290000, arvPsf: 270 },
    { name: 'Draper', psfMult: 1.03, lot: 360000, arvPsf: 300 },
    { name: 'Lehi / Saratoga Springs', psfMult: 0.99, lot: 220000, arvPsf: 255 },
    { name: 'Eagle Mountain', psfMult: 0.97, lot: 170000, arvPsf: 235 },
    { name: 'Provo / Orem', psfMult: 1.00, lot: 270000, arvPsf: 260 },
    { name: 'Spanish Fork / Salem', psfMult: 0.96, lot: 185000, arvPsf: 240 },
    { name: 'Park City area', psfMult: 1.25, lot: 750000, arvPsf: 520 },
  ],
  southern: [
    { name: 'St. George', psfMult: 1.00, lot: 210000, arvPsf: 275 },
    { name: 'Washington', psfMult: 0.97, lot: 150000, arvPsf: 255 },
    { name: 'Hurricane', psfMult: 0.95, lot: 135000, arvPsf: 240 },
    { name: 'Ivins (red-rock views)', psfMult: 1.06, lot: 420000, arvPsf: 350 },
    { name: 'Santa Clara', psfMult: 1.03, lot: 330000, arvPsf: 315 },
    { name: 'Toquerville / LaVerkin', psfMult: 0.95, lot: 125000, arvPsf: 235 },
  ],
};
const REGION_ARV_PSF = { wasatch: 265, southern: 270 };
const DEFAULT_CITY = { wasatch: 'Salt Lake County', southern: 'St. George' };
const FINISH_ARV_MULT = { builder: 0.92, mid: 1.0, 'semi-custom': 1.08, custom: 1.18 };

// Base all-in hard cost $/sf for a 1-story, mid finish (includes GC overhead & profit).
const REGION_BASE_PSF = { wasatch: 165, southern: 160 };
const FINISH_MULT = { builder: 0.88, mid: 1.0, 'semi-custom': 1.18, custom: 1.4 };
const STORY_MULT = { 1: 1.0, 2: 0.93, 3: 0.9 }; // two-story is cheaper per sf (less roof/foundation per sf)

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round0 = (n) => Math.round(Number(n) || 0);

export function getSubmarket(region, name) {
  return (SUBMARKETS[region] || []).find((c) => c.name === name) || null;
}
export function submarketMult(region, name) {
  const c = getSubmarket(region, name);
  return c ? c.psfMult : 1;
}
// Quick comps-based ARV baseline from the city's resale $/sf (AI estimate refines it).
export function computeArvBaseline(spec) {
  const region = REGIONS[spec.region] ? spec.region : 'wasatch';
  const c = getSubmarket(region, spec.submarket);
  const arvPsf = c ? c.arvPsf : (REGION_ARV_PSF[region] || 265);
  const sqft = clamp(Number(spec.sqft) || 2500, 400, 20000);
  const fa = FINISH_ARV_MULT[spec.finish] || 1;
  const effSf = sqft + 0.5 * clamp(Number(spec.basementSf) || 0, 0, 8000);
  return round0(arvPsf * effSf * fa);
}

// ─── SECTION: the build template (phases → line items, durations, draw stage) ───
// share = rough fraction of hard cost (normalized at compute time)
// finishW = scales with finish level · plumbW = scales with bathroom count
// per: 'sf' (qty = sqft, price per sf) | 'ls' (lump sum, qty = 1)
// weeks/startWeek define the schedule (overlaps allowed); draw = construction-loan milestone index
export const PHASES = [
  { key: 'site',      name: 'Site prep, excavation & utilities', color: '#8a5a2b', startWeek: 0,    weeks: 2,   draw: 1,
    items: [{ key: 'site', label: 'Site prep, excavation, utility stub-ins', per: 'sf', share: 0.06 }] },
  { key: 'foundation',name: 'Foundation & concrete flatwork',     color: '#6b7280', startWeek: 2,    weeks: 3,   draw: 1,
    items: [{ key: 'foundation', label: 'Footings, foundation, slab & flatwork', per: 'sf', share: 0.10 }] },
  { key: 'framing',   name: 'Framing',                            color: '#b45309', startWeek: 5,    weeks: 5,   draw: 2,
    items: [{ key: 'framing', label: 'Framing labor + lumber package', per: 'sf', share: 0.17 }] },
  { key: 'roofing',   name: 'Roofing',                            color: '#7c2d12', startWeek: 10,   weeks: 2,   draw: 2,
    items: [{ key: 'roofing', label: 'Roof structure, underlayment & covering', per: 'sf', share: 0.05 }] },
  { key: 'windows',   name: 'Windows & exterior doors',           color: '#2563eb', startWeek: 11,   weeks: 1.5, draw: 2,
    items: [{ key: 'windows', label: 'Windows & exterior doors', per: 'ls', share: 0.04, finishW: true }] },
  { key: 'exterior',  name: 'Exterior — siding / stucco',         color: '#0d9488', startWeek: 12,   weeks: 4,   draw: 3,
    items: [{ key: 'exterior', label: 'Siding / stucco / exterior finish', per: 'sf', share: 0.07, finishW: true }] },
  { key: 'plumbing',  name: 'Plumbing (rough + finish)',          color: '#0284c7', startWeek: 10.5, weeks: 2,   draw: 3,
    items: [{ key: 'plumbing', label: 'Plumbing rough-in, finish & fixtures', per: 'sf', share: 0.07, plumbW: true }] },
  { key: 'electrical',name: 'Electrical (rough + finish)',        color: '#ca8a04', startWeek: 11,   weeks: 2,   draw: 3,
    items: [{ key: 'electrical', label: 'Electrical rough-in, finish & fixtures', per: 'sf', share: 0.06 }] },
  { key: 'hvac',      name: 'HVAC',                               color: '#475569', startWeek: 11.5, weeks: 2,   draw: 3,
    items: [{ key: 'hvac', label: 'HVAC system, ducting & finish', per: 'sf', share: 0.05 }] },
  { key: 'insulation',name: 'Insulation',                         color: '#65a30d', startWeek: 13.5, weeks: 1,   draw: 4,
    items: [{ key: 'insulation', label: 'Insulation & air sealing', per: 'sf', share: 0.03 }] },
  { key: 'drywall',   name: 'Drywall',                            color: '#9ca3af', startWeek: 14.5, weeks: 3,   draw: 4,
    items: [{ key: 'drywall', label: 'Drywall hang, tape & texture', per: 'sf', share: 0.06 }] },
  { key: 'trim',      name: 'Interior trim, doors & millwork',    color: '#a16207', startWeek: 17.5, weeks: 2.5, draw: 5,
    items: [{ key: 'trim', label: 'Interior doors, trim & millwork', per: 'sf', share: 0.05, finishW: true }] },
  { key: 'paint',     name: 'Paint (interior & exterior)',        color: '#7c3aed', startWeek: 18,   weeks: 2,   draw: 5,
    items: [{ key: 'paint', label: 'Interior & exterior paint', per: 'sf', share: 0.04, finishW: true }] },
  { key: 'cabinets',  name: 'Cabinets & countertops',            color: '#9333ea', startWeek: 19.5, weeks: 2.5, draw: 5,
    items: [{ key: 'cabinets', label: 'Cabinets & countertops', per: 'ls', share: 0.075, finishW: true }] },
  { key: 'flooring',  name: 'Flooring',                           color: '#16a34a', startWeek: 21,   weeks: 2,   draw: 5,
    items: [{ key: 'flooring', label: 'Flooring (all surfaces)', per: 'sf', share: 0.06, finishW: true }] },
  { key: 'appliances',name: 'Appliances',                         color: '#0891b2', startWeek: 22,   weeks: 1,   draw: 6,
    items: [{ key: 'appliances', label: 'Appliance package', per: 'ls', share: 0.02, finishW: true }] },
  { key: 'landscape', name: 'Landscaping, driveway & flatwork',   color: '#4d7c0f', startWeek: 20,   weeks: 3,   draw: 6,
    items: [{ key: 'landscape', label: 'Driveway, flatwork & landscaping', per: 'sf', share: 0.045 }] },
  { key: 'final',     name: 'Final, cleanup, punch & CO',         color: '#dc2626', startWeek: 23,   weeks: 1.5, draw: 6,
    items: [{ key: 'final', label: 'Final clean, punch list & certificate of occupancy', per: 'ls', share: 0.015 }] },
];

export const DRAW_STAGES = [
  { draw: 1, label: 'Foundation complete' },
  { draw: 2, label: 'Framing & dry-in complete' },
  { draw: 3, label: 'Rough-ins & exterior complete' },
  { draw: 4, label: 'Insulation & drywall complete' },
  { draw: 5, label: 'Interior finishes complete' },
  { draw: 6, label: 'Final & certificate of occupancy' },
];

// Feature → extra hard cost. {ls: flat $} or {perBasementSf: $/sf of basement}; some scale with finish.
export const FEATURES = [
  ['Finished basement', { perBasementSf: 55, draw: 2 }],
  ['3-car garage', { ls: 18000, draw: 2 }],
  ['RV garage / pad', { ls: 22000, draw: 2 }],
  ['Casita / ADU', { ls: 60000, draw: 3 }],
  ['Pool', { ls: 65000, draw: 6 }],
  ['Hot tub / spa', { ls: 12000, draw: 6 }],
  ['Solar', { ls: 22000, draw: 5 }],
  ['Smart home', { ls: 9000, draw: 5 }],
  ['Covered outdoor living', { ls: 16000, draw: 5 }],
  ['Gourmet kitchen upgrade', { ls: 28000, draw: 5 }],
  ['Office / flex room', { ls: 7000, draw: 4 }],
];
const FEATURE_MAP = Object.fromEntries(FEATURES);

// ─── SECTION: budget ───
export function baseHardPsf(region, finish, stories) {
  const r = REGION_BASE_PSF[region] || REGION_BASE_PSF.wasatch;
  const f = FINISH_MULT[finish] || 1;
  const s = STORY_MULT[stories] || 1;
  return r * f * s;
}

// Build the itemized hard-cost line items for a spec. Trade lines total ≈ region/finish $/sf × sqft;
// feature add-ons are separate lines. Normalizes shares so the trade total is exact.
export function computeLineItems(spec) {
  const sqft = clamp(Number(spec.sqft) || 2500, 400, 20000);
  const finish = FINISH_MULT[spec.finish] ? spec.finish : 'mid';
  const stories = STORY_MULT[spec.stories] ? Number(spec.stories) : 1;
  const baths = clamp(Number(spec.bathrooms) || 3, 1, 12);
  const region = REGIONS[spec.region] ? spec.region : 'wasatch';

  const bathMult = 1 + 0.04 * clamp(baths - 2.5, -1, 6); // each bath over ~2.5 adds ~4% (plumbing/fixtures/tile)
  const subMult = submarketMult(region, spec.submarket); // city-level construction-cost nudge
  const totalHard = baseHardPsf(region, finish, stories) * sqft * bathMult * subMult;
  const finishPremium = FINISH_MULT[finish];
  const plumbFactor = 1 + 0.1 * clamp(baths - 2.5, -1, 4); // shifts the mix toward plumbing within the (now bath-scaled) total

  const flat = [];
  for (const ph of PHASES) {
    for (const it of ph.items) {
      let share = it.share;
      if (it.finishW) share *= finishPremium;
      if (it.plumbW) share *= plumbFactor;
      flat.push({ ...it, phaseKey: ph.key, phase: ph.name, eff: share });
    }
  }
  const sum = flat.reduce((a, x) => a + x.eff, 0) || 1;

  const lines = flat.map((x) => {
    const itemTotal = (x.eff / sum) * totalHard;
    if (x.per === 'sf') {
      const unit_price = round2(itemTotal / sqft);
      return { key: x.key, phaseKey: x.phaseKey, phase: x.phase, label: x.label, per: 'sf', qty: sqft, unit: '$/sf', unit_price, total: round0(unit_price * sqft) };
    }
    const unit_price = round0(itemTotal);
    return { key: x.key, phaseKey: x.phaseKey, phase: x.phase, label: x.label, per: 'ls', qty: 1, unit: 'lump', unit_price, total: unit_price };
  });

  const features = Array.isArray(spec.features) ? spec.features : [];
  for (const f of features) {
    const def = FEATURE_MAP[f];
    if (!def) continue;
    let amt = 0;
    if (def.ls) amt = def.ls * (f.includes('kitchen') || f.includes('Casita') ? finishPremium : 1);
    else if (def.perBasementSf) amt = def.perBasementSf * clamp(Number(spec.basementSf) || Math.round(sqft * 0.5), 0, 8000);
    if (amt > 0) {
      lines.push({ key: `feat:${f}`, phaseKey: 'features', phase: 'Upgrades & features', label: f, per: 'ls', qty: 1, unit: 'lump', unit_price: round0(amt), total: round0(amt), draw: def.draw || 6, feature: true });
    }
  }

  const hardTotal = lines.reduce((a, l) => a + (Number(l.total) || 0), 0);
  return { lineItems: lines, hardTotal: round0(hardTotal), costPerSf: round0(hardTotal / sqft) };
}

export const lineItemsTotal = (lines) => round0((lines || []).reduce((a, l) => a + (Number(l.total) || 0), 0));

// ─── SECTION: schedule ───
// Returns editable phase rows. Durations scale slightly with size.
export function computeSchedule(spec) {
  const sqft = clamp(Number(spec.sqft) || 2500, 400, 20000);
  const sizeFactor = clamp(0.85 + (sqft / 2500) * 0.15, 0.85, 1.6);
  return PHASES.map((ph) => ({
    key: ph.key, name: ph.name, color: ph.color, draw: ph.draw,
    startWeek: round2(ph.startWeek * sizeFactor),
    weeks: round2(ph.weeks * sizeFactor),
  }));
}

export const scheduleWeeks = (sched) =>
  round2((sched || []).reduce((mx, p) => Math.max(mx, (Number(p.startWeek) || 0) + (Number(p.weeks) || 0)), 0));

export const scheduleMonths = (sched) => round2(scheduleWeeks(sched) / 4.345);

// ─── SECTION: draw schedule ───
// Group hard-cost lines by their phase's draw milestone; cumulative against hard total.
export function computeDraws(lineItems, hardTotal) {
  const byPhase = {};
  for (const ph of PHASES) byPhase[ph.key] = ph.draw;
  const stageTotals = {};
  for (const l of lineItems || []) {
    const draw = l.draw ?? byPhase[l.phaseKey] ?? 6;
    stageTotals[draw] = (stageTotals[draw] || 0) + (Number(l.total) || 0);
  }
  const total = hardTotal || lineItemsTotal(lineItems) || 1;
  let cum = 0;
  return DRAW_STAGES.map((s) => {
    const amount = round0(stageTotals[s.draw] || 0);
    cum += amount;
    return { draw: s.draw, label: s.label, amount, cumulative: round0(cum), pct: round2((amount / total) * 100), cumulativePct: round2((cum / total) * 100) };
  });
}

// ─── SECTION: financing & returns ───
// Mirrors the deal-modeler math on HomebuildingAnalysis so this plan's numbers line up.
export function computeFinancing({ land, hard, softPct, contingencyPct, arv, ltc, rate, months, sellPct }) {
  const L = Number(land) || 0;
  const H = Number(hard) || 0;
  const soft = H * ((Number(softPct) || 0) / 100);
  const contingency = H * ((Number(contingencyPct) || 0) / 100);
  const total = L + H + soft + contingency;
  const loan = total * ((Number(ltc) || 0) / 100);
  const down = total - loan;
  const monthlyInt = (loan * ((Number(rate) || 0) / 100)) / 12 * 0.6; // ~60% avg drawn balance
  const mo = Number(months) || 12;
  const carry = monthlyInt * mo;
  const reserves = monthlyInt * 6;
  const sale = Number(arv) || 0;
  const sellCost = sale * ((Number(sellPct) || 0) / 100);
  const profit = sale - total - carry - sellCost;
  const margin = sale ? profit / sale : 0;
  const cashNeeded = down + reserves;
  const coc = cashNeeded ? profit / cashNeeded : 0;
  return {
    soft: round0(soft), contingency: round0(contingency), total: round0(total), loan: round0(loan),
    down: round0(down), carry: round0(carry), reserves: round0(reserves), sellCost: round0(sellCost),
    profit: round0(profit), margin, cashNeeded: round0(cashNeeded), coc,
  };
}

// ─── SECTION: default spec + full plan assembly ───
export function defaultSpec(region = 'wasatch') {
  const city = getSubmarket(region, DEFAULT_CITY[region]) || (SUBMARKETS[region] || [])[0] || null;
  return {
    region, submarket: city ? city.name : '', sqft: 2500, stories: 1, bedrooms: 4, bathrooms: 3, finish: 'mid',
    basementSf: 0, lot: city ? city.lot : (region === 'southern' ? 160000 : 250000), softPct: 12, contingencyPct: 5,
    features: [], startDate: '',
    ltc: 75, rate: 11, sellPct: 6,
  };
}

// Build a fresh plan object from a spec (used by "Generate from template" / new project).
export function buildPlanFromSpec(spec) {
  const { lineItems, hardTotal, costPerSf } = computeLineItems(spec);
  const schedule = computeSchedule(spec);
  const months = Math.max(6, Math.round(scheduleMonths(schedule)));
  const draws = computeDraws(lineItems, hardTotal);
  return { lineItems, schedule, draws, hardTotal, costPerSf, months, arv: 0, financingNotes: '' };
}

// ─── SECTION: floor-plan room model ───
// Room types for the drag-and-drop floor-plan builder. bed/bath feed the spec; conditioned:false
// rooms (garage, covered patio) are excluded from conditioned square footage. w/h are default feet.
export const ROOM_TYPES = [
  { key: 'bedroom', name: 'Bedroom',        fill: '#cfe3f7', bed: 1, bath: 0,   conditioned: true,  w: 12, h: 11 },
  { key: 'primary', name: 'Primary suite',  fill: '#bcd6f0', bed: 1, bath: 1,   conditioned: true,  w: 16, h: 14 },
  { key: 'bath',    name: 'Bathroom',       fill: '#c9eede', bed: 0, bath: 1,   conditioned: true,  w: 8,  h: 6 },
  { key: 'half',    name: 'Half bath',      fill: '#d9f0e6', bed: 0, bath: 0.5, conditioned: true,  w: 6,  h: 5 },
  { key: 'kitchen', name: 'Kitchen',        fill: '#f7e6c8', bed: 0, bath: 0,   conditioned: true,  w: 14, h: 12 },
  { key: 'great',   name: 'Great room',     fill: '#e9dcf7', bed: 0, bath: 0,   conditioned: true,  w: 20, h: 16 },
  { key: 'dining',  name: 'Dining',         fill: '#f3ddd0', bed: 0, bath: 0,   conditioned: true,  w: 12, h: 11 },
  { key: 'office',  name: 'Office / flex',  fill: '#e2e8f0', bed: 0, bath: 0,   conditioned: true,  w: 11, h: 10 },
  { key: 'laundry', name: 'Laundry / mud',  fill: '#e7f0d8', bed: 0, bath: 0,   conditioned: true,  w: 8,  h: 7 },
  { key: 'hall',    name: 'Hall / stairs',  fill: '#eceef1', bed: 0, bath: 0,   conditioned: true,  w: 6,  h: 10 },
  { key: 'garage',  name: 'Garage',         fill: '#d6dadf', bed: 0, bath: 0,   conditioned: false, w: 22, h: 22 },
  { key: 'patio',   name: 'Covered patio',  fill: '#dceee0', bed: 0, bath: 0,   conditioned: false, w: 16, h: 10 },
];
const ROOM_MAP = Object.fromEntries(ROOM_TYPES.map((r) => [r.key, r]));
export function roomDef(key) { return ROOM_MAP[key] || null; }

// Normalize either floor-plan shape into an array of levels. The original v1 shape was
// `{ rooms: [] }` (one implicit floor); v2 is `{ levels: [{ key, name, rooms, fixtures }], active }`.
// Old saved plans migrate transparently — their rooms become "Level 1".
export const LEVEL_DEFS = [
  { key: 'basement', name: 'Basement' },
  { key: 'level1', name: 'Level 1' },
  { key: 'level2', name: 'Level 2' },
];

export function floorplanLevels(fp) {
  if (fp && Array.isArray(fp.levels) && fp.levels.length) {
    return fp.levels.map((lv) => ({
      key: lv.key, name: lv.name || lv.key,
      rooms: Array.isArray(lv.rooms) ? lv.rooms : [],
      fixtures: Array.isArray(lv.fixtures) ? lv.fixtures : [],
    }));
  }
  const rooms = fp && Array.isArray(fp.rooms) ? fp.rooms : [];
  return [{ key: 'level1', name: 'Level 1', rooms, fixtures: [] }];
}

// Roll a floor plan up into the numbers the cost engine wants. Sums conditioned room area
// across EVERY level (a finished basement counts as finished living sqft — the planning basis
// the Sync-to-spec button feeds into buildPlanFromSpec, which the user reviews before costing).
export function floorplanTotals(fp) {
  const levels = floorplanLevels(fp);
  let sqft = 0, bedrooms = 0, bathrooms = 0, roomCount = 0;
  for (const lv of levels) {
    for (const r of lv.rooms) {
      roomCount += 1;
      const d = ROOM_MAP[r.type];
      if (!d) continue;
      const area = (Number(r.w) || 0) * (Number(r.h) || 0);
      if (d.conditioned !== false) sqft += area;
      bedrooms += d.bed || 0;
      bathrooms += d.bath || 0;
    }
  }
  return { sqft: Math.round(sqft), bedrooms, bathrooms: Math.round(bathrooms * 2) / 2, rooms: roomCount };
}
