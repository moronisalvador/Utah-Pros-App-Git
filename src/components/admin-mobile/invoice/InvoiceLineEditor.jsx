/**
 * ════════════════════════════════════════════════
 * FILE: InvoiceLineEditor.jsx  (Admin Mobile — focused invoice line form)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows the editable source fields for exactly one invoice line. It contains
 *   no add, remove, reorder, payment, or send action. Its one explicit submit
 *   is the caller's human-gated Save-to-QuickBooks command after scope and lock
 *   enforcement; typing into fields never calls QuickBooks.
 *
 * DEPENDS ON: CatalogPicker and invoiceLineEdit (presentation + pure math).
 * ════════════════════════════════════════════════
 */
import CatalogPicker from '@/components/admin-mobile/estimate/CatalogPicker';
import { invoiceLineAmount } from './invoiceLineEdit';

const formatMoney = (value) => Number(value || 0).toLocaleString(undefined, {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2,
});

export default function InvoiceLineEditor({ line, items, classes, qboInvoiceId, busy, onPatch, onSave }) {
  const amount = invoiceLineAmount(line);
  const save = () => {
    if (busy) return;
    // The route owner pairs the accepted, synchronously latched command with
    // one haptic. Keeping it there prevents two rapid taps from ticking twice.
    onSave();
  };

  return (
    <form className="am-invline-editor" onSubmit={(event) => { event.preventDefault(); }}>
      <div className="am-invline-header">
        <div className="am-invline-eyebrow">Line item</div>
        <div className="am-invline-amount" aria-live="polite">
          <div className="am-invline-label">Amount</div>
          <div className="am-invline-amount-value">{formatMoney(amount)}</div>
        </div>
      </div>

      <label className="am-invline-field">
        <span className="am-invline-label">Description</span>
        <input className="am-invline-input am-invline-input--description" value={line.description || ''} onChange={(event) => onPatch({ description: event.target.value })} disabled={busy} />
      </label>

      <CatalogPicker
        label="Item"
        value={line.qbo_item_id}
        valueName={line.qbo_item_name}
        options={items}
        disabled={busy}
        classPrefix="am-invline-picker"
        onChange={(option) => onPatch({ qbo_item_id: option?.id || null, qbo_item_name: option?.name || null })}
      />
      <CatalogPicker
        label="Class"
        value={line.qbo_class_id}
        valueName={line.qbo_class_name}
        options={classes}
        disabled={busy}
        classPrefix="am-invline-picker"
        onChange={(option) => onPatch({ qbo_class_id: option?.id || null, qbo_class_name: option?.name || null })}
      />

      <div className="am-invline-numbers">
        <label className="am-invline-field am-invline-field--quantity">
          <span className="am-invline-label">Quantity</span>
          <input className="am-invline-input am-invline-input--number" inputMode="decimal" type="number" step="any" value={line.quantity ?? ''} onChange={(event) => onPatch({ quantity: event.target.value })} disabled={busy} />
        </label>
        <label className="am-invline-field am-invline-field--rate">
          <span className="am-invline-label">Rate</span>
          <input className="am-invline-input am-invline-input--number" inputMode="decimal" type="number" step="any" value={line.unit_price ?? ''} onChange={(event) => onPatch({ unit_price: event.target.value })} disabled={busy} />
        </label>
      </div>

      <button type="button" className="am-invline-submit" disabled={busy} onClick={save}>
        {busy ? 'Saving…' : qboInvoiceId ? 'Update QuickBooks' : 'Save to QuickBooks'}
      </button>
    </form>
  );
}
