/**
 * ════════════════════════════════════════════════
 * FILE: SendReviewModal.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The window that opens before an invoice is emailed. It shows who the invoice
 *   is going to, lets staff correct that address, add one other person, and edit
 *   the note the customer will read on the invoice. Nothing is sent until they
 *   press Send.
 *
 * WHERE IT LIVES:
 *   Route:        n/a
 *   Rendered by:  src/pages/InvoiceEditor.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/components/ui (Modal), ./invoice-send-review.css
 *   Data:      none directly — the caller owns every database and Worker call
 *
 * NOTES / GOTCHAS:
 *   - While a send is in flight the modal cannot be closed by Escape, the overlay
 *     or the ✕. That is deliberate: the close paths would leave a provider call
 *     running with no surface reporting it.
 *   - This collects and validates. It never sends; onSend owns that.
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import { Modal } from '@/components/ui';
import './invoice-send-review.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SendReviewModal({
  open,
  onClose,
  contactEmail = '',
  invoice = {},
  submitting = false,
  onSend,
}) {
  // Seeded once per mount. The caller remounts this on open (via `key`), which
  // re-seeds from the record without syncing props into state in an effect --
  // the pattern react-hooks/set-state-in-effect exists to prevent.
  const [to, setTo] = useState(contactEmail || '');
  const [cc, setCc] = useState(invoice.send_cc_email || '');
  const [message, setMessage] = useState(invoice.customer_message || '');
  const [error, setError] = useState('');

  const submit = (event) => {
    event.preventDefault();
    const nextTo = to.trim();
    const nextCc = cc.trim();
    if (!EMAIL_RE.test(nextTo)) { setError('Enter a valid email address to send to.'); return; }
    if (nextCc && !EMAIL_RE.test(nextCc)) { setError('The CC address is not a valid email.'); return; }
    if (nextCc.toLowerCase() === nextTo.toLowerCase()) { setError('The CC address is the same as the recipient.'); return; }
    if (message.length > 1000) { setError('The message is too long — keep it under 1000 characters.'); return; }
    setError('');
    onSend({ to: nextTo, cc: nextCc, message: message.trim() });
  };

  const resend = Boolean(invoice.qbo_emailed_at);

  return (
    <Modal
      open={open}
      onClose={submitting ? undefined : onClose}
      closeOnOverlay={!submitting}
      className="inv-send-review"
      title={resend ? 'Resend invoice' : 'Send invoice to customer'}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" form="inv-send-review-form" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Sending…' : resend ? 'Resend' : 'Send'}
          </button>
        </>
      )}
    >
      <form id="inv-send-review-form" onSubmit={submit}>
        {error && <div className="inv-send-error" role="alert">{error}</div>}

        <label className="inv-send-field">
          <span>To</span>
          <input type="email" value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" required />
        </label>

        <label className="inv-send-field">
          <span>CC (optional)</span>
          <input type="email" value={cc} onChange={(e) => setCc(e.target.value)} autoComplete="off" placeholder="Nobody" />
        </label>

        <label className="inv-send-field">
          <span>Message on the invoice</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000}
            placeholder="Leave blank to keep the job and claim details" />
        </label>
        <div className="inv-send-hint">
          {message.trim()
            ? 'The customer sees this instead of the job and claim summary.'
            : 'The customer sees the job, claim and service address summary.'}
        </div>

        {resend && (
          <div className="inv-send-hint">
            This invoice was already emailed. Sending again delivers another copy.
          </div>
        )}
      </form>
    </Modal>
  );
}
