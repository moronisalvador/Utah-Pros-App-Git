// Shared pricing logic for the OOP Pricing Calculator.
// Imported by both the desktop page (src/pages/OOPPricing.jsx) and the
// mobile tech page (src/pages/tech/TechOOPPricing.jsx). Keep this the
// single source of truth — never inline these numbers elsewhere.

// Customer-facing rates
export const RATES = {
  airMover: 25,
  lgr: 80,
  xlgr: 125,
  airScrubber: 75,
  negAir: 110,                      // mold only (includes built-in air scrubber)
  antimicrobialPerSqft: 0.35,
  disposalPerTrip: 125,
  containmentPerLft: 2.00,          // mold only
  materialsMarkup: 1.25,            // 25% markup over actual cost
  ppeMultiplier: 0.05,              // mold only, of laborLine
};

// Internal cost model — hidden from customer, used for margin analysis
export const COSTS = {
  effectiveLaborCost: 51,           // fully loaded tech cost ÷ utilization
  overheadRate: 0.33,               // 33% of revenue
  antimicrobialCostPerSqft: 0.15,
  disposalCostPerTrip: 50,
  containmentCostPerLft: 1.20,      // mold only
  ppeCostMultiplier: 0.02,          // mold only, of laborLine
  // PRV invoice cost is pass-through 1.0 — uses the raw value
};

// Blank form state
export const BLANK = {
  jobType: 'water',
  insuredName: '',
  address: '',
  techHours: '',
  billRate: '92',
  airMoverCount: '', airMoverDays: '',
  lgrCount: '', lgrDays: '',
  xlgrCount: '', xlgrDays: '',
  airScrubberCount: '', airScrubberDays: '',
  negAirCount: '', negAirDays: '',
  materialsActualCost: '',
  antimicrobialSqft: '',
  disposalTrips: '',
  containmentLinearFt: '',
  prvInvoiceCost: '',
  notes: '',
};

// Safe numeric conversion — returns 0 for empty / NaN
export const toNum = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

// Input validation regexes
export const isDecimal = (v) => v === '' || /^\d*\.?\d*$/.test(v);
export const isInt = (v) => v === '' || /^\d*$/.test(v);

// Pure calculation — returns { lines, quote, internal }
export function calcQuote(i) {
  const isMold = i.jobType === 'mold';
  const techHours = toNum(i.techHours);
  const billRate = toNum(i.billRate);

  const laborLine = techHours * billRate;

  const equipment =
    toNum(i.airMoverCount) * toNum(i.airMoverDays) * RATES.airMover +
    toNum(i.lgrCount) * toNum(i.lgrDays) * RATES.lgr +
    toNum(i.xlgrCount) * toNum(i.xlgrDays) * RATES.xlgr +
    toNum(i.airScrubberCount) * toNum(i.airScrubberDays) * RATES.airScrubber +
    (isMold ? toNum(i.negAirCount) * toNum(i.negAirDays) * RATES.negAir : 0);

  const materialsLine     = toNum(i.materialsActualCost) * RATES.materialsMarkup;
  const antimicrobialLine = toNum(i.antimicrobialSqft) * RATES.antimicrobialPerSqft;
  const disposalLine      = toNum(i.disposalTrips) * RATES.disposalPerTrip;
  const containmentLine   = isMold ? toNum(i.containmentLinearFt) * RATES.containmentPerLft : 0;
  const ppeLine           = isMold ? laborLine * RATES.ppeMultiplier : 0;

  const quote = laborLine + equipment + materialsLine + antimicrobialLine
              + disposalLine + containmentLine + ppeLine;

  // Internal cost breakdown
  const directLaborCost   = techHours * COSTS.effectiveLaborCost;
  const materialsCost     = toNum(i.materialsActualCost);
  const antimicrobialCost = toNum(i.antimicrobialSqft) * COSTS.antimicrobialCostPerSqft;
  const disposalCost      = toNum(i.disposalTrips) * COSTS.disposalCostPerTrip;
  const containmentCost   = isMold ? toNum(i.containmentLinearFt) * COSTS.containmentCostPerLft : 0;
  const ppeCost           = isMold ? laborLine * COSTS.ppeCostMultiplier : 0;
  const prvCost           = isMold ? toNum(i.prvInvoiceCost) : 0;

  const totalDirectCost = directLaborCost + materialsCost + antimicrobialCost
                        + disposalCost + containmentCost + ppeCost + prvCost;
  const overheadAlloc   = quote * COSTS.overheadRate;
  const netProfit       = quote - totalDirectCost - overheadAlloc;
  // null when quote is 0 → UI shows "—" instead of divide-by-zero or NaN
  const netMarginPct    = quote > 0 ? (netProfit / quote) * 100 : null;

  return {
    lines: {
      laborLine, equipment, materialsLine, antimicrobialLine,
      disposalLine, containmentLine, ppeLine,
    },
    quote,
    internal: {
      directLaborCost, materialsCost, antimicrobialCost, disposalCost,
      containmentCost, ppeCost, prvCost, totalDirectCost, overheadAlloc,
      netProfit, netMarginPct,
    },
  };
}

