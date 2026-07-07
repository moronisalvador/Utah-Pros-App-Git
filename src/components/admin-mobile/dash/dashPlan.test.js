/**
 * ════════════════════════════════════════════════
 * FILE: dashPlan.test.js  (Admin Mobile — finding F-2 financial-gate tests)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the mobile admin dashboard can never leak money data to an admin who
 *   isn't allowed to see it. When financial access is off, the money cards are
 *   dropped from the plan entirely, so NONE of the money RPCs are in the set the
 *   dashboard will fetch — and when it's on, all four money cards (and their RPCs)
 *   come back. This is the binding P1 acceptance test for finding F-2.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./dashPlan (visibleDashWidgets / plannedRpcs / FINANCIAL_RPCS)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - These are the named tests bound by finding F-2 in
 *     docs/admin-mobile-roadmap.md (Phase P1) — do not weaken them.
 *   - Plain-node vitest (no jsdom): dashPlan is a pure decision module by design,
 *     which is exactly why the render+fetch gate lives there.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  DASH_WIDGETS, FINANCIAL_RPCS, visibleDashWidgets, plannedRpcs,
} from './dashPlan';

const FINANCIAL_KEYS = ['revenue', 'payments', 'avgTicket', 'collections'];

describe('visibleDashWidgets — financial gate (finding F-2)', () => {
  it('DROPS every financial card when overview_financials is absent (not rendered)', () => {
    const keys = visibleDashWidgets(false).map((w) => w.key);
    for (const k of FINANCIAL_KEYS) expect(keys).not.toContain(k);
    // the operational cards still show
    expect(keys).toContain('jobsClosed');
    expect(keys).toContain('employeeStatus');
    // and none of the surviving cards is a financial one
    expect(visibleDashWidgets(false).some((w) => w.fin)).toBe(false);
  });

  it('SHOWS all eleven cards, financial first, when overview_financials is granted', () => {
    const keys = visibleDashWidgets(true).map((w) => w.key);
    expect(keys).toEqual(DASH_WIDGETS.map((w) => w.key));
    for (const k of FINANCIAL_KEYS) expect(keys).toContain(k);
  });

  it('requires canFin to be STRICTLY true (any other value denies)', () => {
    for (const v of [undefined, null, 0, '', 'yes', 1]) {
      const keys = visibleDashWidgets(v).map((w) => w.key);
      for (const k of FINANCIAL_KEYS) expect(keys).not.toContain(k);
    }
  });
});

describe('plannedRpcs — the fetch set tracks the gate (finding F-2)', () => {
  it('fetches NONE of the financial RPCs when access is absent', () => {
    const rpcs = plannedRpcs(false);
    for (const rpc of FINANCIAL_RPCS) expect(rpcs).not.toContain(rpc);
    expect(FINANCIAL_RPCS).toEqual([
      'get_revenue_by_division', 'get_payments_received', 'get_avg_ticket', 'get_ar_invoices',
    ]);
    // the non-financial RPCs are still planned
    expect(rpcs).toContain('get_jobs_closed');
    expect(rpcs).toContain('get_tech_status_board');
  });

  it('fetches every financial RPC exactly once when access is granted', () => {
    const rpcs = plannedRpcs(true);
    for (const rpc of FINANCIAL_RPCS) expect(rpcs.filter((r) => r === rpc)).toHaveLength(1);
  });

  it('marks exactly the four money cards as financial', () => {
    expect(DASH_WIDGETS.filter((w) => w.fin).map((w) => w.key)).toEqual(FINANCIAL_KEYS);
  });
});
