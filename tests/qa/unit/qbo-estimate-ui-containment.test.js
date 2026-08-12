/**
 * ════════════════════════════════════════════════
 * FILE: qbo-estimate-ui-containment.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the first P4c production release honest: estimate pages may preserve
 *   local editing and conversion, but none may offer a QuickBooks estimate
 *   mutation while the durable command boundary is unavailable. It also keeps a
 *   persisted Stripe link from becoming an unverified clickable payment action.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:path, node:url, Vitest
 *   Internal:  InvoiceEditor and the three estimate UI surfaces
 *   Data:      reads → repository source only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Source-contract coverage proves UI containment, not deployed behavior.
 *   - The server remains the enforcement point; this test prevents stale UI
 *     affordances from inviting a request the server must refuse.
 * ════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const estimateSurfaces = [
  'src/pages/EstimateEditor.jsx',
  'src/pages/tech/NativeOopEstimateReview.jsx',
  'src/pages/tech/admin/AdminEstimateDetail.jsx',
];

describe('P4c estimate UI containment', () => {
  it('removes every clickable QuickBooks estimate mutation affordance', () => {
    for (const path of estimateSurfaces) {
      const source = read(path);
      expect(source, `${path} must state the temporary containment`).toContain('temporarily unavailable');
      expect(source, `${path} must not call the contained Worker`).not.toContain("fetch('/api/qbo-estimate'");
      expect(source, `${path} must not render a QuickBooks estimate save control`)
        .not.toMatch(/>\s*Save to QuickBooks\s*</);
      expect(source, `${path} must not offer QuickBooks estimate update`).not.toContain('Update QuickBooks');
      expect(source, `${path} must not offer customer sending`).not.toContain('Send to customer');
      expect(source, `${path} must not offer QBO estimate reversion`).not.toContain('Revert to draft');
    }
  });

  it('preserves the local estimate correction and conversion paths', () => {
    const desktop = read('src/pages/EstimateEditor.jsx');
    const native = read('src/pages/tech/NativeOopEstimateReview.jsx');
    const adminMobile = read('src/pages/tech/admin/AdminEstimateDetail.jsx');

    expect(desktop).toContain("db.update('estimate_line_items'");
    expect(desktop).toContain("db.rpc('convert_estimate_to_invoice'");
    expect(native).toContain("dbRef.current.rpc('correct_oop_estimate'");
    expect(adminMobile).toContain("db.rpc('convert_estimate_to_invoice'");
  });

  it('requires human invoice review and save after local conversion', () => {
    for (const path of [
      'src/pages/EstimateEditor.jsx',
      'src/pages/tech/admin/AdminEstimateDetail.jsx',
    ]) {
      const source = read(path);
      expect(source, `${path} must explain the human invoice-save handoff`)
        .toContain('save to QuickBooks from the invoice page');
      expect(source, `${path} must never call the QBO invoice worker automatically`)
        .not.toContain('callQboInvoiceWorker');
      expect(source, `${path} must never call the QBO invoice endpoint automatically`)
        .not.toContain('/api/qbo-invoice');
    }
  });

  it('never turns a stored Stripe payment-link URL into a clickable payment action', () => {
    const invoice = read('src/pages/InvoiceEditor.jsx');

    expect(invoice).toContain('stripe_payment_link_url');
    expect(invoice).toContain('Do not use the stored URL');
    expect(invoice).not.toMatch(/<a\s+href=\{inv\.stripe_payment_link_url\}/);
  });

  it('removes Xactimate upload and import work while preserving historical recap evidence', () => {
    const invoice = read('src/pages/InvoiceEditor.jsx');

    expect(invoice).toContain('Xactimate import is temporarily unavailable');
    expect(invoice).toContain('xactimate_meta');
    expect(invoice).not.toContain('/api/analyze-xactimate');
    expect(invoice).not.toContain('Import Xactimate');
    expect(invoice).not.toContain('insert_job_document');
    expect(invoice).not.toContain('type="file" accept="application/pdf,.pdf"');
  });

  it('keeps Stripe-projected payments read-only in both billing surfaces', () => {
    const invoice = read('src/pages/InvoiceEditor.jsx');
    const claimBilling = read('src/components/ClaimBilling.jsx');

    for (const source of [invoice, claimBilling]) {
      expect(source).toContain("['qbo', 'stripe'].includes(");
    }
  });
});
