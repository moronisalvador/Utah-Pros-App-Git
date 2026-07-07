/**
 * ════════════════════════════════════════════════
 * FILE: PaymentSheet.jsx  (Admin Mobile — inline record-payment form)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The little form that slides open on the mobile invoice screen when the
 *   admin taps "Record payment". You type the amount (pre-filled with what's
 *   still owed), pick who paid and how, then tap Save twice — the second tap
 *   is the deliberate "yes, really record this money" confirmation.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (rendered inline by AdminInvoiceDetail)
 *   Rendered by:  src/pages/tech/admin/AdminInvoiceDetail.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./invoiceMath (fmtMoney, todayISO)
 *   Data:      reads → none · writes → none (submits the draft to the parent;
 *              the parent runs the recordPayment money path)
 *
 * NOTES / GOTCHAS:
 *   - Inline expandable, NOT a modal (tech-mobile-ux: no modals for field
 *     actions) and two-click confirm on Save (CLAUDE.md Rule 2 — no confirm()).
 *   - Any edit after arming DISARMS the confirm — the second tap must confirm
 *     exactly what's on screen, never a changed amount.
 *   - Touch targets are 48px (gloved hands); inputMode="decimal" for the
 *     numeric keypad on the amount field.
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import { fmtMoney, todayISO } from './invoiceMath';

const PAYER_TYPES = [['insurance', 'Insurance'], ['homeowner', 'Homeowner'], ['other', 'Other']];
const METHODS = [['check', 'Check'], ['eft', 'EFT / ACH'], ['credit_card', 'Card'], ['cash', 'Cash'], ['other', 'Other']];

export default function PaymentSheet({ balance, busy, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    amount: balance > 0 ? balance.toFixed(2) : '',
    date: todayISO(),
    payer_type: 'insurance',
    method: 'check',
    payer_name: '',
    reference: '',
  });
  const [armed, setArmed] = useState(false);

  // Every edit disarms the confirm so the second tap always matches the screen.
  const patch = (p) => { setArmed(false); setForm((f) => ({ ...f, ...p })); };

  const amt = Number(form.amount);
  const canSave = !busy && amt > 0;

  const save = () => {
    if (!canSave) return;
    if (!armed) { setArmed(true); return; }
    setArmed(false);
    onSubmit(form);
  };

  return (
    <div className="am-inv-paysheet">
      <div className="am-inv-paysheet-title">Record payment</div>

      <label className="am-inv-field">
        <span className="am-inv-field-label">Amount</span>
        <input
          type="number" inputMode="decimal" min="0" step="0.01"
          className="am-inv-input am-inv-input--amount"
          value={form.amount}
          onChange={(e) => patch({ amount: e.target.value })}
          placeholder="0.00"
        />
      </label>

      <label className="am-inv-field">
        <span className="am-inv-field-label">Payment date</span>
        <input
          type="date" className="am-inv-input"
          value={form.date}
          onChange={(e) => patch({ date: e.target.value })}
        />
      </label>

      <div className="am-inv-field">
        <span className="am-inv-field-label">Who paid</span>
        <div className="am-inv-chips" role="group" aria-label="Payer type">
          {PAYER_TYPES.map(([v, label]) => (
            <button
              key={v} type="button"
              className={`am-inv-chip-btn${form.payer_type === v ? ' am-inv-chip-btn--active' : ''}`}
              onClick={() => patch({ payer_type: v })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="am-inv-field">
        <span className="am-inv-field-label">Method</span>
        <div className="am-inv-chips" role="group" aria-label="Payment method">
          {METHODS.map(([v, label]) => (
            <button
              key={v} type="button"
              className={`am-inv-chip-btn${form.method === v ? ' am-inv-chip-btn--active' : ''}`}
              onClick={() => patch({ method: v })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="am-inv-field">
        <span className="am-inv-field-label">Payer name <em>(optional)</em></span>
        <input
          type="text" className="am-inv-input"
          value={form.payer_name}
          onChange={(e) => patch({ payer_name: e.target.value })}
          placeholder="e.g. State Farm"
        />
      </label>

      <label className="am-inv-field">
        <span className="am-inv-field-label">Reference / check # <em>(optional)</em></span>
        <input
          type="text" className="am-inv-input"
          value={form.reference}
          onChange={(e) => patch({ reference: e.target.value })}
          placeholder="e.g. 1042"
        />
      </label>

      <div className="am-inv-paysheet-actions">
        <button type="button" className="am-inv-btn am-inv-btn--ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={`am-inv-btn am-inv-btn--primary${armed ? ' am-inv-btn--confirm' : ''}`}
          onClick={save}
          disabled={!canSave}
        >
          {busy ? 'Saving…' : armed ? `Confirm — record ${fmtMoney(amt)}` : 'Save payment'}
        </button>
      </div>
    </div>
  );
}
