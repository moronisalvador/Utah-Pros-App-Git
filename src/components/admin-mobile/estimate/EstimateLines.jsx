/**
 * ════════════════════════════════════════════════
 * FILE: EstimateLines.jsx  (Admin Mobile — estimate line items, read-only, P4a)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The list of line items on the mobile estimate screen — each row shows what
 *   the item is, its quantity and rate, and the line amount, with a subtotal and
 *   total at the bottom. It's view-only here: building or editing line items is
 *   the estimate builder's job (a separate screen). If there are no lines yet it
 *   shows a short empty message.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a presentational list)
 *   Rendered by:  src/pages/tech/admin/AdminEstimateDetail.jsx
 *
 * DEPENDS ON:
 *   Packages:  react (JSX)
 *   Internal:  none
 *   Data:      reads → none · writes → none (lines/total passed in as props)
 *
 * NOTES / GOTCHAS:
 *   - Read-only by design (P4a is view + send + convert). Editing lives in the
 *     builder (P4b) reached via the "Edit / add line items" link on the page.
 *   - line_total is a GENERATED DB column; here we only display it (fall back to
 *     qty × rate if a row somehow lacks it).
 * ════════════════════════════════════════════════
 */

const fmt$ = (n) =>
  (Number(n || 0)).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

const lineAmount = (l) => (l.line_total != null ? Number(l.line_total) : Number(l.quantity || 0) * Number(l.unit_price || 0));

export default function EstimateLines({ lines = [], subtotal, total }) {
  return (
    <div className="am-est-card am-est-lines">
      <div className="am-est-lines-title">Line items</div>

      {lines.length === 0 ? (
        <div className="am-est-lines-empty">No line items yet.</div>
      ) : (
        <div className="am-est-line-list">
          {lines.map((l) => (
            <div key={l.id} className="am-est-line">
              <div className="am-est-line-main">
                <div className="am-est-line-desc">
                  {l.qbo_item_name ? <span className="am-est-line-item">{l.qbo_item_name}</span> : null}
                  {l.qbo_item_name && l.description ? ' — ' : ''}
                  {l.description || (l.qbo_item_name ? '' : '—')}
                </div>
                <div className="am-est-line-meta">
                  {Number(l.quantity || 0)} × {fmt$(l.unit_price)}
                  {l.qbo_class_name ? ` · ${l.qbo_class_name}` : ''}
                </div>
              </div>
              <div className="am-est-line-amt">{fmt$(lineAmount(l))}</div>
            </div>
          ))}
        </div>
      )}

      <div className="am-est-totals">
        <div className="am-est-total-row">
          <span>Subtotal</span>
          <span className="am-est-total-val">{fmt$(subtotal)}</span>
        </div>
        <div className="am-est-total-row am-est-total-row--strong">
          <span>Total</span>
          <span className="am-est-total-val">{fmt$(total)}</span>
        </div>
      </div>
    </div>
  );
}
