/**
 * ════════════════════════════════════════════════
 * FILE: LineItemCard.jsx  (Admin Mobile — one editable estimate line, P4b)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One line item of the mobile estimate builder, as an editable card: pick the
 *   QuickBooks item and class, type what the work is, set the quantity and the
 *   rate, and the line's dollar amount updates as you type. Removing a line
 *   takes two deliberate taps (tap once to arm, tap again to delete) so a
 *   stray thumb can't wipe out work.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a card in a list)
 *   Rendered by:  src/pages/tech/admin/AdminEstimateEditor.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./CatalogPicker, ./estimateBuilder (lineAmount)
 *   Data:      reads → none · writes → none (edits flow up via onPatch/onCommit/onRemove)
 *
 * NOTES / GOTCHAS:
 *   - onPatch(patch) updates parent state as the user types; onCommit(patch?)
 *     persists the line (parent writes ONLY the safe columns via buildLineUpdate —
 *     line_total is GENERATED and never written).
 *   - Pickers commit immediately on selection (there's no blur to wait for);
 *     text/number inputs commit on blur, mirroring the desktop builder.
 *   - The remove two-click disarms on blur, per the UPR two-click-confirm pattern.
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import CatalogPicker from './CatalogPicker';
import { lineAmount } from './estimateBuilder';

const fmt$ = (n) =>
  Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

export default function LineItemCard({ line, index, items, classes, busy, onPatch, onCommit, onRemove }) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <div className="am-estb-line">
      <div className="am-estb-line-top">
        <span className="am-estb-line-n">Line {index + 1}</span>
        <button
          type="button"
          className={`am-estb-line-remove${confirmRemove ? ' am-estb-line-remove--confirm' : ''}`}
          onClick={() => {
            if (!confirmRemove) { setConfirmRemove(true); return; }
            setConfirmRemove(false);
            onRemove();
          }}
          onBlur={() => setConfirmRemove(false)}
          disabled={busy}
        >
          {confirmRemove ? 'Tap again to remove' : 'Remove'}
        </button>
      </div>

      <CatalogPicker
        label="Item"
        value={line.qbo_item_id || ''}
        valueName={line.qbo_item_name || ''}
        options={items}
        disabled={!items.length}
        onChange={(it) => onCommit({ qbo_item_id: it?.id || null, qbo_item_name: it?.name || null })}
      />

      <div className="am-estb-field">
        <div className="am-estb-field-label">Description</div>
        <textarea
          className="am-estb-desc"
          value={line.description || ''}
          placeholder="Description / scope of work"
          rows={2}
          onChange={(e) => onPatch({ description: e.target.value })}
          onBlur={() => onCommit()}
        />
      </div>

      <CatalogPicker
        label="Class"
        value={line.qbo_class_id || ''}
        valueName={line.qbo_class_name || ''}
        options={classes}
        disabled={!classes.length}
        onChange={(c) => onCommit({ qbo_class_id: c?.id || null, qbo_class_name: c?.name || null })}
      />

      <div className="am-estb-line-nums">
        <div className="am-estb-field am-estb-field--qty">
          <div className="am-estb-field-label">Qty</div>
          <input
            className="am-estb-num"
            type="number"
            inputMode="decimal"
            value={line.quantity ?? ''}
            onChange={(e) => onPatch({ quantity: e.target.value })}
            onBlur={() => onCommit()}
          />
        </div>
        <div className="am-estb-field am-estb-field--rate">
          <div className="am-estb-field-label">Rate</div>
          <input
            className="am-estb-num"
            type="number"
            inputMode="decimal"
            value={line.unit_price ?? ''}
            onChange={(e) => onPatch({ unit_price: e.target.value })}
            onBlur={() => onCommit()}
          />
        </div>
        <div className="am-estb-line-amt">
          <div className="am-estb-field-label">Amount</div>
          <div className="am-estb-amt-val">{fmt$(lineAmount(line))}</div>
        </div>
      </div>
    </div>
  );
}
