/**
 * ════════════════════════════════════════════════
 * FILE: invoice-qbo-sync-display.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Guards the three screens that show whether an invoice is in QuickBooks
 *   (the desktop invoice page, the claim billing panel, and the admin phone
 *   view) so they never again call a live QuickBooks invoice "Not synced".
 *   Invoices that were written in QuickBooks first and later linked to UPR have
 *   a QuickBooks id but no UPR "sent" timestamp, so the timestamp is the wrong
 *   thing to ask. The real answer is whether the invoice has a QuickBooks id.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  reads the three page/component sources as text (no rendering)
 *
 * NOTES / GOTCHAS:
 *   - Real incident, 2026-08-07: UPR invoice INV-000065 (qbo_doc_number
 *     W-2606-005) carried qbo_invoice_id 4839 with a null sent_at and displayed
 *     "Not synced", which misdirected a live payment investigation.
 *   - "Emailed" reads invoices.qbo_emailed_at, which functions/api/qbo-invoice.js
 *     stamps ONLY on a UPR-triggered send. An email sent from inside QuickBooks
 *     never reaches that column, so the empty label must stay scoped to UPR
 *     rather than claiming the customer was never emailed at all.
 *   - Source-text assertions, like the sibling loading-state contracts: they pin
 *     intent in a credential-free lane. They are not a rendering proof.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');

// Each surface renders the same two fields through its own row component.
const SURFACES = [
  { file: 'src/pages/InvoiceEditor.jsx', row: 'Field' },
  { file: 'src/components/ClaimBilling.jsx', row: 'ARField' },
  { file: 'src/pages/tech/admin/AdminInvoiceDetail.jsx', row: 'MetaRow' },
];

/** The single rendered line for `label`, comments and whitespace excluded. */
function fieldLine(source, row, label) {
  const line = source
    .split('\n')
    .find((l) => l.includes(`<${row} label="${label}"`) && !l.trimStart().startsWith('//'));
  expect(line, `${row} label="${label}" not found`).toBeTruthy();
  return line;
}

describe.each(SURFACES)('$file — QuickBooks sync display', ({ file, row }) => {
  const source = readFileSync(join(ROOT, file), 'utf8');

  it('derives synced from qbo_invoice_id, not from a UPR timestamp', () => {
    expect(source).toMatch(/const synced = !!inv\??\.qbo_invoice_id;/);
  });

  it('reports a QuickBooks-linked invoice as synced even with no sent_at', () => {
    const line = fieldLine(source, row, 'In QuickBooks');

    // The gate is the QuickBooks link; sent_at only refines the label to a date.
    expect(line).toContain('synced ?');
    expect(line).toContain("'Synced'");
    expect(line).toContain("'Not synced'");

    // The exact regressed form: sent_at alone deciding synced-vs-not.
    expect(line).not.toMatch(/inv\.sent_at \? fmtDate\(inv\.sent_at\) : 'Not synced'/);

    // "Not synced" must be reachable only through the falsy-synced branch.
    const notSyncedIdx = line.indexOf("'Not synced'");
    expect(notSyncedIdx).toBeGreaterThan(line.indexOf('synced ?'));
  });

  it('scopes the empty Emailed label to UPR, since QBO-side sends are invisible', () => {
    const line = fieldLine(source, row, 'Emailed');

    expect(line).toContain('inv.qbo_emailed_at');
    expect(line).toContain("'Not emailed from UPR'");
    // A bare "Not emailed" would assert something this column cannot know.
    expect(line).not.toMatch(/: 'Not emailed'/);
  });
});
