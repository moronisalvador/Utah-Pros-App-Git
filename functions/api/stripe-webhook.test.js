/**
 * ════════════════════════════════════════════════
 * FILE: stripe-webhook.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Guards the money worker that receives Stripe's payment webhook. It checks
 *   three safety properties by reading the worker's source: (1) it verifies
 *   Stripe's signature and stays dormant-safe (503) until keys exist, (2) it
 *   de-duplicates each event by Stripe's own event id (a stable key) so a repeated
 *   delivery no-ops instead of double-booking money, never by a per-attempt
 *   timestamp, and (3) it never writes the payment columns a database trigger owns.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs
 *   Internal:  ./stripe-webhook.js (read as text — the worker makes network calls,
 *              so this is a static/source contract test, not a live invocation)
 *
 * NOTES / GOTCHAS:
 *   - `Date.now()` DOES legitimately appear (a date fallback in `ymd`), so we do
 *     not ban it wholesale — we assert the idempotency key is the Stripe event id
 *     via claim_stripe_event, not a timestamp. workers-standard.md §1/§3/§5.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('./stripe-webhook.js', import.meta.url)), 'utf8');

const TRIGGER_OWNED = ['amount_paid', 'insurance_paid', 'homeowner_paid', 'paid_at'];

describe('stripe-webhook worker safety (source contract)', () => {
  it('verifies the Stripe signature and is dormant-safe', () => {
    expect(src).toMatch(/constructEvent/);
    expect(src).toMatch(/STRIPE_WEBHOOK_SECRET/);
    // 503 until Stripe keys exist (dormant) + 400 on a bad signature.
    expect(src).toMatch(/503/);
    expect(src).toMatch(/signature/i);
  });

  it('idempotency is keyed on the Stripe event id, not a timestamp', () => {
    expect(src).toMatch(/claim_stripe_event/);
    expect(src).toMatch(/p_id:\s*event\.id/);
    // The idempotency claim must not be built from Date.now().
    expect(src).not.toMatch(/claim_stripe_event[^\n]*Date\.now/);
  });

  it('never writes DB-trigger-owned payment columns', () => {
    for (const col of TRIGGER_OWNED) {
      expect(src, `must not write ${col}`).not.toMatch(new RegExp(`\\b${col}\\s*:`));
    }
  });
});
