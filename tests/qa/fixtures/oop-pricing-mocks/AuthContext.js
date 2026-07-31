/**
 * ════════════════════════════════════════════════
 * FILE: AuthContext.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives the local OOP calculator test a made-up technician and a small,
 *   fixed price list. It never connects to an account or database.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → synthetic fixture state only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Every identifier and claim in this file is synthetic.
 * ════════════════════════════════════════════════
 */
const item = (key, label, section, sortOrder, formula, unit, standardRate, extra = {}) => ({
  key,
  label,
  helpText: `Synthetic fixture only — ${label}; long configuration copy must wrap without clipping on a narrow field phone.`,
  section,
  sortOrder,
  jobTypes: ['water', 'mold'],
  formula,
  unit,
  standardRate,
  internalRate: 0,
  internalCostBasis: 'none',
  minimumQuantity: 0,
  minimumCharge: 0,
  defaultQuantity: 0,
  defaultDays: 0,
  percentageBase: null,
  customerVisible: true,
  active: true,
  priceOverrideAllowed: false,
  ...extra,
});

const config = {
  schemaVersion: 1,
  name: 'Synthetic configurable water and mold emergency pricing list with intentionally long display text',
  projectMinimums: { water: 425, mold: 575 },
  items: [
    item('emergency_labor', 'Emergency extraction labor with long gloved-hand label', 'Emergency response and containment', 10, 'quantity', 'hour', 95, { priceOverrideAllowed: true }),
    item('air_movers', 'High-velocity structural drying air movers', 'Drying equipment', 20, 'duration', 'day', 28, { defaultDays: 3 }),
    item('sanitizing', 'Antimicrobial cleaning and occupant-protection treatment', 'Materials and protection', 30, 'fixed', 'service', 165),
    item('costs', 'Pass-through specialty material purchase', 'Materials and protection', 40, 'cost_plus', 'cost', 1.25),
  ],
};

const claims = [{
  id: '11111111-1111-4111-8111-111111111111',
  claim_number: 'SYN-0001',
  insured_name: 'Synthetic Long-Name Homeowner for Narrow Layout QA',
  loss_address: '1234 Deterministic Fixture Boulevard',
  loss_city: 'Salt Lake City',
  loss_state: 'UT',
}];

export function useAuth() {
  return {
    employee: { id: '22222222-2222-4222-8222-222222222222', role: 'field_tech' },
    db: {
      async rpc(name) {
        if (name === 'get_oop_pricing_config') {
          return { id: '33333333-3333-4333-8333-333333333333', revision_number: 1, config };
        }
        if (name === 'get_claims_list') return claims;
        if (name === 'get_claim_jobs') return { jobs: [] };
        throw new Error(`Synthetic QA fixture does not permit RPC ${name}`);
      },
      async select() { return []; },
    },
  };
}
