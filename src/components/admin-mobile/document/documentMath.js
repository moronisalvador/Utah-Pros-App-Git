/**
 * ════════════════════════════════════════════════
 * FILE: documentMath.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives invoice and estimate screens one consistent way to show dollar
 *   amounts. It also works out a line's total when a saved total is not
 *   available yet.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - A saved line total takes priority over a calculated quantity times rate.
 * ════════════════════════════════════════════════
 */
export const formatDocumentMoney = (value) => Number(value || 0).toLocaleString(undefined, {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2,
});

export const documentLineAmount = (line) => Number(line.line_total != null
  ? line.line_total
  : Number(line.quantity || 0) * Number(line.unit_price || 0));
