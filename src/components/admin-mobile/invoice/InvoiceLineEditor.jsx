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
import DocumentLineEditor from '@/components/admin-mobile/document/DocumentLineEditor';

export default function InvoiceLineEditor({ line, items, classes, qboInvoiceId, busy, onPatch, onSave }) {
  return (
    <DocumentLineEditor line={line} items={items} classes={classes} busy={busy}
      saveLabel={qboInvoiceId ? 'Update QuickBooks' : 'Save to QuickBooks'}
      onPatch={onPatch} onSave={() => { if (!busy) onSave(); }} />
  );
}
