/**
 * ════════════════════════════════════════════════
 * FILE: estimateBuilder.js  (Admin Mobile — estimate builder logic, P4b)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The small, pure "brain" behind the mobile estimate builder — no screen, no
 *   database, just the calculations. It builds the exact message we send when
 *   creating a new estimate for a customer, shapes every line-item write so the
 *   database's own computed total column is never touched, cleans up the
 *   QuickBooks item/class catalog we fetch for the pickers, and adds up the
 *   running total shown at the bottom. Split out so it can be tested on its own.
 *
 * USED BY:
 *   AdminEstimateEditor.jsx and the P4b builder components (LineItemCard,
 *   EstimateCreateForm).
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → none · writes → none (pure functions)
 *
 * NOTES / GOTCHAS:
 *   - estimate_line_items.line_total is a GENERATED column (quantity × unit_price)
 *     — LINE_SAFE_COLUMNS deliberately excludes it and the named P4b tests pin that.
 *   - CREATE_ESTIMATE_PARAMS mirrors the create_estimate_for_contact RPC signature
 *     (supabase/migrations/20260625_estimate_decouple.sql) — call-only, never edited.
 *   - QBO "Category" items are organizational parents, not sellable products; QBO
 *     rejects any estimate that references one, so parseQboCatalog filters them out
 *     (the query API can't filter Type server-side — mirrors the desktop editor).
 * ════════════════════════════════════════════════
 */

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const orNull = (s) => {
  const v = (s || '').trim();
  return v ? v : null;
};

// ─── SECTION: Create shell ──────────────

/** The exact parameter set of the create_estimate_for_contact RPC (frozen contract). */
export const CREATE_ESTIMATE_PARAMS = Object.freeze([
  'p_contact_id',
  'p_intended_division',
  'p_estimate_type',
  'p_property_address',
  'p_property_city',
  'p_property_state',
  'p_property_zip',
  'p_created_by',
]);

/**
 * Build the create_estimate_for_contact RPC payload. Empty address parts are
 * sent as null so the row stays clean (matches the desktop NewEstimateModal).
 */
export function buildCreateEstimatePayload({ contactId, division, estimateType, addr = {}, createdBy = null }) {
  return {
    p_contact_id: contactId,
    p_intended_division: division || 'water',
    p_estimate_type: estimateType || 'initial',
    p_property_address: orNull(addr.address),
    p_property_city: orNull(addr.city),
    p_property_state: orNull(addr.state),
    p_property_zip: orNull(addr.zip),
    p_created_by: createdBy || null,
  };
}

// ─── SECTION: Line-item writes ──────────────

/**
 * The only estimate_line_items columns the builder may write on an update.
 * line_total is GENERATED (quantity × unit_price) — never in this list.
 */
export const LINE_SAFE_COLUMNS = Object.freeze([
  'description',
  'qbo_item_id',
  'qbo_item_name',
  'qbo_class_id',
  'qbo_class_name',
  'quantity',
  'unit_price',
]);

/** Payload for a brand-new blank line (insert). Excludes line_total. */
export function buildLineInsert(estimateId, sortOrder) {
  return { estimate_id: estimateId, description: '', quantity: 1, unit_price: 0, sort_order: Number(sortOrder || 0) };
}

/** Payload for saving a line's edits (update). Exactly LINE_SAFE_COLUMNS. */
export function buildLineUpdate(line) {
  return {
    description: line.description || '',
    qbo_item_id: line.qbo_item_id || null,
    qbo_item_name: line.qbo_item_name || null,
    qbo_class_id: line.qbo_class_id || null,
    qbo_class_name: line.qbo_class_name || null,
    quantity: Number(line.quantity || 0),
    unit_price: Number(line.unit_price || 0),
  };
}

// ─── SECTION: QBO catalog ──────────────

/**
 * Normalize the two /api/qbo-query responses (Item + Class) into picker options.
 * Drops QBO "Category" items — QBO rejects estimates that reference a category.
 */
export function parseQboCatalog(itemsResponse = {}, classesResponse = {}) {
  const items = (itemsResponse.Item || [])
    .filter((i) => i.Type !== 'Category')
    .map((i) => ({ id: String(i.Id), name: i.Name }));
  const classes = (classesResponse.Class || []).map((c) => ({ id: String(c.Id), name: c.Name }));
  return { items, classes };
}

// ─── SECTION: Totals ──────────────

/** One line's display amount: the DB total when present, else qty × rate. */
export const lineAmount = (l) =>
  l.line_total != null ? Number(l.line_total) : Number(l.quantity || 0) * Number(l.unit_price || 0);

/** Running subtotal/total across the lines (estimates have no tax line). */
export function computeTotals(lines = []) {
  const subtotal = round2(lines.reduce((s, l) => s + lineAmount(l), 0));
  return { subtotal, total: subtotal };
}