// Margin thresholds
export function tierFor(pct) {
  if (pct == null) return 'none';
  if (pct >= 20) return 'green';
  if (pct >= 10) return 'amber';
  return 'red';
}

export const TIER_COLORS = {
  green: { bg: '#ecfdf5', fg: '#059669', border: '#a7f3d0' },
  amber: { bg: '#fffbeb', fg: '#d97706', border: '#fde68a' },
  red:   { bg: '#fef2f2', fg: '#dc2626', border: '#fecaca' },
  none:  { bg: 'var(--bg-tertiary)', fg: 'var(--text-tertiary)', border: 'var(--border-light)' },
};

// Map a job.division to the calculator's job_type value. Defaults to water.
export function divisionToJobType(division) {
  if (division === 'mold') return 'mold';
  if (division === 'water') return 'water';
  return 'water';
}

// Hydrate form state from a saved quote row (from get_oop_quote RPC)
export function formFromQuoteRow(row) {
  return {
    jobType: row.job_type || 'water',
    insuredName: row.insured_name || '',
    address: row.address || '',
    techHours: row.tech_hours != null ? String(row.tech_hours) : '',
    billRate: row.bill_rate != null ? String(row.bill_rate) : '92',
    airMoverCount: row.air_mover_count || '', airMoverDays: row.air_mover_days || '',
    lgrCount: row.lgr_count || '', lgrDays: row.lgr_days || '',
    xlgrCount: row.xlgr_count || '', xlgrDays: row.xlgr_days || '',
    airScrubberCount: row.air_scrubber_count || '', airScrubberDays: row.air_scrubber_days || '',
    negAirCount: row.neg_air_count || '', negAirDays: row.neg_air_days || '',
    materialsActualCost: row.materials_actual_cost != null ? String(row.materials_actual_cost) : '',
    antimicrobialSqft:   row.antimicrobial_sqft   != null ? String(row.antimicrobial_sqft)   : '',
    disposalTrips:       row.disposal_trips       || '',
    containmentLinearFt: row.containment_linear_ft != null ? String(row.containment_linear_ft) : '',
    prvInvoiceCost:      row.prv_invoice_cost      != null ? String(row.prv_invoice_cost)      : '',
    notes: row.notes || '',
  };
}

// Build the param payload for upsert_oop_quote RPC from form state
export function paramsForUpsert({ form, quoteId, jobId, calc, employeeId }) {
  const isMold = form.jobType === 'mold';
  return {
    p_id: quoteId || null,
    p_job_id: jobId || null,
    p_job_type: form.jobType,
    p_insured_name: form.insuredName || null,
    p_address: form.address || null,
    p_tech_hours: toNum(form.techHours),
    p_bill_rate: toNum(form.billRate),
    p_air_mover_count: toNum(form.airMoverCount), p_air_mover_days: toNum(form.airMoverDays),
    p_lgr_count: toNum(form.lgrCount), p_lgr_days: toNum(form.lgrDays),
    p_xlgr_count: toNum(form.xlgrCount), p_xlgr_days: toNum(form.xlgrDays),
    p_air_scrubber_count: toNum(form.airScrubberCount), p_air_scrubber_days: toNum(form.airScrubberDays),
    p_neg_air_count: isMold ? toNum(form.negAirCount) : 0,
    p_neg_air_days:  isMold ? toNum(form.negAirDays)  : 0,
    p_materials_actual_cost: toNum(form.materialsActualCost),
    p_antimicrobial_sqft: toNum(form.antimicrobialSqft),
    p_disposal_trips: toNum(form.disposalTrips),
    p_containment_linear_ft: isMold ? toNum(form.containmentLinearFt) : 0,
    p_prv_invoice_cost:      isMold ? toNum(form.prvInvoiceCost)      : 0,
    p_quote_total: calc.quote,
    p_net_margin_pct: calc.internal.netMarginPct,
    p_notes: form.notes || null,
    p_created_by: employeeId || null,
  };
}
