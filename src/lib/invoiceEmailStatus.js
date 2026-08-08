/**
 * ════════════════════════════════════════════════
 * FILE: invoiceEmailStatus.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Answers two questions about an invoice, the same way on every screen that
 *   asks them: "has the customer actually been emailed this?" and "is QuickBooks
 *   emailing an address that isn't the one we have on file for this customer?"
 *
 *   The second question matters more than it looks. On 2026-08-07 an invoice read
 *   "Not emailed" in UPR while QuickBooks had emailed it to invoices@presidiopm.com
 *   — an address nobody in UPR could see, because the customer contact here says
 *   leuri@a2zrepm.com. Two different answers to "who gets our invoices", and no
 *   way to notice from inside UPR.
 *
 * DEPENDS ON:
 *   Packages:  none (pure functions, no React, no data access)
 *   Internal:  none
 *   Data:      reads → the invoice row fields listed below; writes → nothing
 *
 * NOTES / GOTCHAS:
 *   - The three surfaces that use this each format dates their own way
 *     (collTokens fmtDate, a local fmtDate, invoiceMath fmtDate), so this returns
 *     WHEN as a raw timestamp and lets the caller format it. It never formats.
 *   - The two columns mean different things and neither replaces the other:
 *       qbo_emailed_at      — UPR triggered the send, so we know the exact time.
 *       qbo_email_status    — what QuickBooks itself reports (NotSet /
 *                             NeedToSend / EmailSent), whoever sent it.
 *       qbo_email_checked_at— when UPR last looked. NULL is the honest "we have
 *                             never asked QuickBooks", which is NOT the same
 *                             answer as "QuickBooks says it was never emailed".
 *     Collapsing that last distinction is the original bug; keep the four kinds.
 *   - A QuickBooks-side send has no timestamp UPR can trust, so 'qbo-sent' carries
 *     no date rather than borrowing an unrelated one.
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Helpers ──────────────

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const key = (value) => clean(value).toLowerCase();

// ─── SECTION: Exports ──────────────

/**
 * What we can honestly say about this invoice reaching the customer by email.
 *
 * @param {object} inv an invoices row
 * @returns {{kind: 'upr-sent'|'qbo-sent'|'qbo-queued'|'not-emailed'|'unknown',
 *            at: string|null, label: string}}
 *   `kind === 'upr-sent'` carries `at`; every other kind carries a finished
 *   `label` and a null `at`.
 */
export function invoiceEmailState(inv) {
  // UPR sent it: the one case with a timestamp we can stand behind.
  if (inv?.qbo_emailed_at) {
    return { kind: 'upr-sent', at: inv.qbo_emailed_at, label: 'Emailed' };
  }

  const status = key(inv?.qbo_email_status);
  if (status === 'emailsent') {
    return { kind: 'qbo-sent', at: null, label: 'Sent from QuickBooks' };
  }
  // QuickBooks batch-email queue: marked to send, not yet sent. Saying "not
  // emailed" would be wrong tomorrow and saying "sent" is wrong today.
  if (status === 'needtosend') {
    return { kind: 'qbo-queued', at: null, label: 'Queued in QuickBooks' };
  }

  // We asked QuickBooks and it said nobody has emailed this. Now "Not emailed"
  // is a fact rather than a guess about a column that could not know.
  if (inv?.qbo_email_checked_at) {
    return { kind: 'not-emailed', at: null, label: 'Not emailed' };
  }

  // Never observed: UPR did not send it and has never read QuickBooks' answer.
  return { kind: 'unknown', at: null, label: 'Not emailed from UPR' };
}

/**
 * Is QuickBooks emailing this invoice somewhere other than the contact we hold?
 *
 * Returns null unless BOTH addresses are known and they differ — an unknown
 * address is not a discrepancy, and flagging it as one would train people to
 * ignore the flag. Comparison is trim + case-insensitive; the returned strings
 * keep their original casing so the person reading them sees the real values.
 *
 * @param {object} inv an invoices row (uses qbo_bill_email)
 * @param {string} contactEmail the UPR contact's email
 * @returns {{qboEmail: string, contactEmail: string}|null}
 */
export function qboBillEmailMismatch(inv, contactEmail) {
  const qbo = clean(inv?.qbo_bill_email);
  const upr = clean(contactEmail);
  if (!qbo || !upr || key(qbo) === key(upr)) return null;
  return { qboEmail: qbo, contactEmail: upr };
}

/** One-line warning text for a mismatch, shared so all three surfaces read alike. */
export function qboBillEmailMismatchText(mismatch) {
  if (!mismatch) return '';
  return `QuickBooks emails this invoice to ${mismatch.qboEmail}, not the customer email on file (${mismatch.contactEmail}).`;
}
