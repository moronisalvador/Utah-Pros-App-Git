/**
 * ════════════════════════════════════════════════
 * FILE: qbo-payment.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Guards the money worker that pushes a UPR payment into QuickBooks. It checks
 *   four safety properties by reading the worker, caller, and shared authorization source:
 *   (1) it refuses a caller who isn't authorized (no anonymous money moves), (2) it de-duplicates
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
 *   Internal:  ./qbo-payment.js, ../lib/qbo-auth.js, InvoiceEditor.jsx,
 *              ClaimBilling.jsx (read as text; route behavior is exercised
 *              separately by qbo-payment-delete-receipt.test.js)
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
const authSrc = readFileSync(fileURLToPath(new URL('../lib/qbo-auth.js', import.meta.url)), 'utf8');
const invoiceEditorSrc = readFileSync(fileURLToPath(new URL('../../src/pages/InvoiceEditor.jsx', import.meta.url)), 'utf8');
const claimBillingSrc = readFileSync(fileURLToPath(new URL('../../src/components/ClaimBilling.jsx', import.meta.url)), 'utf8');

// A DB trigger owns these on the payments/invoices side — a worker must never write them.
const TRIGGER_OWNED = ['amount_paid', 'insurance_paid', 'homeowner_paid', 'paid_at'];

describe('qbo-payment worker safety (source contract)', () => {
  it('enforces an auth gate before doing any work', () => {
    expect(src).toMatch(/const auth = await authorizeQboRequest/);
    expect(src.indexOf('const auth = await authorizeQboRequest'))
      .toBeLessThan(src.indexOf('const conn = await getConnection'));
    expect(authSrc).toMatch(/QBO_WEBHOOK_SECRET/);
    expect(authSrc).toMatch(/requireRole/);
    expect(authSrc).toMatch(/is_external/);
  });

  it('uses a stable provider request id and never Date.now()', () => {
    // Reuse-if-already-synced guard = stable idempotency key.
    expect(src).toMatch(/if\s*\(\s*pay\.qbo_payment_id\s*\)/);
    expect(src).toMatch(/requestId:\s*`uprp-\$\{String\(paymentId\)\.toLowerCase\(\)\}`/);
    // No Date.now() anywhere (it is not used as an idempotency key here).
    expect(src).not.toMatch(/Date\.now\(\)/);
  });

  it('bounds database calls and does not return raw provider errors', () => {
    expect(src).toMatch(/supabase\(env,\s*fetchWithTimeout\)/);
    expect(src).not.toMatch(/jsonResponse\(\{\s*error:\s*e\.message/);
    expect(src).toMatch(/publicPaymentError\(e\)/);
    expect(src).toMatch(/function persistedPaymentFailure/);
    expect(src).toContain("'qbo_payment_push_failed'");
    expect(src).not.toMatch(/qbo_sync_error:\s*\(e\.message/);
  });

  it('never writes DB-trigger-owned payment columns', () => {
    for (const col of TRIGGER_OWNED) {
      // Only inspect object-literal writes (`col:`), not substrings of other names.
      expect(src, `must not write ${col}`).not.toMatch(new RegExp(`\\b${col}\\s*:`));
    }
  });

  it('keeps QuickBooks-linked payments out of the local edit/delete escape hatches', () => {
    const invoiceEdit = invoiceEditorSrc.slice(
      invoiceEditorSrc.indexOf('const recordPayment = async'),
      invoiceEditorSrc.indexOf('// The deliberate "Edit" step'),
    );
    const invoiceDelete = invoiceEditorSrc.slice(
      invoiceEditorSrc.indexOf('const deleteEditingPayment = async'),
      invoiceEditorSrc.indexOf('// Open the modal straight'),
    );
    const claimDelete = claimBillingSrc.slice(
      claimBillingSrc.indexOf('const deletePayment = async'),
      claimBillingSrc.indexOf('\n  if (loading)'),
    );

    expect(invoiceEdit.indexOf('if (editing && payForm.qbo_payment_id)'))
      .toBeLessThan(invoiceEdit.indexOf("await db.update('payments'"));
    expect(invoiceDelete.indexOf('if (payForm.qbo_payment_id)'))
      .toBeLessThan(invoiceDelete.indexOf("await db.delete('payments'"));
    expect(claimDelete.indexOf('if (pay.qbo_payment_id)'))
      .toBeLessThan(claimDelete.indexOf("await db.delete('payments'"));
    expect(invoiceDelete).not.toContain("action: 'delete'");
    expect(claimDelete).not.toContain("action: 'delete'");
    expect(invoiceEditorSrc).toContain('!!payView.qbo_payment_id');
  });
});
