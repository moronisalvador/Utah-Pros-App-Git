/**
 * ════════════════════════════════════════════════
 * FILE: DocumentLineList.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows the individual charges on an estimate or invoice in a compact list.
 *   It can show a simple read-only list or let someone open a line to change it
 *   and add another line. The surrounding page provides every line, destination,
 *   and action, so this component never loads or saves financial information.
 *
 * WHERE IT LIVES:
 *   Route:        n/a
 *   Rendered by:  src/pages/tech/admin/AdminEstimateDetail.jsx and
 *                 src/pages/tech/admin/AdminInvoiceDetail.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/components/ui/EmptyState,
 *              @/components/admin-mobile/icons, ./documentMath
 *   Data:      reads  → none directly; the surrounding page supplies the lines
 *              writes → none directly; add and edit actions call the surrounding page
 *
 * NOTES / GOTCHAS:
 *   - When editing is enabled, each row is a link so keyboard and screen-reader
 *     users receive the same edit destination as someone who taps the row.
 *   - The add button appears only when the surrounding page supplies both an
 *     edit permission and an add action.
 * ════════════════════════════════════════════════
 */
import { useId } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '@/components/ui/EmptyState';
import { IconChevronRight } from '@/components/admin-mobile/icons';
import { documentLineAmount, formatDocumentMoney } from './documentMath';

export default function DocumentLineList({
  heading = 'Line items',
  headingId,
  lines = [],
  editable = false,
  lineHref,
  onLineClick,
  onAdd,
  addLabel = 'Add line item',
  children,
}) {
  const generatedHeadingId = useId();
  const resolvedHeadingId = headingId || `document-lines-${generatedHeadingId.replace(/:/g, '')}`;
  return (
    <section className="am-section am-document-lines" aria-labelledby={resolvedHeadingId}>
      <div className="am-section-heading">
        <h2 id={resolvedHeadingId} className="am-section-label">{heading}</h2>
        <span>{lines.length}</span>
      </div>
      {lines.length === 0 && <EmptyState className="am-invoice-empty" title="No line items yet." />}
      {lines.map((line) => {
        const name = line.description || line.qbo_item_name || 'Untitled line item';
        const row = (
          <>
            <div className="am-data-row-main">
              <strong>{name}</strong>
              <span>{Number(line.quantity || 0)} × {formatDocumentMoney(line.unit_price)}{line.qbo_class_name ? ` · ${line.qbo_class_name}` : ''}</span>
            </div>
            <strong className="am-data-row-money">{formatDocumentMoney(documentLineAmount(line))}</strong>
            {editable && <IconChevronRight className="am-data-row-chevron" width={18} height={18} aria-hidden="true" />}
          </>
        );
        return editable && lineHref ? (
          <Link key={line.id} to={lineHref(line)} onClick={() => onLineClick?.(line)} className="am-data-row am-data-row--link" aria-label={`Edit line item ${name}, quantity ${Number(line.quantity || 0)}, rate ${formatDocumentMoney(line.unit_price)}, total ${formatDocumentMoney(documentLineAmount(line))}`}>
            {row}
          </Link>
        ) : <div key={line.id} className="am-data-row am-data-row--readonly">{row}</div>;
      })}
      {children}
      {editable && onAdd && (
        <button type="button" className="am-document-add" onClick={onAdd} aria-label={addLabel}>{addLabel}</button>
      )}
    </section>
  );
}
