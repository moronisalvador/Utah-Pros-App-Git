/**
 * ════════════════════════════════════════════════
 * FILE: invoice-qbo-sync-display.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Guards the three screens that show whether an invoice is in QuickBooks and
 *   whether the customer has actually been emailed it (the desktop invoice page,
 *   the claim billing panel, and the admin phone view), so they never again call
 *   a live QuickBooks invoice "Not synced" or a genuinely-emailed invoice
 *   "Not emailed".
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  src/lib/invoiceEmailStatus.js (imported and actually run),
 *              plus the three page/component sources read as text
 *
 * NOTES / GOTCHAS:
 *   - Real incident, 2026-08-07: UPR invoice INV-000065 (qbo_doc_number
 *     W-2606-005) carried qbo_invoice_id 4839 with a null sent_at and displayed
 *     "Not synced", which misdirected a live payment investigation. The same
 *     invoice read "Not emailed" while QuickBooks reported EmailStatus =
 *     EmailSent to invoices@presidiopm.com — an address that never appeared in
 *     UPR, whose contact email is leuri@a2zrepm.com.
 *   - The email half is now BEHAVIORAL: invoiceEmailState/qboBillEmailMismatch
 *     are imported and exercised, which is real proof rather than a regex over
 *     source text. Only the "is each surface wired to that helper" question is
 *     left to source assertions, because rendering the three pages would need a
 *     DOM, a router, and an authenticated db client.
 *   - The "In QuickBooks" assertions stay source-text, matching the sibling
 *     loading-state contracts. They pin intent in a credential-free lane; they
 *     are not a rendering proof.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  invoiceEmailState,
  qboBillEmailMismatch,
  qboBillEmailMismatchText,
} from '../../../src/lib/invoiceEmailStatus.js';

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

// ─── SECTION: The shared email-truth helper (behavioral) ──────────────

describe('invoiceEmailState', () => {
  it('reports a UPR-triggered send with its timestamp', () => {
    const state = invoiceEmailState({ qbo_emailed_at: '2026-08-05T17:00:00Z' });
    expect(state.kind).toBe('upr-sent');
    expect(state.at).toBe('2026-08-05T17:00:00Z');
  });

  it('prefers the UPR timestamp over QuickBooks status when both exist', () => {
    // UPR knows strictly more here: it has the exact time as well as the fact.
    const state = invoiceEmailState({
      qbo_emailed_at: '2026-08-05T17:00:00Z',
      qbo_email_status: 'EmailSent',
      qbo_email_checked_at: '2026-08-07T12:00:00Z',
    });
    expect(state.kind).toBe('upr-sent');
  });

  it('still reports the UPR send when QuickBooks later says NotSet', () => {
    // The send happened; a later QBO edit resetting EmailStatus does not unsend it.
    const state = invoiceEmailState({
      qbo_emailed_at: '2026-08-05T17:00:00Z',
      qbo_email_status: 'NotSet',
      qbo_email_checked_at: '2026-08-07T12:00:00Z',
    });
    expect(state.kind).toBe('upr-sent');
  });

  // THE INCIDENT CASE: emailed from inside QuickBooks, never sent from UPR.
  it('reports a QuickBooks-side send instead of claiming it was never emailed', () => {
    const state = invoiceEmailState({
      qbo_emailed_at: null,
      qbo_email_status: 'EmailSent',
      qbo_email_checked_at: '2026-08-07T12:00:00Z',
    });
    expect(state.kind).toBe('qbo-sent');
    expect(state.label).toBe('Sent from QuickBooks');
    expect(state.at).toBeNull();
    expect(state.label).not.toMatch(/not emailed/i);
  });

  it('matches QuickBooks EmailStatus case-insensitively', () => {
    expect(invoiceEmailState({ qbo_email_status: 'emailsent' }).kind).toBe('qbo-sent');
    expect(invoiceEmailState({ qbo_email_status: '  EmailSent  ' }).kind).toBe('qbo-sent');
  });

  it('distinguishes QuickBooks NeedToSend from both sent and not-sent', () => {
    const state = invoiceEmailState({ qbo_email_status: 'NeedToSend' });
    expect(state.kind).toBe('qbo-queued');
    expect(state.label).toBe('Queued in QuickBooks');
  });

  it('says "Not emailed" only once QuickBooks has actually been asked', () => {
    const state = invoiceEmailState({
      qbo_emailed_at: null,
      qbo_email_status: 'NotSet',
      qbo_email_checked_at: '2026-08-07T12:00:00Z',
    });
    expect(state.kind).toBe('not-emailed');
    expect(state.label).toBe('Not emailed');
  });

  // The distinction the original bug collapsed: "we never looked" is not "not emailed".
  it('scopes the claim to UPR when QuickBooks has never been observed', () => {
    for (const inv of [{}, { qbo_emailed_at: null }, { qbo_email_status: null }]) {
      const state = invoiceEmailState(inv);
      expect(state.kind).toBe('unknown');
      expect(state.label).toBe('Not emailed from UPR');
    }
  });

  it('never asserts "Not emailed" bare on an unobserved invoice', () => {
    expect(invoiceEmailState({}).label).not.toBe('Not emailed');
  });

  it('survives a null or undefined invoice', () => {
    expect(invoiceEmailState(null).kind).toBe('unknown');
    expect(invoiceEmailState(undefined).kind).toBe('unknown');
  });

  // This UI ships to dev BEFORE migration 20260807190000 is applied, so every
  // invoice row arrives without the two new columns. Behaviour must be exactly
  // what it was before this change — not a crash, and not a new claim.
  it('behaves exactly as before while the migration is unapplied', () => {
    const preApply = { qbo_emailed_at: null, qbo_email_status: null };  // no new columns
    expect(invoiceEmailState(preApply).label).toBe('Not emailed from UPR');
    expect(qboBillEmailMismatch(preApply, 'leuri@a2zrepm.com')).toBeNull();

    const preApplySent = { qbo_emailed_at: '2026-08-05T17:00:00Z', qbo_email_status: 'EmailSent' };
    expect(invoiceEmailState(preApplySent).kind).toBe('upr-sent');
  });
});

describe('qboBillEmailMismatch', () => {
  // The exact 2026-08-07 pair that nobody could see from inside UPR.
  it('flags the real incident pair', () => {
    const hit = qboBillEmailMismatch(
      { qbo_bill_email: 'invoices@presidiopm.com' },
      'leuri@a2zrepm.com',
    );
    expect(hit).toEqual({
      qboEmail: 'invoices@presidiopm.com',
      contactEmail: 'leuri@a2zrepm.com',
    });
    expect(qboBillEmailMismatchText(hit)).toContain('invoices@presidiopm.com');
    expect(qboBillEmailMismatchText(hit)).toContain('leuri@a2zrepm.com');
  });

  it('does not flag the same address in different casing or padding', () => {
    expect(qboBillEmailMismatch({ qbo_bill_email: 'A@B.com' }, 'a@b.com')).toBeNull();
    expect(qboBillEmailMismatch({ qbo_bill_email: ' a@b.com ' }, 'a@b.com')).toBeNull();
  });

  // An unknown address is not a discrepancy; flagging it would train people to
  // ignore the flag, which costs more than the flag is worth.
  it('stays silent when either address is unknown', () => {
    expect(qboBillEmailMismatch({ qbo_bill_email: null }, 'a@b.com')).toBeNull();
    expect(qboBillEmailMismatch({ qbo_bill_email: 'a@b.com' }, null)).toBeNull();
    expect(qboBillEmailMismatch({ qbo_bill_email: '  ' }, 'a@b.com')).toBeNull();
    expect(qboBillEmailMismatch({}, '')).toBeNull();
    expect(qboBillEmailMismatch(null, 'a@b.com')).toBeNull();
  });

  it('preserves original casing in what it reports back', () => {
    const hit = qboBillEmailMismatch({ qbo_bill_email: 'Billing@Corp.com' }, 'owner@home.com');
    expect(hit.qboEmail).toBe('Billing@Corp.com');
  });

  it('renders nothing for a null mismatch', () => {
    expect(qboBillEmailMismatchText(null)).toBe('');
  });
});

// ─── SECTION: Each surface is wired to that helper ──────────────

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

  it('takes the Emailed label from the shared helper, not from one column', () => {
    expect(source).toContain("from '@/lib/invoiceEmailStatus'");
    expect(source).toMatch(/const emailState = invoiceEmailState\(inv\)/);

    const line = fieldLine(source, row, 'Emailed');
    expect(line).toContain("emailState.kind === 'upr-sent'");
    expect(line).toContain('emailState.label');

    // Reading qbo_emailed_at directly here is the regression: it cannot see a
    // send made from inside QuickBooks, and hard-coding a label from it is how
    // "Not emailed" got asserted about an invoice QuickBooks had emailed.
    expect(line).not.toContain('inv.qbo_emailed_at');
    expect(line).not.toContain("'Not emailed");
  });

  it('surfaces a QuickBooks BillEmail that disagrees with the contact on file', () => {
    expect(source).toMatch(/qboBillEmailMismatch\(inv, /);
    expect(source).toContain('qboBillEmailMismatchText(billEmailMismatch)');
    // Rendered conditionally — a null mismatch must not draw an empty warning.
    expect(source).toMatch(/\{billEmailMismatch && \(/);
  });
});
