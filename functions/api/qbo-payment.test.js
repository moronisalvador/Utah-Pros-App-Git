/**
 * ════════════════════════════════════════════════
 * FILE: qbo-payment.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Guards the money worker that pushes a UPR payment into QuickBooks. It checks
 *   three safety properties by reading the worker's source: (1) it refuses a
 *   caller who isn't authorized (no anonymous money moves), (2) it de-duplicates
 *   by a STABLE marker (the existing QBO payment id) so a retry can't double-post,
 *   never by a per-attempt timestamp, and (3) it never writes the payment columns
 *   a database trigger owns (amount_paid / status / paid_at, …).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs
 *   Internal:  ./qbo-payment.js (read as text — the worker makes network calls,
 *              so this is a static/source contract test, not a live invocation)
 *
 * NOTES / GOTCHAS:
 *   - Static assertions on source are intentional: they lock the safety INVARIANTS
 *     (auth gate, stable idempotency, no trigger-owned writes) without a Twilio/QBO
 *     network harness. workers-standard.md §1/§3/§5.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('./qbo-payment.js', import.meta.url)), 'utf8');

// A DB trigger owns these on the payments/invoices side — a worker must never write them.
const TRIGGER_OWNED = ['amount_paid', 'insurance_paid', 'homeowner_paid', 'paid_at'];

describe('qbo-payment worker safety (source contract)', () => {
  it('enforces an auth gate before doing any work', () => {
    expect(src).toMatch(/isAuthorized/);
    // 401 Unauthorized is returned when the gate fails.
    expect(src).toMatch(/Unauthorized'?\s*\}?,\s*401/);
    // The gate accepts the server secret OR a verified Supabase bearer.
    expect(src).toMatch(/x-webhook-secret/);
    expect(src).toMatch(/auth\/v1\/user/);
  });

  it('de-duplicates by a stable content marker, never Date.now()', () => {
    // Reuse-if-already-synced guard = stable idempotency key.
    expect(src).toMatch(/if\s*\(\s*pay\.qbo_payment_id\s*\)/);
    // No Date.now() anywhere (it is not used as an idempotency key here).
    expect(src).not.toMatch(/Date\.now\(\)/);
  });

  it('never writes DB-trigger-owned payment columns', () => {
    for (const col of TRIGGER_OWNED) {
      // Only inspect object-literal writes (`col:`), not substrings of other names.
      expect(src, `must not write ${col}`).not.toMatch(new RegExp(`\\b${col}\\s*:`));
    }
  });
});
