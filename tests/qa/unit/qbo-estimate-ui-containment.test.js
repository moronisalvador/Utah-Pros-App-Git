/**
 * ════════════════════════════════════════════════
 * FILE: qbo-estimate-ui-containment.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps P4c estimate actions honest: QuickBooks mutations appear only behind
 *   the strict durable-command capability, while local conversion still hands
 *   the invoice to the human Save-to-QuickBooks step. It also keeps a persisted
 *   Stripe link from becoming an unverified clickable payment action.
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
  it('strict-gates desktop and native QuickBooks estimate affordances', () => {
    for (const path of estimateSurfaces.slice(0, 2)) {
      const source = read(path);
      expect(source, `${path} must use the strict capability`).toContain("isStrictFeatureEnabled('feature:qbo_document_command_v2')");
      expect(source, `${path} must use the durable Worker helper`).toContain('callQboEstimateWorker');
      expect(source, `${path} must refuse a stale capability`).toContain('documentCommandsEnabledRef.current');
      expect(source, `${path} must not fetch the estimate endpoint directly`).not.toContain("fetch('/api/qbo-estimate'");
    }
    expect(read(estimateSurfaces[2])).toContain('temporarily unavailable');
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

  it('keeps failed estimate retries visible instead of reopening a route-level loading gate', () => {
    const desktop = read('src/pages/EstimateEditor.jsx');
    const native = read('src/pages/tech/NativeOopEstimateReview.jsx');

    expect(desktop).toContain('onRetry={() => load({ silent: true })}');
    expect(native).toContain('onRetry={() => load({ silent: true })}');
    expect(native).toContain('async ({ silent = false } = {})');
    expect(native).toContain('if (!silent) setLoading(true);');
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

  it('keeps the legacy desktop invoice save/send/revert path available while the strict document flag is off', () => {
    const invoice = read('src/pages/InvoiceEditor.jsx');
    expect(invoice).toContain("return callWorker({});");
    expect(invoice).toContain("{canEdit && (");
    expect(invoice).toContain("{canEdit && synced && (");
    expect(invoice).toContain("show: synced");
    expect(invoice).not.toContain("isStrictFeatureEnabled('feature:qbo_document_command_v2')");
    expect(invoice).not.toContain('line_change:');
    expect(invoice).not.toContain('buildInvoiceLineChange');
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
