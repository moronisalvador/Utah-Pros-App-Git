/**
 * ════════════════════════════════════════════════
 * FILE: DocumentLineEditor.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows the fields a person uses to describe one line on an estimate or an
 *   invoice, including the item, class, quantity, and price. It shows the line
 *   total as those values change and gives the surrounding screen one button to
 *   save the completed line. Pressing Enter while filling in a field does not
 *   save anything.
 *
 * WHERE IT LIVES:
 *   Route:        n/a
 *   Rendered by:  src/pages/tech/admin/AdminEstimateLineEdit.jsx and
 *                 src/components/admin-mobile/invoice/InvoiceLineEditor.jsx
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/components/admin-mobile/estimate/CatalogPicker,
 *              ./documentMath
 *   Data:      reads  → none directly; the surrounding screen supplies the line,
 *                        item, and class values
 *              writes → none directly; the surrounding screen handles saving
 *
 * NOTES / GOTCHAS:
 *   - This component deliberately prevents normal form submission, so Enter
 *     cannot accidentally start a QuickBooks change. Its onSave callback is the
 *     only way this screen asks the surrounding page to save.
 * ════════════════════════════════════════════════
 */
import CatalogPicker from '@/components/admin-mobile/estimate/CatalogPicker';
import { documentLineAmount, formatDocumentMoney } from './documentMath';

export default function DocumentLineEditor({ line, items, classes, busy, saveLabel, onPatch, onSave }) {
  const amount = documentLineAmount(line);
  return (
    <form className="am-invline-editor" onSubmit={(event) => event.preventDefault()}>
      <div className="am-invline-header">
        <div className="am-invline-eyebrow">Line item</div>
        <div className="am-invline-amount" aria-live="polite"><div className="am-invline-label">Amount</div><div className="am-invline-amount-value">{formatDocumentMoney(amount)}</div></div>
      </div>
      <label className="am-invline-field"><span className="am-invline-label">Description</span><input name="description" autoComplete="off" className="am-invline-input am-invline-input--description" value={line.description || ''} onChange={(event) => onPatch({ description: event.target.value })} disabled={busy} /></label>
      <CatalogPicker label="Item" value={line.qbo_item_id} valueName={line.qbo_item_name} options={items} disabled={busy} classPrefix="am-invline-picker" onChange={(option) => onPatch({ qbo_item_id: option?.id || null, qbo_item_name: option?.name || null })} />
      <CatalogPicker label="Class" value={line.qbo_class_id} valueName={line.qbo_class_name} options={classes} disabled={busy} classPrefix="am-invline-picker" onChange={(option) => onPatch({ qbo_class_id: option?.id || null, qbo_class_name: option?.name || null })} />
      <div className="am-invline-numbers">
        <label className="am-invline-field am-invline-field--quantity"><span className="am-invline-label">Quantity</span><input name="quantity" autoComplete="off" className="am-invline-input am-invline-input--number" inputMode="decimal" type="number" step="any" value={line.quantity ?? ''} onChange={(event) => onPatch({ quantity: event.target.value })} disabled={busy} /></label>
        <label className="am-invline-field am-invline-field--rate"><span className="am-invline-label">Rate</span><input name="unit_price" autoComplete="off" className="am-invline-input am-invline-input--number" inputMode="decimal" type="number" step="any" value={line.unit_price ?? ''} onChange={(event) => onPatch({ unit_price: event.target.value })} disabled={busy} /></label>
      </div>
      <button type="button" className="am-invline-submit" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : saveLabel}</button>
    </form>
  );
}
